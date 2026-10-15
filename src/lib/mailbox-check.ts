/*
 * Mailbox-level verification ("does this exact address exist?") via Abstract
 * API's email validation endpoint. Runs server-side only, in the
 * verify-mailbox Netlify Function, after the free domain checks have passed.
 *
 * Only a definite "undeliverable" blocks the form. Risky, catch-all, unknown,
 * quota exhausted, or any error lets the address through, so real leads are
 * never lost.
 */

export type MailboxStatus = "ok" | "no-mailbox" | "disposable" | "unknown";

/** The fields we use from Abstract's email validation response. */
export interface AbstractEmailResponse {
  deliverability?: "DELIVERABLE" | "UNDELIVERABLE" | "RISKY" | "UNKNOWN" | string;
  is_disposable_email?: { value?: boolean };
}

export function classifyAbstractResponse(body: AbstractEmailResponse): MailboxStatus {
  if (body.is_disposable_email?.value === true) return "disposable";
  if (body.deliverability === "UNDELIVERABLE") return "no-mailbox";
  if (body.deliverability === "DELIVERABLE") return "ok";
  return "unknown"; // RISKY (e.g. catch-all) or UNKNOWN: allow.
}

export const ABSTRACT_ENDPOINT = "https://emailvalidation.abstractapi.com/v1/";

/** Calls Abstract; any failure (network, 401 bad key, 429 quota) becomes "unknown". */
export async function verifyMailbox(
  email: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<MailboxStatus> {
  const url = `${ABSTRACT_ENDPOINT}?${new URLSearchParams({ api_key: apiKey, email })}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return "unknown";
    return classifyAbstractResponse((await res.json()) as AbstractEmailResponse);
  } catch {
    return "unknown";
  }
}
