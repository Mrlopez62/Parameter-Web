// Receives cookieless analytics events from the site's tracker and stores each
// one in Netlify Blobs under its Central Time day. Stores no IP address, user
// agent, or visitor ID (see src/lib/analytics.ts).
//
// POST /api/track  { type, path, referrer, company, utm }  ->  204
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { dayKey, isBot, sanitizeEvent } from "../../src/lib/analytics.ts";

// Best-effort per-visitor limit (per function instance). The IP is used only
// for this in-memory count and is never stored.
const PER_IP_LIMIT = 120;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

const OUR_SITE = /^https:\/\/((www\.)?parameter\.digital|[a-z0-9-]+\.netlify\.app)$/;

function fromOurSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return OUR_SITE.test(origin);
  // Some browsers omit Origin on beacons; fall back to the referring page.
  try {
    return OUR_SITE.test(new URL(req.headers.get("referer") ?? "").origin);
  } catch {
    return false;
  }
}

function overLimit(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > PER_IP_LIMIT;
}

const accepted = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!fromOurSite(req)) return new Response(null, { status: 403 });

  // Bots and over-limit visitors get the same quiet 204, so there's nothing to probe.
  if (isBot(req.headers.get("user-agent")) || overLimit(context.ip)) return accepted();

  const text = await req.text().catch(() => "");
  if (text.length > 2000) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const event = sanitizeEvent(body, Date.now());
  if (!event) return new Response(null, { status: 400 });

  try {
    const store = getStore("analytics");
    await store.setJSON(`${dayKey(event.t)}/${event.t}-${crypto.randomUUID()}`, event);
  } catch (err) {
    console.log(`track: store unavailable (${(err as Error)?.name ?? "error"})`);
  }
  return accepted();
};

export const config: Config = {
  path: "/api/track",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
