// Checks whether an exact email address exists, via Abstract API. Used by the
// discovery-call form after the free domain checks pass.
//
// Inactive until ABSTRACT_API_KEY is set in Netlify (Project configuration ->
// Environment variables): without it, nothing is sent anywhere and the form
// behaves as before.
//
// POST /api/verify-mailbox  { "email": "sam@example.com" }  ->  { "status": "ok" | "no-mailbox" | "disposable" | "unknown" | "skipped" }
import type { Config, Context } from "@netlify/functions";
import { isEmailSyntaxValid } from "../../src/lib/email-check.ts";
import { verifyMailbox, type MailboxStatus } from "../../src/lib/mailbox-check.ts";

// Best-effort protection for the free monthly quota. In-memory, so it's per
// function instance, but it stops a single visitor or bot from draining it.
const PER_IP_LIMIT = 8;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();
const results = new Map<string, MailboxStatus>();

const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?parameter\.digital$/, /^https:\/\/[a-z0-9-]+\.netlify\.app$/];

const reply = (status: MailboxStatus | "skipped", code = 200) =>
  new Response(JSON.stringify({ status }), {
    status: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

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

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return reply("unknown", 405);

  // Only our own pages may use this (and spend the quota).
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.some((re) => re.test(origin))) return reply("unknown", 403);

  const apiKey = Netlify.env.get("ABSTRACT_API_KEY");
  if (!apiKey) return reply("skipped");

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = String(body?.email ?? "")
    .trim()
    .toLowerCase();
  if (!isEmailSyntaxValid(email) || email.length > 254) return reply("unknown", 400);

  const cached = results.get(email);
  if (cached) return reply(cached);
  if (overLimit(context.ip)) return reply("unknown"); // Fail open: don't block real people.

  const status = await verifyMailbox(email, apiKey, { log: (m) => console.log(m) });
  if (status !== "unknown") results.set(email, status);
  return reply(status);
};

export const config: Config = {
  path: "/api/verify-mailbox",
  // Platform-level limit across all instances: at most 10 checks per minute per visitor.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
