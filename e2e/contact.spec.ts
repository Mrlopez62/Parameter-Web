import { expect, test, type Page, type Request } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Freeze "today" to Wednesday 14 Oct 2026 in Chicago, so the bookable days are stable:
// tomorrow (Thu 15) onwards, weekdays only.
test.use({ timezoneId: "America/Chicago" });

const isFormPost = (req: Request) => req.method() === "POST" && new URL(req.url()).pathname === "/";

async function openContact(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-14T10:00:00-05:00"));
  await page.goto("/#contact");
}

async function fillDetails(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill("Sam Test");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Business name").fill("Sam's Roofing");
  await page.getByLabel("What would you like to automate?").fill("Copying web enquiries into our CRM.");
}

async function pickTuesday10am(page: Page) {
  await page.locator("#cf-when").click();
  await page.getByRole("button", { name: "Tuesday, October 20" }).click();
  await page.getByRole("button", { name: "10:00 AM" }).click();
}

test.describe("date and time picker", () => {
  test("only offers weekdays from tomorrow", async ({ page }) => {
    await openContact(page);
    await page.locator("#cf-when").click();

    const dialog = page.getByRole("dialog", { name: "Choose a date and time" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Wednesday, October 14" })).toBeDisabled(); // today
    await expect(dialog.getByRole("button", { name: "Thursday, October 15" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Saturday, October 17" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Sunday, October 18" })).toBeDisabled();
    await expect(dialog).toContainText("America/Chicago");
  });

  test("shows the chosen slot and closes", async ({ page }) => {
    await openContact(page);
    await pickTuesday10am(page);

    await expect(page.getByRole("dialog", { name: "Choose a date and time" })).toBeHidden();
    await expect(page.locator("#cf-when")).toContainText("Tue, Oct 20 · 10:00 AM");
  });

  test("closes on Escape and on an outside click", async ({ page }) => {
    await openContact(page);
    const dialog = page.getByRole("dialog", { name: "Choose a date and time" });

    await page.locator("#cf-when").click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.locator("#cf-when").click();
    await page.getByLabel("Name", { exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test("is not clipped by its section", async ({ page }) => {
    await openContact(page);
    await page.locator("#cf-when").click();
    const dialog = page.getByRole("dialog", { name: "Choose a date and time" });
    await dialog.scrollIntoViewIfNeeded();

    const allCornersVisible = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const corners = [
        [r.left + 8, r.top + 8],
        [r.right - 8, r.top + 8],
        [r.left + 8, r.bottom - 8],
        [r.right - 8, r.bottom - 8],
      ];
      return corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
    });
    expect(allCornersVisible).toBe(true);
  });
});

test.describe("discovery call form", () => {
  test("asks for a date and time before submitting", async ({ page }) => {
    await openContact(page);
    let posted = false;
    page.on("request", (req) => (posted ||= isFormPost(req)));

    await fillDetails(page);
    await page.getByRole("button", { name: "Request discovery call" }).click();

    await expect(page.getByText("Please choose a date and time.")).toBeVisible();
    await expect(page.locator("#cf-when")).toBeFocused();
    expect(posted).toBe(false);
  });

  test("submits to Netlify Forms and offers calendar links", async ({ page }) => {
    await openContact(page);
    let body = "";
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        body = route.request().postData() ?? "";
        await route.fulfill({ status: 200, body: "ok" });
      },
    );

    await fillDetails(page);
    await pickTuesday10am(page);
    await page.getByRole("button", { name: "Request discovery call" }).click();

    // Payload: what Netlify emails to hello@.
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    const data = new URLSearchParams(body);
    expect(data.get("form-name")).toBe("discovery-call");
    expect(data.get("name")).toBe("Sam Test");
    expect(data.get("email")).toBe("sam@example.com");
    expect(data.get("business")).toBe("Sam's Roofing");
    expect(data.get("date")).toBe("2026-10-20");
    expect(data.get("time")).toBe("10:00");
    expect(data.get("timezone")).toBe("America/Chicago");
    expect(data.get("requested_time")).toContain("2026-10-20T15:00:00.000Z"); // 10:00 CDT
    expect(data.get("company_website")).toBe(""); // honeypot left empty

    await expect(page.getByText("Tuesday, October 20 at 10:00 AM CDT")).toBeVisible();

    // Calendar links carry the same time, in UTC.
    const google = new URL((await page.getByRole("link", { name: "Google Calendar" }).getAttribute("href"))!);
    expect(google.searchParams.get("dates")).toBe("20261020T150000Z/20261020T153000Z");
    const outlook = new URL((await page.getByRole("link", { name: "Outlook.com" }).getAttribute("href"))!);
    expect(outlook.hostname).toBe("outlook.live.com");
    expect(outlook.searchParams.get("startdt")).toBe("2026-10-20T15:00:00.000Z");
    const office = new URL((await page.getByRole("link", { name: "Outlook (Microsoft 365)" }).getAttribute("href"))!);
    expect(office.hostname).toBe("outlook.office.com");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Apple Calendar / other (.ics)" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("parameter-discovery-call.ics");
    const ics = await readFile((await download.path())!, "utf8");
    expect(ics).toContain("DTSTART:20261020T150000Z");
    expect(ics).toContain("STATUS:TENTATIVE");
  });

  test("shows an email fallback if sending fails", async ({ page }) => {
    await openContact(page);
    await page.route(
      (url) => url.pathname === "/",
      (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500 }) : route.continue()),
    );

    await fillDetails(page);
    await pickTuesday10am(page);
    await page.getByRole("button", { name: "Request discovery call" }).click();

    await expect(page.getByRole("alert")).toContainText("hello@parameter.digital");
    await expect(page.getByRole("button", { name: "Request discovery call" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeHidden();
  });
});
