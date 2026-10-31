import { describe, expect, it } from "vitest";
import { confirmationEmail, parseSubmission } from "./autoreply";

describe("parseSubmission", () => {
  it("keeps the human-readable requested time", () => {
    expect(
      parseSubmission({
        name: "Sam Test",
        email: " sam@example.com ",
        business: "Sam's Roofing",
        requested_time: "Tue, Oct 20 at 10:00 AM CDT / visitor: 8:00 AM PDT (2026-10-20T15:00:00.000Z)",
      }),
    ).toEqual({
      name: "Sam Test",
      email: "sam@example.com",
      business: "Sam's Roofing",
      requestedTime: "Tue, Oct 20 at 10:00 AM CDT",
    });
  });

  it("drops the UTC suffix when the visitor is in Central Time", () => {
    expect(
      parseSubmission({ email: "a@b.co", requested_time: "Tue, Oct 20 at 10:00 AM CDT (2026-10-20T15:00:00.000Z)" })
        ?.requestedTime,
    ).toBe("Tue, Oct 20 at 10:00 AM CDT");
  });

  it("returns null without a usable email", () => {
    expect(parseSubmission({ email: "not-an-email" })).toBeNull();
    expect(parseSubmission(undefined)).toBeNull();
  });
});

describe("confirmationEmail", () => {
  it("addresses the person by first name and signs from the founder", () => {
    const email = confirmationEmail(
      {
        name: "Sam Test",
        email: "sam@example.com",
        business: "Sam's Roofing",
        requestedTime: "Tue, Oct 20 at 10:00 AM CDT",
      },
      "Joshua Lopez",
    );
    expect(email.to).toBe("sam@example.com");
    expect(email.text).toMatch(/^Hi Sam,/);
    expect(email.text).toContain("for Tue, Oct 20 at 10:00 AM CDT");
    expect(email.text).toContain("about Sam's Roofing");
    expect(email.text).toContain("\nJoshua Lopez\n");
  });

  it("still reads naturally with only an email", () => {
    const email = confirmationEmail({ name: "", email: "a@b.co", business: "", requestedTime: "" }, "Joshua Lopez");
    expect(email.text).toMatch(/^Hi there,/);
    expect(email.text).toContain("discovery call came through.");
  });
});
