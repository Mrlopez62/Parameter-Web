import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFile, outlookCalendarUrl, type CalendarEvent } from "./calendar";

const event: CalendarEvent = {
  title: "Discovery call with Parameter (requested)",
  description: "Line one, with comma; and semicolon\nLine two",
  location: "Video call",
  start: new Date("2026-10-20T15:00:00Z"),
  end: new Date("2026-10-20T15:30:00Z"),
  organizerEmail: "hello@parameter.digital",
};

describe("googleCalendarUrl", () => {
  const url = new URL(googleCalendarUrl(event));

  it("builds a Google Calendar template link", () => {
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
  });

  it("uses compact UTC start/end times", () => {
    expect(url.searchParams.get("dates")).toBe("20261020T150000Z/20261020T153000Z");
  });

  it("passes the event details through", () => {
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("details")).toBe(event.description);
    expect(url.searchParams.get("location")).toBe("Video call");
  });

  it("encodes spaces as %20, not +", () => {
    expect(googleCalendarUrl(event)).toContain("Discovery%20call");
    expect(googleCalendarUrl(event)).not.toContain("+");
  });

  it("keeps a literal + in the content", () => {
    const url = new URL(googleCalendarUrl({ ...event, title: "C++ review" }));
    expect(url.searchParams.get("text")).toBe("C++ review");
  });
});

describe("outlookCalendarUrl", () => {
  it("defaults to Outlook.com", () => {
    expect(outlookCalendarUrl(event)).toMatch(/^https:\/\/outlook\.live\.com\/calendar\/0\/action\/compose\?/);
  });

  it("supports Microsoft 365", () => {
    expect(outlookCalendarUrl(event, "outlook.office.com")).toMatch(/^https:\/\/outlook\.office\.com\//);
  });

  it("uses ISO start/end times and the event details", () => {
    const url = new URL(outlookCalendarUrl(event));
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("startdt")).toBe("2026-10-20T15:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-10-20T15:30:00.000Z");
    expect(url.searchParams.get("subject")).toBe(event.title);
    expect(url.searchParams.get("body")).toBe(event.description);
  });
});

describe("icsFile", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  const ics = icsFile(event, "abc@parameter.digital", now);
  const lines = ics.split("\r\n");

  it("is a single VEVENT inside a VCALENDAR, with CRLF line endings", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("includes the required properties", () => {
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("UID:abc@parameter.digital");
    expect(lines).toContain("DTSTAMP:20261014T000000Z");
    expect(lines).toContain("DTSTART:20261020T150000Z");
    expect(lines).toContain("DTEND:20261020T153000Z");
  });

  it("marks the event as tentative and sets the organizer", () => {
    expect(lines).toContain("STATUS:TENTATIVE");
    expect(lines).toContain("ORGANIZER:mailto:hello@parameter.digital");
  });

  it("escapes commas, semicolons, backslashes, and newlines in text", () => {
    const escaped = icsFile({ ...event, description: "a,b;c\\d\ne" }, "x", now);
    expect(escaped).toContain("DESCRIPTION:a\\,b\\;c\\\\d\\ne");
  });

  it("omits optional properties when they're not set", () => {
    const minimal = icsFile({ ...event, location: undefined, organizerEmail: undefined }, "x", now);
    expect(minimal).not.toContain("LOCATION:");
    expect(minimal).not.toContain("ORGANIZER:");
  });

  it("folds lines longer than 75 octets without splitting multi-byte characters", () => {
    const long = icsFile({ ...event, description: "é".repeat(100) + " — done" }, "x", now);
    const physical = long.split("\r\n");
    const encoder = new TextEncoder();

    for (const line of physical) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    // Continuation lines start with a single space; unfolding restores the original text.
    const unfolded = long.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:" + "é".repeat(100) + " — done");
    expect(physical.join("")).not.toContain("�");
  });
});
