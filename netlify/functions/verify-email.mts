// Checks whether an email domain can receive mail. Used live by the
// discovery-call form. Receives only the domain, never the full address.
// GET /api/verify-email?domain=example.com -> { "status": "ok" | "no-mail" | "disposable" | "invalid" | "unknown" }
import { promises as dns } from "node:dns";
import { isDisposableEmailDomain } from "disposable-email-domains-js";
import { checkDomain, type DomainStatus } from "../../src/lib/email-check.ts";

const LOOKUP_TIMEOUT_MS = 2500;

const resolver = new dns.Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 });

const json = (status: DomainStatus, cacheSeconds: number) =>
  new Response(JSON.stringify({ status }), {
    headers: {
      "Content-Type": "application/json",
      // Cache answers at Netlify's edge, per domain (the query string is part of the cache key).
      "Netlify-CDN-Cache-Control": `public, s-maxage=${cacheSeconds}`,
      "Cache-Control": "no-store",
    },
  });

export default async (req: Request) => {
  const domain = new URL(req.url).searchParams.get("domain")?.trim().toLowerCase() ?? "";
  const status = await checkDomain(domain, {
    resolveMx: (d) => resolver.resolveMx(d),
    resolveAddress: async (d) => {
      const [v4, v6] = await Promise.allSettled([resolver.resolve4(d), resolver.resolve6(d)]);
      const found = [v4, v6].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (found.length > 0) return found;
      // Both failed: surface the A-record error so "not found" vs "timeout" is preserved.
      if (v4.status === "rejected") throw v4.reason;
      return found;
    },
    isDisposable: isDisposableEmailDomain,
  });

  // Don't cache transient failures; cache definite answers for a day.
  return json(status, status === "unknown" ? 0 : 86_400);
};

export const config = { path: "/api/verify-email" };
