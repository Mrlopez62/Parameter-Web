// Summarised analytics for the private /stats dashboard.
//
// Inactive until STATS_PASSWORD is set in Netlify (Project configuration ->
// Environment variables). The dashboard sends it as a Bearer token.
//
// GET /api/stats?days=30  (Authorization: Bearer <password>)  ->  Summary
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { dayRange, summarize, type StoredEvent } from "../../src/lib/analytics.ts";

// Reading is one request per stored event; past this, the dashboard says the
// numbers are incomplete. Comfortable for a small site; revisit with real traffic.
const MAX_EVENTS = 5000;
const CONCURRENCY = 25;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Hashing both sides first makes the comparison constant-time regardless of length.
const digest = (value: string) => createHash("sha256").update(value).digest();
const passwordMatches = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

export default async (req: Request) => {
  if (req.method !== "GET") return new Response(null, { status: 405 });

  const password = Netlify.env.get("STATS_PASSWORD");
  if (!password) return json({ error: "Stats aren't set up yet: add STATS_PASSWORD in Netlify." }, 503);

  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!given || !passwordMatches(given, password)) return json({ error: "Wrong password." }, 401);

  const requested = Number(new URL(req.url).searchParams.get("days"));
  const days = dayRange(Number.isInteger(requested) && requested >= 1 && requested <= 90 ? requested : 30, Date.now());

  const store = getStore("analytics");
  const keys: string[] = [];
  for (const day of days) {
    const { blobs } = await store.list({ prefix: `${day}/` });
    keys.push(...blobs.map((b) => b.key));
  }
  const truncated = keys.length > MAX_EVENTS;
  const toRead = keys.slice(-MAX_EVENTS);

  const events: StoredEvent[] = [];
  for (let i = 0; i < toRead.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      toRead.slice(i, i + CONCURRENCY).map((key) => store.get(key, { type: "json" }) as Promise<StoredEvent | null>),
    );
    for (const event of batch) if (event) events.push(event);
  }

  return json(summarize(events, days, truncated));
};

export const config: Config = {
  path: "/api/stats",
  // Slows down password guessing.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
