/*
 * First-party, cookieless analytics: what the tracker sends, what the track
 * function stores, and how the stats function summarises it.
 *
 * Privacy by construction: an event is a type, a page path, the referring site's
 * hostname, and the ?company= / utm_source values from Parameter's own links.
 * No IP address, user agent, cookie, or visitor ID is ever stored.
 */
import { BUSINESS_TZ } from "./timezone";

export const EVENT_TYPES = ["pageview", "demo_run", "call_requested"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface StoredEvent {
  /** Unix time in milliseconds. */
  t: number;
  type: EventType;
  /** Page path without query string or hash, e.g. "/demo/". */
  path: string;
  /** Referring site's hostname, or null for direct visits and internal navigation. */
  ref: string | null;
  /** Company name from a personalised link or the demo form. */
  company: string | null;
  /** utm_source from a link, e.g. "email". */
  utm: string | null;
}

const OWN_HOSTS = /(^|\.)parameter\.digital$|\.netlify\.app$|^localhost$/;

const clean = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/\p{Cc}/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Validates an untrusted event from the browser. Returns null for anything malformed. */
export function sanitizeEvent(input: unknown, now: number): StoredEvent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const type = EVENT_TYPES.find((t) => t === raw.type);
  const path = clean(raw.path, 200).split(/[?#]/)[0];
  if (!type || !/^\/[\w\-./~%]*$/.test(path)) return null;

  let ref: string | null = null;
  try {
    const host = new URL(clean(raw.referrer, 500)).hostname.toLowerCase();
    if (host && !OWN_HOSTS.test(host)) ref = host.replace(/^www\./, "").slice(0, 100);
  } catch {
    // No referrer, or not a URL: a direct visit.
  }

  const utm = clean(raw.utm, 60).toLowerCase();
  return {
    t: now,
    type,
    path,
    ref,
    company: clean(raw.company, 80) || null,
    utm: /^[\w.-]+$/.test(utm) ? utm : null,
  };
}

const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|scrapy|facebookexternalhit|embedly/i;

/** Obvious automated traffic. Real browsers almost always send a user agent. */
export const isBot = (userAgent: string | null) => !userAgent || BOT_UA.test(userAgent);

/** Calendar day in Central Time ("YYYY-MM-DD"), so days match Joshua's business days. */
export const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

/** The last `days` calendar days in Central Time, oldest first, ending today. */
export function dayRange(days: number, now: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(now - i * 86_400_000);
    if (out.at(-1) !== key) out.push(key);
  }
  // DST shifts can repeat or skip a key near midnight; top up so the range is exact.
  while (out.length < days) out.unshift(dayKey(Date.parse(`${out[0]}T12:00:00Z`) - 86_400_000));
  return out.slice(-days);
}

export interface Ranked {
  key: string;
  count: number;
}

export interface CompanyActivity {
  company: string;
  demoOpens: number;
  demoRuns: number;
  /** Most recent activity, Unix ms. */
  last: number;
}

export interface Summary {
  days: string[];
  totals: { pageviews: number; demoOpens: number; demoRuns: number; callsRequested: number };
  daily: { day: string; pageviews: number }[];
  topPages: Ranked[];
  topReferrers: Ranked[];
  callsByPage: Ranked[];
  companies: CompanyActivity[];
  /** True when the store held more events than the stats function read. */
  truncated: boolean;
}

const isDemoPage = (path: string) => path === "/demo" || path === "/demo/";

const rank = (counts: Map<string, number>, limit = 10): Ranked[] =>
  [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

export function summarize(events: StoredEvent[], days: string[], truncated = false): Summary {
  const inRange = new Set(days);
  const daily = new Map(days.map((d) => [d, 0]));
  const pages = new Map<string, number>();
  const referrers = new Map<string, number>();
  const callPages = new Map<string, number>();
  const companies = new Map<string, CompanyActivity>();
  const totals = { pageviews: 0, demoOpens: 0, demoRuns: 0, callsRequested: 0 };

  const companyEntry = (name: string) => {
    const key = name.toLowerCase();
    let entry = companies.get(key);
    if (!entry) companies.set(key, (entry = { company: name, demoOpens: 0, demoRuns: 0, last: 0 }));
    return entry;
  };

  for (const e of events) {
    const day = dayKey(e.t);
    if (!inRange.has(day)) continue;

    if (e.type === "pageview") {
      totals.pageviews++;
      daily.set(day, (daily.get(day) ?? 0) + 1);
      bump(pages, e.path);
      bump(referrers, e.ref ?? "Direct or unknown");
      if (isDemoPage(e.path) && e.company) {
        totals.demoOpens++;
        const entry = companyEntry(e.company);
        entry.demoOpens++;
        entry.last = Math.max(entry.last, e.t);
      }
    } else if (e.type === "demo_run") {
      totals.demoRuns++;
      if (e.company) {
        const entry = companyEntry(e.company);
        entry.demoRuns++;
        entry.last = Math.max(entry.last, e.t);
      }
    } else {
      totals.callsRequested++;
      bump(callPages, e.path);
    }
  }

  return {
    days,
    totals,
    daily: days.map((day) => ({ day, pageviews: daily.get(day) ?? 0 })),
    topPages: rank(pages),
    topReferrers: rank(referrers),
    callsByPage: rank(callPages),
    companies: [...companies.values()].sort((a, b) => b.last - a.last),
    truncated,
  };
}
