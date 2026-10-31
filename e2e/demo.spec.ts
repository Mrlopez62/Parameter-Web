import { expect, test } from "@playwright/test";

const isTriage = (url: URL) => url.pathname === "/api/triage-lead";

test.describe("speed-to-lead demo", () => {
  test("shows the instant reply, AI triage, and follow-ups", async ({ page }) => {
    let body: Record<string, string> | undefined;
    await page.route(isTriage, async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({
        json: {
          priority: "urgent",
          summary: "Active leak through an upstairs ceiling since last night.",
          missing: ["Property address"],
          questions: ["Is water still coming in?"],
          source: "ai",
        },
      });
    });

    await page.goto("/demo/?company=Smith%20Roofing");
    await expect(page.getByLabel("Roofing company (yours, if you like)")).toHaveValue("Smith Roofing");
    await page.getByRole("button", { name: "Active leak" }).click();
    await page.getByRole("button", { name: "Send enquiry" }).click();

    await expect(page.locator("[data-reply]")).toContainText("Hi Dana, thanks for contacting Smith Roofing.");
    await expect(page.locator("[data-reply]")).toContainText("within 15 minutes");
    await expect(page.locator("[data-priority]")).toHaveText("Urgent");
    await expect(page.locator("[data-summary]")).toHaveText(
      "Active leak through an upstairs ceiling since last night.",
    );
    await expect(page.locator("[data-alert-source]")).toContainText("AI summary");
    await expect(page.locator("[data-followups] li")).toHaveCount(3);
    expect(body).toMatchObject({ company: "Smith Roofing", name: "Dana Lee", service: "Repair" });
  });

  test("falls back to the rules when the triage service fails", async ({ page }) => {
    await page.route(isTriage, (route) => route.fulfill({ status: 500 }));
    await page.goto("/demo/");
    await page.getByRole("button", { name: "Replacement quote" }).click();
    await page.getByRole("button", { name: "Send enquiry" }).click();

    await expect(page.locator("[data-reply]")).toContainText("thanks for contacting Your Roofing Co.");
    await expect(page.locator("[data-priority]")).toHaveText("Normal");
    await expect(page.locator("[data-alert-source]")).toContainText("Rules");
    await expect(page.locator("[data-followups] li")).toHaveCount(4);
  });
});

test.describe("roofing landing page", () => {
  test("links to the demo and tags discovery requests with its source", async ({ page }) => {
    await page.goto("/roofing/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every roofing lead gets a reply");
    await expect(page.getByRole("link", { name: "Try the 60-second demo" })).toHaveAttribute("href", "/demo/");
    await expect(page.locator('#contact input[name="source"]')).toHaveValue("roofing");
    await expect(page.getByRole("heading", { name: "Joshua Lopez, founder" })).toBeVisible();
  });
});
