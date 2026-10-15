/*
 * Mailbox-level verification ("does this exact address exist?") via Abstract
 * API. Runs server-side only, in the verify-mailbox Netlify Function, after the
 * free domain checks have passed.
 *
 * Abstract has two products with separate API keys: the current Email
 * Reputation API and the older Email Validation API. We try Reputation first
 * and fall back to Validation if the key is rejected (a 401 costs no credit),
 * then remember which one works.
 *
 * Only a definite "this mailbox doesn't exist" blocks the form. Full inboxes,
 * catch-all domains, unknown results, exhausted quota, or any error let the
 * address through, so real leads are never lost.
 */

export type MailboxStatus = "ok" | "no-mailbox" | "disposable" | "unknown";

/** Fields we use from the Email Reputation API (emailreputation.abstractapi.com). */
export interface ReputationResponse {
  email_deliverability?: { status?: string; status_detail?: string };
  email_quality?: { is_disposable?: boolean };
}

/** Fields we use from the older Email Validation API (emailvalidation.abstractapi.com). */
export interface ValidationResponse {
  deliverability?: string;
  is_disposable_email?: { value?: boolean };
}

// "undeliverable" details that mean the address really can't receive mail.
// full_mailbox (a real person with a full inbox) and unavailable_server
// (possibly temporary) are deliberately allowed.
const DEAD_ADDRESS = new Set(["invalid_mailbox", "invalid_format", "dns_record_not_found"]);

export function classifyReputationResponse(body: ReputationResponse): MailboxStatus {
  if (body.email_quality?.is_disposable === true) return "disposable";
  const { status, status_detail } = body.email_deliverability ?? {};
  if (status === "deliverable") return "ok";
  if (status === "undeliverable" && DEAD_ADDRESS.has(status_detail ?? "")) return "no-mailbox";
  return "unknown";
}

export function classifyValidationResponse(body: ValidationResponse): MailboxStatus {
  if (body.is_disposable_email?.value === true) return "disposable";
  if (body.deliverability === "UNDELIVERABLE") return "no-mailbox";
  if (body.deliverability === "DELIVERABLE") return "ok";
  return "unknown"; // RISKY (e.g. catch-all) or UNKNOWN: allow.
}

export const PROVIDERS = [
  {
    name: "reputation",
    endpoint: "https://emailreputation.abstractapi.com/v1/",
    classify: (body: unknown) => classifyReputationResponse(body as ReputationResponse),
  },
  {
    name: "validation",
    endpoint: "https://emailvalidation.abstractapi.com/v1/",
    classify: (body: unknown) => classifyValidationResponse(body as ValidationResponse),
  },
] as const;

type ProviderName = (typeof PROVIDERS)[number]["name"];

/** Which Abstract product the configured key belongs to, once discovered. */
let workingProvider: ProviderName | null = null;

/** For tests. */
export function resetProviderCache() {
  workingProvider = null;
}

export interface VerifyOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Receives non-sensitive diagnostics (provider and HTTP status, never the key or address). */
  log?: (message: string) => void;
}

/** Calls Abstract; any failure (network, bad key, quota, rate limit) becomes "unknown". */
export async function verifyMailbox(
  email: string,
  apiKey: string,
  options: VerifyOptions = {},
): Promise<MailboxStatus> {
  const { fetchImpl = fetch, timeoutMs = 4000, log = () => {} } = options;
  const candidates = workingProvider ? PROVIDERS.filter((p) => p.name === workingProvider) : PROVIDERS;

  for (const provider of candidates) {
    const url = `${provider.endpoint}?${new URLSearchParams({ api_key: apiKey, email })}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      log(`abstract ${provider.name}: request failed (${(err as Error)?.name ?? "error"})`);
      return "unknown";
    }

    if (res.status === 401) {
      log(`abstract ${provider.name}: 401, key not valid for this API`);
      continue; // The key may belong to the other Abstract product.
    }
    if (!res.ok) {
      log(`abstract ${provider.name}: HTTP ${res.status}`);
      return "unknown"; // Quota (422/403), rate limit (429), outage: fail open.
    }

    workingProvider = provider.name;
    try {
      return provider.classify(await res.json());
    } catch {
      log(`abstract ${provider.name}: unparsable response`);
      return "unknown";
    }
  }
  return "unknown";
}
