import fs from "node:fs";
import { TimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { decodeHTML } from "entities";
import i18next from "i18next";
import type { SendMailOptions } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async (_mail: SendMailOptions) => ({})) }));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    async checkIfFeatureIsEnabledGlobally() {
      return false;
    }
  },
}));
vi.mock("@calcom/lib/emailTransport", () => ({ createEmailTransport: () => ({ sendMail }) }));
vi.mock("@calcom/lib/serverConfig", () => ({
  serverConfig: { transport: {}, from: "sender@example.test", headers: {} },
}));
vi.mock("../sms/sms-manager", () => ({
  default: class {
    async sendSMSToAttendees() {}
  },
}));

import { sendCancelledEmailsAndSMS } from "./email-manager";

const cases = {
  en: {
    eventType: "Free Audit",
    title: "Free Audit between Synthetic Host and Synthetic Guest",
    prefix: "Canceled:",
    body: "Your scheduled event was canceled",
    date: "Tuesday, November 3, 2026",
  },
  de: {
    eventType: "Kostenloser Prozess-Check",
    title: "Kostenloser Prozess-Check zwischen Synthetic Host und Synthetic Guest",
    prefix: "Abgesagt:",
    body: "Ihr geplanter Termin wurde abgesagt",
    date: "Dienstag, 3. November 2026",
  },
  it: {
    eventType: "Audit gratuito",
    title: "Audit gratuito tra Synthetic Host e Synthetic Guest",
    prefix: "Cancellato:",
    body: "Il tuo evento programmato è stato cancellato",
    date: "martedì 3 novembre 2026",
  },
} as const;
type Locale = keyof typeof cases;

async function translate(locale: Locale) {
  const instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: false,
    defaultNS: "common",
    resources: {
      [locale]: {
        common: JSON.parse(
          fs.readFileSync(new URL(`../i18n/locales/${locale}/common.json`, import.meta.url), "utf8")
        ),
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(locale, "common");
}

async function storedBooking(locale: Locale): Promise<CalendarEvent> {
  const organizer: Person = {
    name: "Synthetic Host",
    email: "host@example.test",
    timeZone: "Europe/London",
    language: { locale: "en", translate: await translate("en") },
    timeFormat: TimeFormat.TWENTY_FOUR_HOUR,
  };
  const attendee: Person = {
    name: "Synthetic Guest",
    email: "guest@example.test",
    timeZone: "Europe/Berlin",
    language: { locale, translate: await translate(locale) },
  };
  return {
    // Cancellation receives the organizer's composed stored title and an event slug.
    type: `free-audit-${locale}`,
    title: `${cases[locale].eventType} between Synthetic Host and Synthetic Guest`,
    organizer,
    attendees: [attendee],
    length: 30,
    startTime: "2026-11-03T13:00:00.000Z",
    endTime: "2026-11-03T13:30:00.000Z",
    uid: `synthetic-${locale}`,
    iCalUID: `synthetic-${locale}@example.test`,
    iCalSequence: 1,
    bookerUrl: "https://booking.example.test",
    hideBranding: true,
    location: "https://meeting.example.test/synthetic",
    cancellationReason: "Synthetic cancellation",
  };
}

function attendeeMail() {
  const payload = sendMail.mock.calls.find(
    ([mail]) => mail.to === "Synthetic Guest <guest@example.test>"
  )?.[0];
  expect(payload).toBeDefined();
  if (!payload) throw new Error("Attendee cancellation was not sent");
  return payload;
}

beforeEach(() => {
  sendMail.mockClear();
  vi.stubEnv("INTEGRATION_TEST_MODE", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("cancellation dispatch from a stored booking", () => {
  for (const locale of ["en", "de", "it"] as const) {
    it(`${locale}: composes the original event title once through real rendering and ICS`, async () => {
      const event = await storedBooking(locale);
      const storedTitle = event.title;
      await sendCancelledEmailsAndSMS(event, { eventName: null, eventType: cases[locale].eventType });
      expect(sendMail).toHaveBeenCalledTimes(2);
      const payload = attendeeMail();
      expect(payload.subject).toBe(
        `${cases[locale].prefix} ${cases[locale].title} ${{ en: "at", de: "am", it: "il" }[locale]} 14:00 - 14:30, ${cases[locale].date}`
      );
      const html = decodeHTML(String(payload.html));
      expect(html.match(/<title>(.*?)<\/title>/s)?.[1]).toBe(payload.subject);
      expect(html).toContain(cases[locale].title);
      expect(html).toContain(cases[locale].body);
      const when = html.match(/<span data-testid="when">(.*?)<\/span>/s)?.[1].replace(/<[^>]*>/g, "");
      expect(when).toContain("14:00 - 14:30");
      expect(payload.text).toContain(cases[locale].body);
      expect(payload.text).toContain(cases[locale].title);
      const ical = payload.icalEvent;
      expect(ical).toMatchObject({ filename: "event.ics", method: "CANCEL" });
      if (!ical || typeof ical !== "object" || !("content" in ical))
        throw new Error("Missing calendar content");
      const unfolded = String(ical.content).replace(/\r?\n[ \t]/g, "");
      expect(unfolded).toContain(`SUMMARY:${cases[locale].title}`);
      for (const marker of [
        "METHOD:CANCEL",
        "STATUS:CANCELLED",
        "SEQUENCE:1",
        `UID:${event.iCalUID}`,
        "DTSTART:20261103T130000Z",
        "DTEND:20261103T133000Z",
      ])
        expect(unfolded).toContain(marker);
      const mime = await new MailComposer(payload).compile().build();
      expect(mime.toString()).toContain("Content-Type: text/calendar");
      expect(mime.toString()).toContain("filename=event.ics");
      expect(event.title).toBe(storedTitle);
      const organizerMail = sendMail.mock.calls.find(([mail]) => mail.to === "host@example.test")?.[0];
      expect(organizerMail?.subject).toBe(
        `Canceled: ${storedTitle} at 13:00 - 13:30, Tuesday, November 3, 2026`
      );
      expect(decodeHTML(String(organizerMail?.html)).match(/<title>(.*?)<\/title>/s)?.[1]).toBe(
        organizerMail?.subject
      );
    });
  }

  it("preserves the configured custom naming template and booking fields", async () => {
    const event = await storedBooking("de");
    event.responses = { topic: { label: "Topic", value: "Größe prüfen" } };
    await sendCancelledEmailsAndSMS(event, {
      eventType: cases.de.eventType,
      eventName: "{Event type title} / {Scheduler} / {topic}",
    });
    expect(attendeeMail().subject).toContain("Kostenloser Prozess-Check / Synthetic Guest / Größe prüfen");
    expect(attendeeMail().subject).not.toContain("between");
  });

  it("keeps the stored title intact when its event type was deleted", async () => {
    const event = await storedBooking("it");
    await sendCancelledEmailsAndSMS(event, { eventName: undefined, eventType: undefined });
    expect(attendeeMail().subject).toContain(`Cancellato: ${event.title} il`);
    expect(String(attendeeMail().subject).match(/Synthetic Guest/g)).toHaveLength(1);
  });
});
