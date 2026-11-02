import { TimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

export function getCancellationTimeFormat(
  event: Pick<CalendarEvent, "organizer">,
  recipient: Pick<Person, "language" | "timeFormat">
): TimeFormat {
  const configured = recipient.timeFormat ?? event.organizer.timeFormat;
  if (configured) return configured;
  const { hourCycle } = new Intl.DateTimeFormat(recipient.language.locale || "en", {
    hour: "numeric",
  }).resolvedOptions();
  return hourCycle === "h11" || hourCycle === "h12" ? TimeFormat.TWELVE_HOUR : TimeFormat.TWENTY_FOUR_HOUR;
}

export function formatCancellationDate(
  event: Pick<CalendarEvent, "startTime" | "endTime" | "organizer">,
  recipient: Pick<Person, "language" | "timeZone" | "timeFormat">
) {
  const locale = recipient.language.locale || "en";
  const timeFormat = getCancellationTimeFormat(event, recipient);
  const timeOptions: Intl.DateTimeFormatOptions = {
    timeZone: recipient.timeZone,
    hour: "numeric",
    minute: "2-digit",
  };
  if (timeFormat === TimeFormat.TWELVE_HOUR) timeOptions.hour12 = true;
  else if (timeFormat === TimeFormat.TWENTY_FOUR_HOUR) timeOptions.hourCycle = "h23";
  const time = new Intl.DateTimeFormat(locale, timeOptions);
  const date = new Intl.DateTimeFormat(locale, { timeZone: recipient.timeZone, dateStyle: "full" });
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  return `${time.format(start)} - ${time.format(end)}, ${date.format(start)}`;
}
