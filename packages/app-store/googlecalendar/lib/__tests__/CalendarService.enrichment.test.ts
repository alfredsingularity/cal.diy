import { MeetLocationType } from "@calcom/app-store/constants";
import type { CalendarServiceEvent } from "@calcom/types/Calendar";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";
import type { calendar_v3 } from "@googleapis/calendar";
import i18next from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert:
    vi.fn<
      (input: calendar_v3.Params$Resource$Events$Insert) => Promise<{ data: calendar_v3.Schema$Event }>
    >(),
  patch:
    vi.fn<(input: calendar_v3.Params$Resource$Events$Patch) => Promise<{ data: calendar_v3.Schema$Event }>>(),
  instances: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../CalendarAuth", () => ({
  CalendarAuth: class {
    async getClient() {
      return { events: mocks };
    }
  },
}));
vi.mock("@calcom/features/di/containers/DestinationCalendar", () => ({
  getDestinationCalendarRepository: () => ({ getCustomReminderByCredentialId: async () => null }),
}));
vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => ({
  SelectedCalendarRepository: class {},
}));
vi.mock("@calcom/lib/logger", () => {
  const logger = { warn: mocks.warn, error: mocks.error, debug: vi.fn(), getSubLogger: () => logger };
  return { default: logger };
});

import BuildCalendarService from "../CalendarService";

const credential: CredentialForCalendarServiceWithEmail = {
  id: 1,
  userId: 1,
  appId: "google-calendar",
  type: "google_calendar",
  key: { access_token: "synthetic-secret" },
  user: { email: "host@example.test" },
  delegationCredentialId: null,
  delegatedTo: null,
  invalid: false,
  teamId: null,
  encryptedKey: null,
};
const created: calendar_v3.Schema$Event = {
  id: "synthetic-created-id",
  iCalUID: "synthetic-ical@example.test",
  hangoutLink: "https://meet.example.test/synthetic",
  conferenceData: {
    conferenceId: "synthetic-conference",
    entryPoints: [{ entryPointType: "video", uri: "https://meet.example.test/synthetic" }],
  },
};
const calEvent: CalendarServiceEvent = {
  title: "Synthetic audit",
  type: "free-audit",
  uid: "synthetic-booking",
  startTime: "2026-11-03T13:00:00Z",
  endTime: "2026-11-03T13:30:00Z",
  organizer: {
    name: "Synthetic Host",
    email: "host@example.test",
    timeZone: "Europe/London",
    language: { locale: "en", translate: i18next.t },
  },
  attendees: [],
  location: MeetLocationType,
  calendarDescription: "Initial description",
  hideCalendarEventDetails: true,
  seatsPerTimeSlot: 2,
  seatsShowAttendees: false,
  conferenceData: { createRequest: { requestId: "synthetic-conference-request" } },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.insert.mockResolvedValue({ data: created });
  mocks.patch.mockResolvedValue({ data: {} });
});

describe("Google Calendar optional Meet-link enrichment", () => {
  it("enriches successfully without replacing the created event identity and conference metadata", async () => {
    const result = await BuildCalendarService(credential).createEvent(calEvent, credential.id);
    expect(result).toMatchObject({ ...created, additionalInfo: { hangoutLink: created.hangoutLink } });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({
      requestBody: {
        visibility: "private",
        guestsCanSeeOtherGuests: false,
        description: "Initial description",
        conferenceData: calEvent.conferenceData,
      },
    });
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0][0]).toMatchObject({
      eventId: created.id,
      requestBody: { location: created.hangoutLink },
    });
    expect(Object.keys(mocks.patch.mock.calls[0][0].requestBody ?? {}).sort()).toEqual([
      "description",
      "location",
    ]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Google403 rate limit",
      error: { response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } } },
      diagnostic: { status: 403, reason: "rateLimitExceeded" },
    },
    { name: "timeout", error: { code: "ETIMEDOUT" }, diagnostic: { reason: "TIMEOUT" } },
  ])("preserves the inserted event after $name without retry or deletion", async ({ error, diagnostic }) => {
    mocks.patch.mockRejectedValue(error);
    const result = await BuildCalendarService(credential).createEvent(calEvent, credential.id);
    expect(result).toMatchObject({ ...created, additionalInfo: { hangoutLink: created.hangoutLink } });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("GOOGLE_CALENDAR_ENRICHMENT_FAILED", {
      stage: "meet_link_enrichment",
      ...diagnostic,
    });
  });

  it("logs only allowlisted status/reason data from a sensitive provider error", async () => {
    const sensitive = "synthetic-do-not-log-secret";
    const error = {
      message: sensitive,
      config: { headers: { authorization: sensitive }, body: sensitive },
      response: {
        status: 403,
        headers: { authorization: sensitive },
        data: { error: { message: sensitive, errors: [{ reason: sensitive }] } },
      },
    };
    mocks.patch.mockRejectedValue(error);
    await BuildCalendarService(credential).createEvent(calEvent, credential.id);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith("GOOGLE_CALENDAR_ENRICHMENT_FAILED", {
      stage: "meet_link_enrichment",
      status: 403,
      reason: "UNKNOWN",
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(sensitive);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(error.config.body).toBe(sensitive);
  });

  it("still rejects the original INSERT failure and does not attempt enrichment", async () => {
    const error = new Error("Synthetic insert failure");
    mocks.insert.mockRejectedValue(error);
    await expect(BuildCalendarService(credential).createEvent(calEvent, credential.id)).rejects.toBe(error);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("still rejects recurrence resolution failure after insertion", async () => {
    const error = new Error("Synthetic instance resolution failure");
    mocks.insert.mockResolvedValue({ data: { ...created, recurrence: ["RRULE:FREQ=DAILY;COUNT=2"] } });
    mocks.instances.mockRejectedValue(error);
    await expect(BuildCalendarService(credential).createEvent(calEvent, credential.id)).rejects.toBe(error);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("still rejects the required existing recurring-instance patch", async () => {
    const error = new Error("Synthetic recurring-instance patch failure");
    mocks.instances.mockResolvedValue({
      data: { items: [{ ...created, start: { dateTime: calEvent.startTime } }] },
    });
    mocks.patch.mockRejectedValue(error);
    await expect(
      BuildCalendarService(credential).createEvent(
        { ...calEvent, existingRecurringEvent: { recurringEventId: "synthetic-series" } },
        credential.id
      )
    ).rejects.toBe(error);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("does not attempt enrichment without a returned Meet link", async () => {
    const eventWithoutMeet = { id: created.id, iCalUID: created.iCalUID };
    mocks.insert.mockResolvedValue({ data: eventWithoutMeet });
    expect(await BuildCalendarService(credential).createEvent(calEvent, credential.id)).toMatchObject(
      eventWithoutMeet
    );
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("still rejects primary update and delete failures", async () => {
    const error = new Error("Synthetic primary operation failure");
    mocks.update.mockRejectedValue(error);
    mocks.delete.mockRejectedValue(error);
    const service = BuildCalendarService(credential);
    await expect(service.updateEvent("synthetic-id", calEvent, "primary")).rejects.toBe(error);
    await expect(service.deleteEvent("synthetic-id", calEvent, "primary")).rejects.toBe(error);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
