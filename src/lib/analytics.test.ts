import { describe, expect, it } from "vitest";
import { dayKey, dayRange, isBot, sanitizeEvent, summarize, type StoredEvent } from "./analytics";

// Thursday 5 Nov 2026, 2pm Central (CST, UTC-6).
const NOW = Date.parse("2026-11-05T20:00:00Z");

describe("sanitizeEvent", () => {
  it("keeps only the path, referring host, company, and utm source", () => {
    expect(
      sanitizeEvent(
        {
          type: "pageview",
          path: "/demo/?company=Smith#top",
          referrer: "https://www.google.com/search?q=roofer",
          company: "  Smith   Roofing ",
          utm: "Email",
          ip: "1.2.3.4",
        },
        NOW,
      ),
    ).toEqual({ t: NOW, type: "pageview", path: "/demo/", ref: "google.com", company: "Smith Roofing", utm: "email" });
  });

  it("treats internal navigation and junk referrers as direct", () => {
    for (const referrer of [
      "https://parameter.digital/roofing/",
      "https://deploy-preview-6--x.netlify.app/",
      "nonsense",
      "",
    ]) {
      expect(sanitizeEvent({ type: "pageview", path: "/", referrer }, NOW)?.ref).toBeNull();
    }
  });

  it("rejects unknown types and paths that aren't site paths", () => {
    expect(sanitizeEvent({ type: "purchase", path: "/" }, NOW)).toBeNull();
    expect(sanitizeEvent({ type: "pageview", path: "https://evil.example/" }, NOW)).toBeNull();
    expect(sanitizeEvent({ type: "pageview", path: "/<script>" }, NOW)).toBeNull();
    expect(sanitizeEvent(null, NOW)).toBeNull();
  });

  it("caps long values and drops a malformed utm", () => {
    const e = sanitizeEvent({ type: "demo_run", path: "/demo/", company: "x".repeat(500), utm: "a b<c>" }, NOW);
    expect(e?.company).toHaveLength(80);
    expect(e?.utm).toBeNull();
  });
});

describe("isBot", () => {
  it.each([null, "", "Googlebot/2.1", "Mozilla/5.0 HeadlessChrome/130.0", "curl/8.4.0", "python-requests/2.31"])(
    "flags %j",
    (ua) => expect(isBot(ua)).toBe(true),
  );

  it("lets real browsers through", () => {
    expect(isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
  });
});

describe("dayKey and dayRange", () => {
  it("uses Central Time days", () => {
    expect(dayKey(Date.parse("2026-11-06T03:00:00Z"))).toBe("2026-11-05"); // 9pm CST
  });

  it("returns exactly N consecutive days ending today, across the DST change", () => {
    const days = dayRange(7, NOW);
    expect(days).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
  });
});

describe("summarize", () => {
  const at = (iso: string) => Date.parse(iso);
  const ev = (overrides: Partial<StoredEvent>): StoredEvent => ({
    t: at("2026-11-05T15:00:00Z"),
    type: "pageview",
    path: "/",
    ref: null,
    company: null,
    utm: null,
    ...overrides,
  });

  const days = dayRange(7, NOW);
  const summary = summarize(
    [
      ev({}),
      ev({ path: "/roofing/", ref: "google.com" }),
      ev({ path: "/demo/", company: "Rhino Roofing Co", t: at("2026-11-04T15:00:00Z") }),
      ev({ path: "/demo/", company: "rhino roofing co", t: at("2026-11-05T16:00:00Z") }),
      ev({ type: "demo_run", path: "/demo/", company: "Rhino Roofing Co", t: at("2026-11-05T16:01:00Z") }),
      ev({ type: "call_requested", path: "/roofing/" }),
      ev({ t: at("2026-10-01T15:00:00Z") }), // outside the range
    ],
    days,
  );

  it("totals each event type within the range", () => {
    expect(summary.totals).toEqual({ pageviews: 4, demoOpens: 2, demoRuns: 1, callsRequested: 1 });
  });

  it("has one entry per day, with zeros for quiet days", () => {
    expect(summary.daily.map((d) => d.pageviews)).toEqual([0, 0, 0, 0, 0, 1, 3]);
  });

  it("ranks pages and referrers", () => {
    expect(summary.topPages[0]).toEqual({ key: "/demo/", count: 2 });
    expect(summary.topReferrers).toEqual([
      { key: "Direct or unknown", count: 3 },
      { key: "google.com", count: 1 },
    ]);
    expect(summary.callsByPage).toEqual([{ key: "/roofing/", count: 1 }]);
  });

  it("groups demo activity by company, case-insensitively, most recent first", () => {
    expect(summary.companies).toEqual([
      { company: "Rhino Roofing Co", demoOpens: 2, demoRuns: 1, last: at("2026-11-05T16:01:00Z") },
    ]);
  });

  it("only counts demo opens that carry a company", () => {
    expect(summarize([ev({ path: "/demo/" })], days).totals.demoOpens).toBe(0);
  });
});
