/*
 * "Add to calendar" helpers for the discovery-call request form.
 * Builds links for Google Calendar and Outlook, and an .ics file for
 * Apple Calendar and anything else that imports iCalendar.
 */

export interface CalendarEvent {
  title: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
  organizerEmail?: string;
}

/** URLSearchParams encodes spaces as "+", which Outlook shows literally; use %20. */
function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString().replace(/\+/g, "%20");
}

/** 2026-10-14T15:30:00.000Z -> 20261014T153000Z */
function toCompactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = query({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toCompactUtc(event.start)}/${toCompactUtc(event.end)}`,
    details: event.description,
    location: event.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** `host` is outlook.live.com for personal accounts, outlook.office.com for Microsoft 365. */
export function outlookCalendarUrl(
  event: CalendarEvent,
  host: "outlook.live.com" | "outlook.office.com" = "outlook.live.com",
): string {
  const params = query({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    body: event.description,
    location: event.location ?? "",
  });
  return `https://${host}/calendar/0/action/compose?${params}`;
}

/** Escapes text values per RFC 5545 section 3.3.11. */
function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds content lines longer than 75 octets per RFC 5545 section 3.1. */
function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = 74; // Continuation lines start with a space.
  }
  return parts.join("\r\n ");
}

export function icsFile(event: CalendarEvent, uid: string, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Parameter//Discovery call//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toCompactUtc(now)}`,
    `DTSTART:${toCompactUtc(event.start)}`,
    `DTEND:${toCompactUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    ...(event.organizerEmail ? [`ORGANIZER:mailto:${event.organizerEmail}`] : []),
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
