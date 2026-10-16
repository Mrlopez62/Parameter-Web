/*
 * Time zone helpers for the discovery-call picker. Bookable slots are Parameter's
 * business hours in Central Time; visitors elsewhere also see their local time.
 * Uses Intl only (no library), so it handles daylight saving (CDT <-> CST).
 */

/** Parameter's business time zone. Shows as CDT in summer and CST in winter. */
export const BUSINESS_TZ = "America/Chicago";

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock parts of `instant` in `timeZone`. */
function partsIn(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (e.g. -5h for CDT). */
export function offsetMs(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The exact instant of wall-clock `date` ("YYYY-MM-DD") `time` ("HH:MM") in `timeZone`. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes: the first offset guess can be off by an hour near a DST change.
  let instant = new Date(naive - offsetMs(new Date(naive), timeZone));
  instant = new Date(naive - offsetMs(instant, timeZone));
  return instant;
}

/** Today's date ("YYYY-MM-DD") in `timeZone`. */
export function todayIn(timeZone: string, now = new Date()): string {
  const p = partsIn(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "10:00 AM" */
export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}

/** Short zone name at that instant, e.g. "CDT", "CST", "PDT", or "GMT+1" where no abbreviation exists. */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone
  );
}

/** "Tuesday, October 20" (or "Tue, Oct 20" with `short`). */
export function formatDate(instant: Date, timeZone: string, short = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: short ? "short" : "long",
    month: short ? "short" : "long",
    day: "numeric",
  }).format(instant);
}

/** True when two zones show a different wall-clock time at `instant`. */
export function differsFrom(instant: Date, a: string, b: string): boolean {
  return offsetMs(instant, a) !== offsetMs(instant, b);
}
