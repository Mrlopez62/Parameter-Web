/*
 * Email checks for the discovery-call form.
 *
 * Without sending an email there's no reliable way to prove a mailbox exists, so
 * we catch the common real-world problems instead:
 *  - syntax (client)
 *  - typos in well-known domains, e.g. gmial.com -> gmail.com (client)
 *  - domains that can't receive email: no DNS, no MX/A, or a null MX (server)
 *  - disposable/throwaway email services (server)
 *
 * The server check only ever receives the domain, never the full address.
 */

/** Pragmatic syntax check: something@something.tld, no spaces, one @. */
export function isEmailSyntaxValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(email.trim());
}

/** The domain part of an address, lowercased, or null if there isn't one. */
export function emailDomain(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const domain = email
    .trim()
    .slice(at + 1)
    .toLowerCase();
  return domain || null;
}

// Popular mailbox providers and the TLDs most often mistyped.
const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  // Real providers that are a letter or two away from the big ones (mail.com vs
  // gmail.com): listed so they're recognised instead of "corrected".
  "mail.com",
  "email.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "yahoo.co.uk",
  "hotmail.co.uk",
  "live.co.uk",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
];
const TLD_FIXES: Record<string, string> = {
  con: "com",
  cmo: "com",
  ocm: "com",
  vom: "com",
  comm: "com",
  nte: "net",
  ner: "net",
  ogr: "org",
};

function editDistance(a: string, b: string): number {
  // Optimal string alignment distance: insert, delete, substitute, swap neighbours.
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Suggests a corrected address when the domain looks like a typo of a popular
 * provider ("gmial.com") or has a mistyped TLD ("company.con"). Returns null when
 * there's nothing to suggest. A suggestion is advisory only: never blocks submit.
 */
export function suggestEmail(email: string): string | null {
  const domain = emailDomain(email);
  if (!domain || COMMON_DOMAINS.includes(domain)) return null;
  const local = email.trim().slice(0, email.trim().lastIndexOf("@"));

  let best: { domain: string; distance: number } | null = null;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance <= 2 && distance < (best?.distance ?? Infinity)) best = { domain: candidate, distance };
  }
  // Only trust distance 2 for longer names, so short real domains aren't "corrected".
  if (best && (best.distance === 1 || domain.length >= 8)) return `${local}@${best.domain}`;

  const dot = domain.lastIndexOf(".");
  const fixedTld = TLD_FIXES[domain.slice(dot + 1)];
  if (dot > 0 && fixedTld) return `${local}@${domain.slice(0, dot)}.${fixedTld}`;

  return null;
}

/** RFC 1035-ish hostname check, applied before any DNS lookup. */
export function isValidDomain(domain: string): boolean {
  return (
    domain.length <= 253 &&
    /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/i.test(domain)
  );
}

export type DomainStatus = "ok" | "no-mail" | "disposable" | "invalid" | "unknown";

export interface DomainCheckDeps {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  /** Resolves A/AAAA records; RFC 5321 falls back to these when there's no MX. */
  resolveAddress(domain: string): Promise<string[]>;
  isDisposable(domain: string): boolean;
}

/** DNS error codes that mean "this name has no such records", not "lookup failed". */
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
const isNotFound = (err: unknown) => NOT_FOUND.has((err as { code?: string })?.code ?? "");

/**
 * Classifies whether `domain` can receive email.
 *  - "invalid": not a hostname
 *  - "disposable": a throwaway email service (or a subdomain of one)
 *  - "no-mail": doesn't exist, has a null MX (RFC 7505), or has neither MX nor A/AAAA
 *  - "ok": has MX, or A/AAAA as the implicit MX
 *  - "unknown": DNS failed for another reason (timeouts etc.): callers should allow it
 */
export async function checkDomain(domain: string, deps: DomainCheckDeps): Promise<DomainStatus> {
  domain = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!isValidDomain(domain)) return "invalid";

  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (deps.isDisposable(labels.slice(i).join("."))) return "disposable";
  }

  try {
    const mx = await deps.resolveMx(domain);
    const usable = mx.filter((r) => r.exchange && r.exchange !== ".");
    if (usable.length > 0) return "ok";
    if (mx.length > 0) return "no-mail"; // Null MX: the domain explicitly accepts no email.
  } catch (err) {
    if (!isNotFound(err)) return "unknown";
  }

  try {
    return (await deps.resolveAddress(domain)).length > 0 ? "ok" : "no-mail";
  } catch (err) {
    return isNotFound(err) ? "no-mail" : "unknown";
  }
}
