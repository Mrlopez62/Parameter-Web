import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const noHorizontalScroll = () => document.documentElement.scrollWidth <= window.innerWidth;

test.describe("home page", () => {
  test("renders the hero and every section the nav links to", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Parameter/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Automate the busywork. Keep the work that matters.",
    );

    for (const id of ["services", "how-we-work", "work-with-us", "faq", "contact"]) {
      await expect(page.locator(`#${id}`), `#${id} exists`).toHaveCount(1);
    }
    expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  });

  test("reveals every animated element while scrolling", async ({ page }) => {
    await page.goto("/");
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y <= height; y += 400) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
      await page.waitForTimeout(40);
    }
    await expect(page.locator("[data-reveal]:not(.is-visible)")).toHaveCount(0);
    await expect(page.locator("[data-engage]")).toHaveClass(/is-active/);
    await expect(page.locator("[data-code-anim]")).toHaveClass(/is-typing/);
  });

  test("shows finished animations straight away with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    // Without scrolling: the code panel's statuses and the plan cards are already visible.
    await expect(page.locator("[data-code-anim] .status").last()).toHaveCSS("opacity", "1");
    await expect(page.locator(".engage .card").first()).toHaveCSS("opacity", "1");
  });

  test("FAQ answers expand", async ({ page }) => {
    await page.goto("/");
    const question = page.locator("#faq summary", { hasText: "Do you use AI?" });
    await question.click();
    await expect(page.getByText("Only where it genuinely helps")).toBeVisible();
  });

  test("mobile menu opens and closes", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The menu button only shows on small screens");
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "FAQ" }).click();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeHidden();
  });

  test("has sharing and search metadata", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://parameter.digital/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://parameter.digital/og.png",
    );
    const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(jsonLd).toMatchObject({
      "@type": "ProfessionalService",
      name: "Parameter",
      email: "hello@parameter.digital",
    });
  });
});

test.describe("other pages", () => {
  test("unknown URLs get the branded 404 page", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page doesn't exist." })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");

    const main = page.getByRole("main");
    await expect(main.getByRole("link")).toHaveCount(1);
    await main.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL("/");
  });

  test("privacy policy is linked from the form and footer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#contact").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy/",
    );
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
    expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  });

  test("robots.txt and the sitemap are served", async ({ request }) => {
    expect(await (await request.get("/robots.txt")).text()).toContain(
      "Sitemap: https://parameter.digital/sitemap-index.xml",
    );
    const sitemap = await (await request.get("/sitemap-0.xml")).text();
    expect(sitemap).toContain("<loc>https://parameter.digital/</loc>");
    expect(sitemap).toContain("<loc>https://parameter.digital/privacy/</loc>");
    expect(sitemap).toContain("<loc>https://parameter.digital/roofing/</loc>");
    expect(sitemap).not.toContain("404");
  });
});

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  for (const path of ["/", "/privacy/", "/demo/", "/roofing/", "/this-page-does-not-exist"]) {
    test(`${path} has no detectable violations`, async ({ page }) => {
      // Reduced motion renders every animated element in its final state.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  }
});
