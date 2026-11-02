import { TimeFormat } from "@calcom/lib/timeFormat";
import type { Person } from "@calcom/types/Calendar";
import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { formatCancellationDate } from "./formatCancellationDate";

const person = (locale: string, timeZone = "Europe/Berlin", timeFormat?: TimeFormat): Person => ({
  name: "Synthetic",
  email: "synthetic@example.test",
  timeZone,
  timeFormat,
  language: { locale, translate: i18next.t },
});
const event = {
  startTime: "2026-11-03T13:00:00Z",
  endTime: "2026-11-03T13:30:00Z",
  organizer: person("en", "Europe/London"),
};

describe("cancellation subject date", () => {
  it.each([
    ["en", "2:00 PM - 2:30 PM, Tuesday, November 3, 2026"],
    ["de", "14:00 - 14:30, Dienstag, 3. November 2026"],
    ["it", "14:00 - 14:30, martedì 3 novembre 2026"],
  ])("uses %s date and clock conventions when no format is configured", (locale, expected) => {
    expect(formatCancellationDate(event, person(locale))).toBe(expected);
  });

  it("honors an explicit organizer clock format and a recipient override", () => {
    const configured = { ...event, organizer: person("en", "Europe/London", TimeFormat.TWELVE_HOUR) };
    expect(formatCancellationDate(configured, person("de"))).toBe(
      "2:00 PM - 2:30 PM, Dienstag, 3. November 2026"
    );
    expect(
      formatCancellationDate(configured, person("de", "Europe/Berlin", TimeFormat.TWENTY_FOUR_HOUR))
    ).toBe("14:00 - 14:30, Dienstag, 3. November 2026");
  });

  it("uses the recipient's date across midnight and daylight-saving transitions", () => {
    expect(
      formatCancellationDate(
        { ...event, startTime: "2026-11-03T00:00:00Z", endTime: "2026-11-03T00:30:00Z" },
        person("en", "America/New_York", TimeFormat.TWENTY_FOUR_HOUR)
      )
    ).toBe("19:00 - 19:30, Monday, November 2, 2026");
    expect(
      formatCancellationDate(
        { ...event, startTime: "2026-10-25T00:30:00Z", endTime: "2026-10-25T01:30:00Z" },
        person("de")
      )
    ).toBe("2:30 - 2:30, Sonntag, 25. Oktober 2026");
  });
});
