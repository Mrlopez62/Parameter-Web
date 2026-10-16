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
    await expect(dialog).toContainText("Times are Central Time (CT).");
    // Visitors already in Central Time don't get a second "your time" line.
    await dialog.getByRole("button", { name: "Tuesday, October 20" }).click();
    await expect(dialog.getByRole("button", { name: "10:00 AM CT" })).toHaveText("10:00 AM CT");
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

    await expect(page.getByText("Tuesday, October 20 at 10:00 AM CT")).toBeVisible();
    expect(data.get("requested_time")).toMatch(/^Tuesday, October 20 at 10:00 AM CDT /); // email keeps the exact zone

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

test.describe("live email check", () => {
  // Simulates the Netlify Function (/api/verify-email), which `astro preview` doesn't serve.
  async function mockVerify(page: Page, statuses: Record<string, string>) {
    const queried: string[] = [];
    await page.route("**/api/verify-email?**", async (route) => {
      const url = new URL(route.request().url());
      queried.push(url.search);
      const status = statuses[url.searchParams.get("domain") ?? ""] ?? "ok";
      await route.fulfill({ json: { status } });
    });
    return queried;
  }

  test("confirms a good address and only sends the domain", async ({ page }) => {
    const queried = await mockVerify(page, { "company.com": "ok" });
    await openContact(page);
    await page.getByLabel("Email").fill("sam.lee@company.com");
    await page.getByLabel("Email").blur();

    await expect(page.locator("#cf-email-status")).toHaveText("✓ Email looks good");
    expect(queried).toEqual(["?domain=company.com"]); // never the local part
  });

  test("suggests a fix for a typo and applies it in one click", async ({ page }) => {
    await mockVerify(page, { "gmial.com": "disposable", "gmail.com": "ok" });
    await openContact(page);
    await page.getByLabel("Email").fill("sam@gmial.com");
    await page.getByLabel("Email").blur();

    const status = page.locator("#cf-email-status");
    await expect(status).toContainText("Did you mean sam@gmail.com?");
    await status.getByRole("button", { name: "sam@gmail.com" }).click();

    await expect(page.getByLabel("Email")).toHaveValue("sam@gmail.com");
    await expect(status).toHaveText("✓ Email looks good");
  });

  test("blocks a domain that can't receive email", async ({ page }) => {
    await mockVerify(page, { "no-mail.example": "no-mail" });
    await openContact(page);
    let posted = false;
    page.on("request", (req) => (posted ||= isFormPost(req)));

    await fillDetails(page);
    await page.getByLabel("Email").fill("sam@no-mail.example");
    await pickTuesday10am(page);
    await page.getByRole("button", { name: "Request discovery call" }).click();

    await expect(page.locator("#cf-email-status")).toHaveText(
      "This email domain can't receive mail. Please check the address.",
    );
    expect(await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.validity.customError)).toBe(true);
    expect(posted).toBe(false);

    // Fixing the address clears the block.
    await page.getByLabel("Email").fill("sam@company.com");
    await page.getByLabel("Email").blur();
    await expect(page.locator("#cf-email-status")).toHaveText("✓ Email looks good");
    expect(await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
  });

  test("rejects throwaway email services", async ({ page }) => {
    await mockVerify(page, { "mailinator.com": "disposable" });
    await openContact(page);
    await page.getByLabel("Email").fill("sam@mailinator.com");
    await page.getByLabel("Email").blur();

    await expect(page.locator("#cf-email-status")).toHaveText(
      "Please use a permanent email address so we can reply to you.",
    );
  });
});

