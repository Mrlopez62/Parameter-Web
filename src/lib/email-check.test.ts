import { describe, expect, it } from "vitest";
import {
  checkDomain,
  emailDomain,
  isEmailSyntaxValid,
  isValidDomain,
  suggestEmail,
  type DomainCheckDeps,
} from "./email-check";

describe("isEmailSyntaxValid", () => {
  it.each(["sam@example.com", "first.last+tag@sub.company.co.uk", " sam@example.com "])("accepts %s", (email) => {
    expect(isEmailSyntaxValid(email)).toBe(true);
  });

  it.each(["", "sam", "sam@", "@example.com", "sam@example", "sam @example.com", "sam@@example.com", "sam@example.c"])(
    "rejects %j",
    (email) => {
      expect(isEmailSyntaxValid(email)).toBe(false);
    },
  );
});

describe("emailDomain", () => {
  it("returns the lowercased domain", () => {
    expect(emailDomain("Sam@Example.COM")).toBe("example.com");
  });
  it("returns null without a local part or domain", () => {
    expect(emailDomain("@example.com")).toBeNull();
    expect(emailDomain("sam@")).toBeNull();
    expect(emailDomain("sam")).toBeNull();
  });
});

describe("suggestEmail", () => {
  it.each([
    ["sam@gmial.com", "sam@gmail.com"],
    ["sam@gmail.co", "sam@gmail.com"],
    ["sam@gamil.com", "sam@gmail.com"],
    ["sam@yaho.com", "sam@yahoo.com"],
    ["sam@hotmial.com", "sam@hotmail.com"],
    ["sam@outlok.com", "sam@outlook.com"],
    ["sam@iclod.com", "sam@icloud.com"],
    ["sam@company.con", "sam@company.com"],
    ["sam@company.ogr", "sam@company.org"],
  ])("suggests a fix for %s", (email, expected) => {
    expect(suggestEmail(email)).toBe(expected);
  });

  it.each([
    "sam@gmail.com",
    "sam@parameter.digital",
    "sam@acme.io",
    "sam@mail.com",
    "sam@email.com",
    "sam@ymail.com",
    "sam@gmx.com",
    "sam@company.co",
    "sam",
  ])("leaves %s alone", (email) => {
    expect(suggestEmail(email)).toBeNull();
  });
});

describe("isValidDomain", () => {
  it("accepts normal hostnames", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("mail.sub-domain.example.co.uk")).toBe(true);
  });
  it("rejects junk", () => {
    for (const d of ["", "example", "-bad.com", "bad-.com", "a b.com", "example..com", `${"a".repeat(64)}.com`]) {
      expect(isValidDomain(d), d).toBe(false);
    }
  });
});

describe("checkDomain", () => {
  const dnsError = (code: string) => Object.assign(new Error(code), { code });

  function deps(overrides: Partial<DomainCheckDeps> = {}): DomainCheckDeps {
    return {
      resolveMx: async () => [{ exchange: "mx.example.com", priority: 10 }],
      resolveAddress: async () => ["192.0.2.1"],
      isDisposable: () => false,
      ...overrides,
    };
  }

  it("is ok when the domain has MX records", async () => {
    expect(await checkDomain("example.com", deps())).toBe("ok");
  });

  it("falls back to A/AAAA records when there is no MX (RFC 5321 implicit MX)", async () => {
    const d = deps({ resolveMx: async () => Promise.reject(dnsError("ENODATA")) });
    expect(await checkDomain("example.com", d)).toBe("ok");
  });

  it("is no-mail for a null MX (RFC 7505)", async () => {
    const d = deps({ resolveMx: async () => [{ exchange: "", priority: 0 }] });
    expect(await checkDomain("example.com", d)).toBe("no-mail");
  });

  it("is no-mail when the domain doesn't exist", async () => {
    const d = deps({
      resolveMx: async () => Promise.reject(dnsError("ENOTFOUND")),
      resolveAddress: async () => Promise.reject(dnsError("ENOTFOUND")),
    });
    expect(await checkDomain("nope.example", d)).toBe("no-mail");
  });

  it("is unknown when DNS fails for another reason, so the form fails open", async () => {
    const d = deps({ resolveMx: async () => Promise.reject(dnsError("ETIMEOUT")) });
    expect(await checkDomain("example.com", d)).toBe("unknown");
  });

  it("flags disposable domains and their subdomains before any DNS lookup", async () => {
    let lookedUp = false;
    const d = deps({
      isDisposable: (domain) => domain === "mailinator.com",
      resolveMx: async () => {
        lookedUp = true;
        return [];
      },
    });
    expect(await checkDomain("mailinator.com", d)).toBe("disposable");
    expect(await checkDomain("inbox.mailinator.com", d)).toBe("disposable");
    expect(lookedUp).toBe(false);
  });

  it("is invalid for junk input, without a lookup", async () => {
    expect(await checkDomain("not a domain", deps())).toBe("invalid");
    expect(await checkDomain("", deps())).toBe("invalid");
  });

  it("normalises case, whitespace, and a trailing dot", async () => {
    let queried = "";
    const d = deps({
      resolveMx: async (domain) => {
        queried = domain;
        return [{ exchange: "mx", priority: 1 }];
      },
    });
    expect(await checkDomain("  Example.COM. ", d)).toBe("ok");
    expect(queried).toBe("example.com");
  });
});
