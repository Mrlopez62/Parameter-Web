import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

const isTrack = (url: URL) => url.pathname === "/api/track";

// Collects tracker beacons; the preview server has no functions, so answer them here.
async function captureEvents(page: Page) {
  const events: Record<string, string>[] = [];
  await page.route(isTrack, async (route) => {
    events.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 204 });
  });
  return events;
}

test.describe("tracker", () => {
  test("sends a page view with the company from a personalised link", async ({ page }) => {
    const events = await captureEvents(page);
    await page.goto("/demo/?company=Rhino%20Roofing%20Co&utm_source=email");
    await expect.poll(() => events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: "pageview", path: "/demo/", company: "Rhino Roofing Co", utm: "email" });
  });

  test("records a demo run with the company typed into the demo", async ({ page }) => {
    const events = await captureEvents(page);
    await page.route(
      (u) => u.pathname === "/api/triage-lead",
      (r) => r.fulfill({ status: 500 }),
    );
    await page.goto("/demo/");
    await page.getByLabel("Roofing company (yours, if you like)").fill("Smith Roofing");
    await page.getByRole("button", { name: "Replacement quote" }).click();
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect.poll(() => events.find((e) => e.type === "demo_run")).toMatchObject({ company: "Smith Roofing" });
  });

  test("sends nothing once this browser has opted out", async ({ page }) => {
    const sent: Request[] = [];
    await page.route(isTrack, (route) => (sent.push(route.request()), route.fulfill({ status: 204 })));
    await page.addInitScript(() => localStorage.setItem("parameter:ignore-analytics", "1"));
    await page.goto("/roofing/");
    await page.waitForTimeout(500);
    expect(sent).toHaveLength(0);
  });

  test("doesn't count visits to the stats page itself", async ({ page }) => {
    const events = await captureEvents(page);
    await page.goto("/stats/");
    await page.waitForTimeout(500);
    expect(events).toHaveLength(0);
  });
});

const summary = {
  days: ["2026-11-03", "2026-11-04", "2026-11-05"],
  totals: { pageviews: 42, demoOpens: 3, demoRuns: 2, callsRequested: 1 },
  daily: [
    { day: "2026-11-03", pageviews: 10 },
    { day: "2026-11-04", pageviews: 0 },
    { day: "2026-11-05", pageviews: 32 },
  ],
  topPages: [{ key: "/roofing/", count: 20 }],
  topReferrers: [{ key: "google.com", count: 12 }],
  callsByPage: [{ key: "/roofing/", count: 1 }],
  companies: [{ company: "Rhino Roofing Co", demoOpens: 3, demoRuns: 2, last: Date.parse("2026-11-05T16:00:00Z") }],
  truncated: false,
};

test.describe("stats dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(
      (u) => u.pathname === "/api/stats",
      (route) =>
        route.request().headers().authorization === "Bearer right-password"
          ? route.fulfill({ json: summary })
          : route.fulfill({ status: 401, json: { error: "Wrong password." } }),
    );
  });

  test("rejects a wrong password", async ({ page }) => {
    await page.goto("/stats/");
    await page.getByLabel("Password").fill("nope");
    await page.getByRole("button", { name: "Show stats" }).click();
    await expect(page.getByRole("alert")).toHaveText("Wrong password.");
    await expect(page.locator("[data-dashboard]")).toBeHidden();
  });

  test("shows totals, company demo activity, the chart, and the lists", async ({ page }) => {
    await page.goto("/stats/");
    await page.getByLabel("Password").fill("right-password");
    await page.getByRole("button", { name: "Show stats" }).click();

    await expect(page.locator('[data-total="pageviews"]')).toHaveText("42");
    await expect(page.locator('[data-total="demoOpens"]')).toHaveText("3");
    await expect(page.locator("[data-companies]")).toContainText("Rhino Roofing Co");
    await expect(page.locator("[data-bar]")).toHaveCount(2); // the zero day draws no bar
    await expect(page.getByRole("img", { name: /42 in total, peaking at 32/ })).toBeVisible();
    await expect(page.locator('[data-list="topReferrers"]')).toContainText("google.com");

    // Signing in opts this browser out of being counted.
    expect(await page.evaluate(() => localStorage.getItem("parameter:ignore-analytics"))).toBe("1");
    await expect(page.getByLabel("Don't count visits from this browser")).toBeChecked();
  });

  test("shows a day's count on hover", async ({ page, isMobile }) => {
    test.skip(isMobile, "Hover tooltips are a pointer interaction");
    await page.goto("/stats/");
    await page.getByLabel("Password").fill("right-password");
    await page.getByRole("button", { name: "Show stats" }).click();
    await page.locator('[data-day="2026-11-05"]').hover();
    await expect(page.locator("[data-tooltip]")).toContainText("32 page views");
  });

  test("has no detectable accessibility violations once signed in", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/stats/");
    await page.getByLabel("Password").fill("right-password");
    await page.getByRole("button", { name: "Show stats" }).click();
    await expect(page.locator("[data-dashboard]")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });

  test("stays out of search results and the sitemap", async ({ page, request }) => {
    await page.goto("/stats/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    expect(await (await request.get("/sitemap-0.xml")).text()).not.toContain("/stats/");
  });
});
