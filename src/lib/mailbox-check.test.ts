import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyReputationResponse,
  classifyValidationResponse,
  PROVIDERS,
  resetProviderCache,
  verifyMailbox,
} from "./mailbox-check";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const REPUTATION = PROVIDERS[0].endpoint;
const VALIDATION = PROVIDERS[1].endpoint;

describe("classifyReputationResponse (Email Reputation API)", () => {
  it.each([
    [{ email_deliverability: { status: "deliverable", status_detail: "valid_email" } }, "ok"],
    [{ email_deliverability: { status: "undeliverable", status_detail: "invalid_mailbox" } }, "no-mailbox"],
    [{ email_deliverability: { status: "undeliverable", status_detail: "dns_record_not_found" } }, "no-mailbox"],
    [{ email_deliverability: { status: "undeliverable", status_detail: "invalid_format" } }, "no-mailbox"],
    // A real person with a full inbox, or a server that may be down: allow.
    [{ email_deliverability: { status: "undeliverable", status_detail: "full_mailbox" } }, "unknown"],
    [{ email_deliverability: { status: "undeliverable", status_detail: "unavailable_server" } }, "unknown"],
    [{ email_deliverability: { status: "unknown" } }, "unknown"],
    [{}, "unknown"],
    [{ email_deliverability: { status: "deliverable" }, email_quality: { is_disposable: true } }, "disposable"],
  ] as const)("%j -> %s", (body, expected) => {
    expect(classifyReputationResponse(body)).toBe(expected);
  });
});

describe("classifyValidationResponse (older Email Validation API)", () => {
  it.each([
    [{ deliverability: "DELIVERABLE" }, "ok"],
    [{ deliverability: "UNDELIVERABLE" }, "no-mailbox"],
    [{ deliverability: "RISKY" }, "unknown"],
    [{ deliverability: "UNKNOWN" }, "unknown"],
    [{}, "unknown"],
    [{ deliverability: "DELIVERABLE", is_disposable_email: { value: true } }, "disposable"],
  ] as const)("%j -> %s", (body, expected) => {
    expect(classifyValidationResponse(body)).toBe(expected);
  });
});