test.describe("mailbox check (Abstract API, when configured)", () => {
  async function mockApis(page: Page, mailbox: string) {
    const mailboxCalls: string[] = [];
    await page.route("**/api/verify-email?**", (route) => route.fulfill({ json: { status: "ok" } }));
    await page.route("**/api/verify-mailbox", async (route) => {
      mailboxCalls.push((route.request().postDataJSON() as { email: string }).email);
      await route.fulfill({ json: { status: mailbox } });
    });
    return mailboxCalls;
  }

  test("only checks the mailbox when leaving the field, not while typing", async ({ page }) => {
    const calls = await mockApis(page, "ok");
    await openContact(page);
    await page.getByLabel("Email").pressSequentially("sam@company.com", { delay: 20 });
    await expect(page.locator("#cf-email-status")).toHaveText("✓ Email looks good"); // debounced domain check
    expect(calls).toEqual([]);

    await page.getByLabel("Email").blur();
    await expect(page.locator("#cf-email-status")).toHaveText("✓ Email verified");
    expect(calls).toEqual(["sam@company.com"]);
  });

  test("blocks an address whose mailbox doesn't exist", async ({ page }) => {
    await mockApis(page, "no-mailbox");
    await openContact(page);
    let posted = false;
    page.on("request", (req) => (posted ||= isFormPost(req)));

    await fillDetails(page);
    await page.getByLabel("Email").fill("dummytest@gmail.com");
    await pickTuesday10am(page);
    await page.getByRole("button", { name: "Request discovery call" }).click();

    await expect(page.locator("#cf-email-status")).toHaveText(
      "We couldn't find this mailbox. Please check the address.",
    );
    expect(posted).toBe(false);
  });

  test("lets the address through when the check is unavailable or not configured", async ({ page }) => {
    await mockApis(page, "skipped");
    await openContact(page);
    await page.getByLabel("Email").fill("sam@company.com");
    await page.getByLabel("Email").blur();
    await expect(page.locator("#cf-email-status")).toHaveText("✓ Email looks good");
    expect(await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
  });
});

test.describe("visitor in another time zone", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("slots are Central business hours, with the visitor's local time underneath", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-14T10:00:00-05:00"));
    let body = "";
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        body = route.request().postData() ?? "";
        await route.fulfill({ status: 200, body: "ok" });
      },
    );
    await page.goto("/#contact");

    await page.locator("#cf-when").click();
    const dialog = page.getByRole("dialog", { name: "Choose a date and time" });
    await expect(dialog).toContainText("Times are Central Time (CT), with your local time (America/Los_Angeles)");
    await dialog.getByRole("button", { name: "Tuesday, October 20" }).click();

    // First slot is 9 AM Central = 7 AM Pacific.
    const nineAm = dialog.getByRole("button", { name: "9:00 AM CT, 7:00 AM your time" });
    await expect(nineAm).toBeVisible();
    await dialog.getByRole("button", { name: "10:00 AM CT, 8:00 AM your time" }).click();
    await expect(page.locator("#cf-when")).toContainText("Tue, Oct 20 · 10:00 AM CT (8:00 AM your time)");

    await fillDetails(page);
    await page.getByRole("button", { name: "Request discovery call" }).click();
    await expect(page.getByText("Tuesday, October 20 at 10:00 AM CT (8:00 AM PDT your time)")).toBeVisible();

    const data = new URLSearchParams(body);
    expect(data.get("date")).toBe("2026-10-20");
    expect(data.get("time")).toBe("10:00"); // Central
    expect(data.get("timezone")).toBe("America/Los_Angeles");
    expect(data.get("requested_time")).toBe(
      "Tuesday, October 20 at 10:00 AM CDT / visitor: 8:00 AM PDT (2026-10-20T15:00:00.000Z)",
    );

    // Calendar links use the same instant.
    const google = new URL((await page.getByRole("link", { name: "Google Calendar" }).getAttribute("href"))!);
    expect(google.searchParams.get("dates")).toBe("20261020T150000Z/20261020T153000Z");
  });

  test("after daylight saving ends, CT slots still map to the right local time", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-30T10:00:00-05:00"));
    await page.goto("/#contact");
    await page.locator("#cf-when").click();
    const dialog = page.getByRole("dialog", { name: "Choose a date and time" });
    await dialog.getByRole("button", { name: "Next month" }).click();
    await dialog.getByRole("button", { name: "Tuesday, November 3" }).click();
    await expect(dialog.getByRole("button", { name: "10:00 AM CT, 8:00 AM your time" })).toBeVisible();
  });
});
