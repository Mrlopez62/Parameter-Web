/*
 * Live email checking for an <input type="email">, in three layers:
 *  1. Typo suggestions, in the browser.
 *  2. /api/verify-email: the domain can receive mail and isn't a throwaway
 *     service. Free; only the domain is sent. Runs while typing.
 *  3. /api/verify-mailbox: the exact mailbox exists (Abstract API, a paid quota).
 *     Runs only on blur or submit, once the domain has passed, and only if the
 *     site has an API key configured (otherwise the endpoint answers "skipped").
 *
 * Fails open: if the check can't run (offline, timeout, local dev without the
 * function), the address is accepted so real enquiries are never blocked.
 */
import { emailDomain, isEmailSyntaxValid, suggestEmail, type DomainStatus } from "../lib/email-check";

const ENDPOINT = "/api/verify-email";
const MAILBOX_ENDPOINT = "/api/verify-mailbox";
const DEBOUNCE_MS = 600;
const REQUEST_TIMEOUT_MS = 4000;

type MailboxStatus = "ok" | "no-mailbox" | "disposable" | "unknown" | "skipped";

const MESSAGES: Partial<Record<DomainStatus | MailboxStatus, string>> = {
  "no-mail": "This email domain can't receive mail. Please check the address.",
  "no-mailbox": "We couldn't find this mailbox. Please check the address.",
  disposable: "Please use a permanent email address so we can reply to you.",
};

export interface EmailVerifier {
  /** Finishes any pending check; resolves false if the address should block submit. */
  ensureChecked(): Promise<boolean>;
}

export function attachEmailVerification(input: HTMLInputElement, statusEl: HTMLElement): EmailVerifier {
  const cache = new Map<string, Promise<DomainStatus>>();
  const mailboxCache = new Map<string, Promise<MailboxStatus>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<boolean> | null = null;
  let checkedKey = "";

  const lookup = (domain: string) => {
    if (!cache.has(domain)) {
      const status = fetch(`${ENDPOINT}?domain=${encodeURIComponent(domain)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
        .then((res) => (res.ok ? res.json() : { status: "unknown" }))
        .then((body: { status?: DomainStatus }) => body.status ?? "unknown")
        .catch((): DomainStatus => "unknown");
      // Don't keep failures cached, so a later attempt can succeed.
      status.then((s) => s === "unknown" && cache.delete(domain));
      cache.set(domain, status);
    }
    return cache.get(domain)!;
  };

  const lookupMailbox = (email: string) => {
    const key = email.toLowerCase();
    if (!mailboxCache.has(key)) {
      const status = fetch(MAILBOX_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: key }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + 1000),
      })
        .then((res) => (res.ok ? res.json() : { status: "unknown" }))
        .then((body: { status?: MailboxStatus }) => body.status ?? "unknown")
        .catch((): MailboxStatus => "unknown");
      status.then((s) => s === "unknown" && mailboxCache.delete(key));
      mailboxCache.set(key, status);
    }
    return mailboxCache.get(key)!;
  };

  function render(kind: "idle" | "checking" | "ok" | "error" | "suggest", message = "", suggestion?: string) {
    statusEl.dataset.state = kind;
    statusEl.replaceChildren();
    if (kind === "idle") return;
    if (kind === "suggest" && suggestion) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = suggestion;
      button.className = "font-medium text-fg underline underline-offset-2 hover:text-brand-soft";
      button.addEventListener("click", () => {
        input.value = suggestion;
        input.focus();
        void run(false);
      });
      statusEl.append(`${message ? message + " " : ""}Did you mean `, button, "?");
      return;
    }
    statusEl.textContent = message;
  }

  function block(message: string) {
    input.setCustomValidity(message);
    render("error", message);
    return false;
  }

  async function check(value: string, full: boolean): Promise<boolean> {
    input.setCustomValidity("");
    if (!isEmailSyntaxValid(value)) {
      render("idle"); // The browser's own type="email" validation handles format.
      return true;
    }

    const suggestion = suggestEmail(value);
    render("checking", "Checking email…");
    const status = await lookup(emailDomain(value)!);
    if (input.value.trim() !== value) return true; // The user kept typing; a newer check will run.

    const blockMessage = MESSAGES[status];
    if (blockMessage) {
      input.setCustomValidity(
        suggestion ? `Please check your email address. Did you mean ${suggestion}?` : blockMessage,
      );
      if (suggestion) render("suggest", "", suggestion);
      else render("error", blockMessage);
      return false;
    }
    if (suggestion) {
      render("suggest", "", suggestion);
      return true;
    }
    if (status !== "ok") {
      render("idle"); // "unknown" or "invalid": stay quiet and let it through.
      return true;
    }

    // Domain is fine. On blur/submit, also ask whether this exact mailbox exists.
    if (full) {
      render("checking", "Checking email…");
      const mailbox = await lookupMailbox(value);
      if (input.value.trim() !== value) return true;
      const mailboxMessage = MESSAGES[mailbox];
      if (mailboxMessage) return block(mailboxMessage);
      render("ok", mailbox === "ok" ? "✓ Email verified" : "✓ Email looks good");
      return true;
    }
    render("ok", "✓ Email looks good");
    return true;
  }

  /** `full` adds the mailbox check (blur and submit only, so partial typing never spends quota). */
  function run(full = true) {
    clearTimeout(timer);
    const value = input.value.trim();
    const key = `${full}:${value}`;
    if ((key === checkedKey || `true:${value}` === checkedKey) && current) return current;
    checkedKey = key;
    current = check(value, full);
    return current;
  }

  input.addEventListener("input", () => {
    input.setCustomValidity("");
    clearTimeout(timer);
    if (statusEl.dataset.state !== "idle") render("idle");
    timer = setTimeout(() => run(false), DEBOUNCE_MS);
  });
  input.addEventListener("blur", () => void run());

  render("idle");
  return { ensureChecked: () => run() };
}
