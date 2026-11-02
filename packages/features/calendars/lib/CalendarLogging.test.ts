import { inspect } from "node:util";
import { getCalendarErrorDiagnostic } from "@calcom/lib/getCalendarErrorDiagnostic";
import type { DestinationCalendar } from "@calcom/prisma/client";
import type { CalendarServiceEvent } from "@calcom/types/Calendar";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  insert: vi.fn(),
  patch: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getCalendar: vi.fn(),
  list: vi.fn(),
  query: vi.fn(),
  primary: vi.fn(),
}));
vi.mock("@calcom/lib/logger", () => {
  const logger = {
    debug: mocks.log,
    info: mocks.log,
    warn: mocks.log,
    error: mocks.log,
    silly: mocks.log,
    getSubLogger: () => logger,
  };
  return { default: logger };
});
vi.mock("@calcom/app-store/googlecalendar/lib/CalendarAuth", () => ({
  CalendarAuth: class {
    authManager = {
      request: async (request: () => Promise<Response>) => ({ json: await (await request()).json() }),
    };
    async getClient() {
      return {
        events: mocks,
        freebusy: { query: mocks.query },
        calendarList: { list: mocks.list },
        calendars: { get: mocks.primary },
      };
    }
  },
}));
vi.mock("@calcom/features/di/containers/DestinationCalendar", () => ({
  getDestinationCalendarRepository: () => ({ getCustomReminderByCredentialId: async () => null }),
}));
vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => ({
  SelectedCalendarRepository: class {},
}));
vi.mock("@calcom/app-store/_utils/getCalendar", () => ({ getCalendar: mocks.getCalendar }));
vi.mock("@calcom/app-store/utils", () => ({
  default: (credentials: unknown[]) => [
    { name: "Google Calendar", type: "google_calendar", variant: "calendar", credentials },
  ],
}));
vi.mock("@calcom/features/calendars/lib/getCalendarsEvents", () => ({
  default: vi.fn(),
  getCalendarsEventsWithTimezones: vi.fn(),
}));
vi.mock("@calcom/app-store/dailyvideo/lib/VideoApiAdapter", () => ({ FAKE_DAILY_CREDENTIAL: {} }));
vi.mock("@calcom/features/conferencing/lib/videoClient", () => ({
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
}));
vi.mock("@calcom/features/credentials/repositories/CredentialRepository", () => ({
  CredentialRepository: {},
}));
vi.mock("@calcom/features/crmManager/crmManager", () => ({ default: class {} }));
vi.mock("@calcom/features/crmManager/crmScheduler", () => ({ default: class {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({ FeaturesRepository: class {} }));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));

import BuildCalendarService, {
  createGoogleCalendarServiceWithGoogleType,
} from "@calcom/app-store/googlecalendar/lib/CalendarService";
import EventManager from "@calcom/features/bookings/lib/EventManager";
import {
  createEvent,
  deleteEvent,
  getBusyCalendarTimes,
  getCalendarCredentials,
  getConnectedCalendars,
  updateEvent,
} from "@calcom/features/calendars/lib/CalendarManager";

const sentinels = [
  "synthetic-access-secret",
  "synthetic-refresh-secret",
  "synthetic-encrypted-secret",
  "synthetic-body-secret",
];
const credential: CredentialForCalendarServiceWithEmail = {
  id: 1,
  userId: 1,
  appId: "google-calendar",
  type: "google_calendar",
  key: { access_token: sentinels[0], refresh_token: sentinels[1] },
  encryptedKey: sentinels[2],
  user: { email: "host@example.test" },
  delegationCredentialId: null,
  delegatedTo: null,
  invalid: false,
  teamId: null,
};
const event: CalendarServiceEvent = {
  title: sentinels[3],
  type: "synthetic-event",
  uid: "synthetic-booking",
  calendarDescription: "Synthetic description",
  startTime: "2026-11-03T13:00:00Z",
  endTime: "2026-11-03T13:30:00Z",
  location: "Synthetic room",
  attendees: [],
  organizer: {
    name: "Synthetic Host",
    email: "host@example.test",
    timeZone: "UTC",
    language: { locale: "en", translate: i18next.t },
  },
};
const created = {
  uid: "synthetic",
  id: "synthetic",
  type: "google_calendar",
  description: sentinels[3],
  password: sentinels[2],
  url: "https://example.test/synthetic",
};

function failure(asError: boolean) {
  return Object.assign(asError ? new Error(sentinels[3]) : { message: sentinels[3] }, {
    code: 403,
    calError: "LEGACY_CAL_ERROR",
    config: { headers: { Authorization: `Bearer ${sentinels[0]}` }, body: { refresh_token: sentinels[1] } },
    response: {
      status: 403,
      data: { error: { message: sentinels[3], errors: [{ reason: "rateLimitExceeded" }] } },
    },
  });
}
function expectSafeLogs() {
  expect(mocks.log).toHaveBeenCalled();
  const output = inspect(mocks.log.mock.calls, { depth: null });
  for (const secret of sentinels) expect(output).not.toContain(secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(mocks.log);
  mocks.getCalendar.mockResolvedValue(BuildCalendarService(credential));
  mocks.insert.mockResolvedValue({ data: created });
  mocks.list.mockResolvedValue({ data: { items: [{ id: "primary", timeZone: "UTC" }] } });
  mocks.query.mockResolvedValue({ status: 200, statusText: "OK", data: { calendars: {} } });
});

afterEach(() => vi.mocked(console.error).mockRestore());

describe("calendar lifecycle logging", () => {
  it.each([
    sentinels[0],
    { response: { status: sentinels[0], data: { error: { errors: [{ reason: sentinels[1] }] } } } },
    { response: { status: 999 } },
  ])("does not copy malformed or unrecognized diagnostic fields", (error) => {
    expect(getCalendarErrorDiagnostic(error)).toEqual({ reason: "UNKNOWN" });
  });
  for (const asError of [false, true]) {
    it.each([
      "create",
      "update",
      "delete",
    ] as const)(`%s: redacts ${asError ? "Error-derived" : "plain"} provider failure without mutating it`, async (operation) => {
      const error = failure(asError);
      const snapshot = JSON.stringify(error);
      const service = BuildCalendarService(credential);
      mocks.insert.mockRejectedValue(error);
      mocks.update.mockRejectedValue(error);
      mocks.delete.mockRejectedValue(error);
      const actions = {
        create: () => service.createEvent(event, credential.id),
        update: () => service.updateEvent("synthetic", event, "primary"),
        delete: () => service.deleteEvent("synthetic", event, "primary"),
      };
      await expect(actions[operation]()).rejects.toBe(error);
      if (operation === "create")
        expect(await createEvent(credential, event)).toMatchObject({
          success: false,
          calError: "LEGACY_CAL_ERROR",
        });
      else if (operation === "update")
        expect(await updateEvent(credential, event, "synthetic", "primary")).toMatchObject({
          success: false,
          calError: "LEGACY_CAL_ERROR",
        });
      else await expect(deleteEvent({ credential, bookingRefUid: "synthetic", event })).rejects.toBe(error);
      expect(JSON.stringify(error)).toBe(snapshot);
      expectSafeLogs();
    });
  }

  it.each([
    false,
    true,
  ])("redacts creation fallback credentials and result payloads (destination=%s)", async (hasDestination) => {
    const destination: DestinationCalendar = {
      id: 1,
      integration: "google_calendar",
      externalId: "primary",
      userId: 1,
      eventTypeId: null,
      credentialId: null,
      delegationCredentialId: null,
      primaryEmail: null,
      customCalendarReminder: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const manager = new EventManager({ credentials: [credential], destinationCalendar: null });
    const result = await manager["createAllCalendarEvents"]({
      ...event,
      destinationCalendar: hasDestination ? [destination] : [],
    });
    expect(result[0].createdEvent).toMatchObject({ id: created.id, description: sentinels[3] });
    expectSafeLogs();
  });

  it("redacts the update credential fallback and raw booking/event payloads", async () => {
    mocks.update.mockRejectedValue(failure(true));
    const manager = new EventManager({ credentials: [credential], destinationCalendar: null });
    const result = await manager["updateAllCalendarEvents"](event, {
      id: 1,
      userId: 1,
      references: [{ uid: "synthetic", type: "google_calendar", meetingPassword: sentinels[2] }],
    });
    expect(result[0]).toMatchObject({ success: false, calError: "LEGACY_CAL_ERROR" });
    expectSafeLogs();
  });

  it("keeps deletion allSettled behavior while redacting the rejection and reference payload", async () => {
    mocks.delete.mockRejectedValue(failure(true));
    const manager = new EventManager({ credentials: [credential], destinationCalendar: null });
    await expect(
      manager.deleteEventsAndMeetings({
        event,
        bookingReferences: [
          { uid: "synthetic", type: "google_calendar", credentialId: 1, meetingPassword: sentinels[2] },
        ],
      })
    ).resolves.toBeUndefined();
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expectSafeLogs();
  });

  it("keeps empty-reference skipping and provider404/410 behavior", async () => {
    await expect(deleteEvent({ credential, bookingRefUid: "", event })).resolves.toEqual({});
    expect(mocks.delete).not.toHaveBeenCalled();
    mocks.insert.mockRejectedValue({ code: 404 });
    expect(await createEvent(credential, event)).toMatchObject({ success: false, calError: undefined });
    mocks.delete.mockRejectedValue({ code: 410 });
    await expect(BuildCalendarService(credential).deleteEvent("synthetic", event)).resolves.toBeUndefined();
    mocks.delete.mockRejectedValue({ code: 404 });
    await expect(BuildCalendarService(credential).deleteEvent("synthetic", event)).resolves.toBeUndefined();
    expectSafeLogs();
  });
});

describe("Google discovery logging", () => {
  const params = {
    dateFrom: event.startTime,
    dateTo: event.endTime,
    selectedCalendars: [
      { externalId: "primary", integration: "google_calendar", credentialId: 1, userId: 1 },
    ],
    mode: "slots" as const,
  };
  for (const asError of [false, true]) {
    it.each(["availability", "timezone availability", "list", "primary"])(
      "redacts %s errors (Error-derived: " + asError + ") and preserves rejection",
      async (operation) => {
        const error = failure(asError);
        const service = createGoogleCalendarServiceWithGoogleType(credential);
        mocks.query.mockRejectedValue(error);
        mocks.primary.mockRejectedValue(error);
        if (operation === "list") mocks.list.mockRejectedValue(error);
        const result =
          operation === "availability"
            ? service.getAvailability(params)
            : operation === "timezone availability"
              ? service.getAvailabilityWithTimeZones?.(params)
              : operation === "list"
                ? service.listCalendars()
                : service.getPrimaryCalendar();
        await expect(result).rejects.toBe(error);
        expectSafeLogs();
      }
    );
  }
  it("keeps discovery error fallback safe for the connected calendars UI", async () => {
    mocks.list.mockRejectedValue(failure(true));
    const result = await getConnectedCalendars(getCalendarCredentials([credential]), []);
    expect(result.connectedCalendars[0].error?.message).toBe("Could not get connected calendars");
    expectSafeLogs();
  });
  it("keeps the conservative busy-time fallback without logging upstream errors", async () => {
    const module = await import("@calcom/features/calendars/lib/getCalendarsEvents");
    vi.mocked(module.default).mockRejectedValueOnce(failure(true));
    const result = await getBusyCalendarTimes(
      [credential],
      event.startTime,
      event.endTime,
      params.selectedCalendars
    );
    expect(result).toMatchObject({ success: false, data: [{ source: "error-placeholder" }] });
    expectSafeLogs();
  });
  it.each([
    "production",
    "development",
  ])("omits credential payloads from availability diagnostics in %s", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    try {
      const module = await vi.importActual<
        typeof import("@calcom/features/calendars/lib/getCalendarsEvents")
      >("@calcom/features/calendars/lib/getCalendarsEvents");
      expect(
        await module.default([credential], event.startTime, event.endTime, params.selectedCalendars, "slots")
      ).toEqual([[]]);
      expect(mocks.getCalendar).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: credential.key }),
        "slots"
      );
      expectSafeLogs();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
