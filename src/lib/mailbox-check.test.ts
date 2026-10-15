import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ABSTRACT_ENDPOINT, classifyAbstractResponse, verifyMailbox } from "./mailbox-check";

describe("classifyAbstractResponse", () => {
  it.each([
    [{ deliverability: "DELIVERABLE" }, "ok"],
    [{ deliverability: "UNDELIVERABLE" }, "no-mailbox"],
    [{ deliverability: "RISKY" }, "unknown"], // e.g. catch-all domains: allow
    [{ deliverability: "UNKNOWN" }, "unknown"],
    [{}, "unknown"],
    [{ deliverability: "DELIVERABLE", is_disposable_email: { value: true } }, "disposable"],
  ] as const)("%j -> %s", (body, expected) => {
    expect(classifyAbstractResponse(body)).toBe(expected);
  });
});

describe("verifyMailbox", () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it("calls Abstract with the key and address, and classifies the answer", async () => {
    const fetchImpl = vi.fn(() => ok({ deliverability: "UNDELIVERABLE" }));
    expect(await verifyMailbox("sam@example.com", "KEY", fetchImpl as unknown as typeof fetch)).toBe("no-mailbox");

    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin + url.pathname).toBe(ABSTRACT_ENDPOINT);
    expect(url.searchParams.get("api_key")).toBe("KEY");
    expect(url.searchParams.get("email")).toBe("sam@example.com");
  });

  it.each([401, 422, 429, 500])("fails open on HTTP %i (bad key, quota, outage)", async (status) => {
    const fetchImpl = () => Promise.resolve(new Response("", { status }));
    expect(await verifyMailbox("sam@example.com", "KEY", fetchImpl as typeof fetch)).toBe("unknown");
  });

  it("fails open on network errors and timeouts", async () => {
    const fetchImpl = () => Promise.reject(new DOMException("timed out", "TimeoutError"));
    expect(await verifyMailbox("sam@example.com", "KEY", fetchImpl as typeof fetch)).toBe("unknown");
  });
});

describe("verify-mailbox function", () => {
  const env: Record<string, string> = {};
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(env)) delete env[k];
    vi.stubGlobal("Netlify", { env: { get: (k: string) => env[k] } });
    fetchSpy
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ deliverability: "DELIVERABLE" }), { status: 200 })),
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
});
