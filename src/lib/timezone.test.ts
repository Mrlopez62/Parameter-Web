import { describe, expect, it } from "vitest";
import {
  BUSINESS_TZ,
  differsFrom,
  formatDate,
  formatTime,
  offsetMs,
  todayIn,
  zonedTimeToUtc,
  zoneAbbreviation,
} from "./timezone";

const HOUR = 3_600_000;

describe("zonedTimeToUtc (Central Time)", () => {
  it("uses CDT (UTC-5) during daylight saving", () => {
    expect(zonedTimeToUtc("2026-10-20", "10:00", BUSINESS_TZ).toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });

  it("uses CST (UTC-6) after daylight saving ends on Nov 1", () => {
    expect(zonedTimeToUtc("2026-11-03", "10:00", BUSINESS_TZ).toISOString()).toBe("2026-11-03T16:00:00.000Z");
  });

  it("handles the days the clocks change", () => {
    // Clocks go back at 2:00 CDT on Sun Nov 1 2026; spring forward at 2:00 CST on Sun Mar 14 2027.
    expect(zonedTimeToUtc("2026-11-01", "09:00", BUSINESS_TZ).toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(zonedTimeToUtc("2027-03-14", "09:00", BUSINESS_TZ).toISOString()).toBe("2027-03-14T14:00:00.000Z");
  });

  it("works for other zones", () => {
    expect(zonedTimeToUtc("2026-10-20", "08:00", "America/Los_Angeles").toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-20", "16:00", "Europe/London").toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });
});

describe("offsetMs", () => {
  it("is -5h in CDT and -6h in CST", () => {
    expect(offsetMs(new Date("2026-10-20T15:00:00Z"), BUSINESS_TZ)).toBe(-5 * HOUR);
    expect(offsetMs(new Date("2026-12-01T15:00:00Z"), BUSINESS_TZ)).toBe(-6 * HOUR);
  });
});

describe("formatting", () => {
  const tuesday10amCdt = new Date("2026-10-20T15:00:00Z");

  it("formats the time and zone name for Central and other zones", () => {
    expect(formatTime(tuesday10amCdt, BUSINESS_TZ)).toBe("10:00 AM");
    expect(zoneAbbreviation(tuesday10amCdt, BUSINESS_TZ)).toBe("CDT");
    expect(zoneAbbreviation(new Date("2026-12-01T16:00:00Z"), BUSINESS_TZ)).toBe("CST");
    expect(formatTime(tuesday10amCdt, "America/Los_Angeles")).toBe("8:00 AM");
    expect(zoneAbbreviation(tuesday10amCdt, "America/Los_Angeles")).toBe("PDT");
  });

  it("formats dates", () => {
    expect(formatDate(tuesday10amCdt, BUSINESS_TZ)).toBe("Tuesday, October 20");
    expect(formatDate(tuesday10amCdt, BUSINESS_TZ, true)).toBe("Tue, Oct 20");
  });

  it("knows when two zones show the same wall-clock time", () => {
    expect(differsFrom(tuesday10amCdt, BUSINESS_TZ, "America/Chicago")).toBe(false);
    expect(differsFrom(tuesday10amCdt, BUSINESS_TZ, "America/Winnipeg")).toBe(false); // also Central
    expect(differsFrom(tuesday10amCdt, BUSINESS_TZ, "America/New_York")).toBe(true);
  });
});

describe("todayIn", () => {
  it("returns the date in the given zone, not the machine's", () => {
    // 3:00 UTC on Oct 15 is still Oct 14 in Chicago.
    const now = new Date("2026-10-15T03:00:00Z");
    expect(todayIn(BUSINESS_TZ, now)).toBe("2026-10-14");
    expect(todayIn("Europe/London", now)).toBe("2026-10-15");
  });
});