describe("verifyMailbox", () => {
  beforeEach(() => resetProviderCache());
  const calledHost = (fetchImpl: ReturnType<typeof vi.fn>, i: number) =>
    new URL((fetchImpl.mock.calls[i] as unknown as [string])[0]).origin + "/v1/";

  it("uses the Email Reputation API with the key and address", async () => {
    const fetchImpl = vi.fn(() =>
      json({ email_deliverability: { status: "undeliverable", status_detail: "invalid_mailbox" } }),
    );
    expect(await verifyMailbox("sam@example.com", "KEY", { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(
      "no-mailbox",
    );
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(calledHost(fetchImpl, 0)).toBe(REPUTATION);
    expect(url.searchParams.get("api_key")).toBe("KEY");
    expect(url.searchParams.get("email")).toBe("sam@example.com");
  });

  it("falls back to the Email Validation API when the key is rejected, then remembers it", async () => {
    const fetchImpl = vi.fn((url: string) =>
      url.startsWith(REPUTATION) ? json({ error: {} }, 401) : json({ deliverability: "DELIVERABLE" }),
    );
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    expect(await verifyMailbox("a@example.com", "KEY", opts)).toBe("ok");
    expect(fetchImpl.mock.calls.map((_, i) => calledHost(fetchImpl, i))).toEqual([REPUTATION, VALIDATION]);

    expect(await verifyMailbox("b@example.com", "KEY", opts)).toBe("ok");
    expect(calledHost(fetchImpl, 2)).toBe(VALIDATION); // no wasted Reputation call
  });

  it("is unknown when neither API accepts the key", async () => {
    const fetchImpl = () => json({ error: {} }, 401);
    expect(await verifyMailbox("a@example.com", "BAD", { fetchImpl: fetchImpl as typeof fetch })).toBe("unknown");
  });

  it.each([403, 422, 429, 500])("fails open on HTTP %i (quota, rate limit, outage)", async (status) => {
    const fetchImpl = vi.fn(() => json({}, status));
    expect(await verifyMailbox("a@example.com", "KEY", { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(
      "unknown",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only a 401 tries the other API
  });

  it("fails open on network errors and timeouts, and logs without the key or address", async () => {
    const logs: string[] = [];
    const fetchImpl = () => Promise.reject(new DOMException("timed out", "TimeoutError"));
    const status = await verifyMailbox("sam@example.com", "SECRET", {
      fetchImpl: fetchImpl as typeof fetch,
      log: (m) => logs.push(m),
    });
    expect(status).toBe("unknown");
    expect(logs.join(" ")).toContain("TimeoutError");
    expect(logs.join(" ")).not.toMatch(/SECRET|sam@example\.com/);
  });
});

// In-memory stand-in for Netlify Blobs (the daily usage counter).
const blobData = new Map<string, string>();
vi.mock("@netlify/blobs", () => ({
  getStore: () => ({
    get: async (key: string) => blobData.get(key) ?? null,
    set: async (key: string, value: string) => void blobData.set(key, value),
  }),
}));

describe("verify-mailbox function", () => {
  const env: Record<string, string> = {};
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(env)) delete env[k];
    blobData.clear();
    vi.stubGlobal("Netlify", { env: { get: (k: string) => env[k] } });
    fetchSpy
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ email_deliverability: { status: "deliverable" } }), { status: 200 }),
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function call(init: { method?: string; origin?: string; body?: unknown; ip?: string }) {
    const { default: handler } = await import("../../netlify/functions/verify-mailbox.mts");
    const req = new Request("https://parameter.digital/api/verify-mailbox", {
      method: init.method ?? "POST",
      headers: { origin: init.origin ?? "https://parameter.digital", "content-type": "application/json" },
      body: init.method === "GET" ? undefined : JSON.stringify(init.body ?? { email: "sam@example.com" }),
    });
    const res = await handler(req, { ip: init.ip ?? "203.0.113.1" } as never);
    return { code: res.status, status: ((await res.json()) as { status: string }).status };
  }

  it("is skipped, and calls nothing, until ABSTRACT_API_KEY is set", async () => {
    expect(await call({})).toEqual({ code: 200, status: "skipped" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verifies when the key is set", async () => {
    env.ABSTRACT_API_KEY = "KEY";
    expect(await call({})).toEqual({ code: 200, status: "ok" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("only accepts POST from our own site", async () => {
    env.ABSTRACT_API_KEY = "KEY";
    expect((await call({ method: "GET" })).code).toBe(405);
    expect((await call({ origin: "https://evil.example" })).code).toBe(403);
    expect((await call({ origin: "https://storied-sopapillas-24de6a.netlify.app" })).code).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed input without spending quota", async () => {
    env.ABSTRACT_API_KEY = "KEY";
    expect((await call({ body: { email: "not-an-email" } })).code).toBe(400);
    expect((await call({ body: {} })).code).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("caches answers and rate-limits each visitor, failing open", async () => {
    env.ABSTRACT_API_KEY = "KEY";
    env.ABSTRACT_DAILY_LIMIT = "100"; // isolate the per-visitor limit from the daily budget
    expect((await call({ body: { email: "a@example.com" } })).status).toBe("ok");
    expect((await call({ body: { email: "A@Example.com" } })).status).toBe("ok"); // cached, case-insensitive
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 7; i++) await call({ body: { email: `user${i}@example.com` } });
    expect(fetchSpy).toHaveBeenCalledTimes(8);
    expect(await call({ body: { email: "one-too-many@example.com" } })).toEqual({ code: 200, status: "unknown" });
    expect(fetchSpy).toHaveBeenCalledTimes(8);
    // A different visitor is unaffected.
    expect((await call({ body: { email: "other@example.com" }, ip: "203.0.113.2" })).status).toBe("ok");
  });

  it("stops calling Abstract once the daily budget is spent, failing open", async () => {
    env.ABSTRACT_API_KEY = "KEY";
    env.ABSTRACT_DAILY_LIMIT = "2";
    // Different visitors, so the per-visitor limit isn't what stops it.
    expect((await call({ body: { email: "a@example.com" }, ip: "198.51.100.1" })).status).toBe("ok");
    expect((await call({ body: { email: "b@example.com" }, ip: "198.51.100.2" })).status).toBe("ok");
    expect(await call({ body: { email: "c@example.com" }, ip: "198.51.100.3" })).toEqual({
      code: 200,
      status: "unknown",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Cached answers are still served and don't spend budget.
    expect((await call({ body: { email: "a@example.com" }, ip: "198.51.100.4" })).status).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("defaults to 5 checks a day", async () => {
    env.ABSTRACT_API_KEY = "KEY";
    for (let i = 0; i < 7; i++) await call({ body: { email: `u${i}@example.com` }, ip: `198.51.100.${10 + i}` });
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});
