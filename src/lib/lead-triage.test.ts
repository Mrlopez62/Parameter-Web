import { describe, expect, it } from "vitest";
import {
  acknowledgment,
  DEFAULT_COMPANY,
  followUpPlan,
  parseLead,
  sanitizeTriage,
  triageByRules,
  type DemoLead,
} from "./lead-triage";

const lead = (overrides: Partial<DemoLead> = {}): DemoLead => ({
  company: "Smith Roofing",
  name: "Dana Lee",
  phone: "214-555-0100",
  address: "12 Elm St, Plano TX",
  service: "Repair",
  message: "A few shingles look loose near the chimney after last week's wind.",
  ...overrides,
});

describe("parseLead", () => {
  it("trims, collapses whitespace, and defaults the company", () => {
    expect(parseLead({ name: "  Dana   Lee ", message: " Roof\n leak ", service: "Repair" })).toMatchObject({
      company: DEFAULT_COMPANY,
      name: "Dana Lee",
      message: "Roof leak",
      service: "Repair",
    });
  });

  it("maps unknown services to 'Not sure'", () => {
    expect(parseLead({ name: "Dana", message: "Help", service: "Pool cleaning" })?.service).toBe("Not sure");
  });

  it("caps long input", () => {
    expect(parseLead({ name: "Dana", message: "x".repeat(5000) })?.message).toHaveLength(1200);
  });

  it("rejects a lead without a name or message", () => {
    expect(parseLead({ name: "", message: "Leak" })).toBeNull();
    expect(parseLead({ name: "Dana", message: "   " })).toBeNull();
  });
});

describe("triageByRules", () => {
  it.each([
    "Water is coming in through the ceiling in the kitchen",
    "Roof is leaking over the garage",
    "A tree fell on the house last night",
  ])("marks %j urgent", (message) => {
    expect(triageByRules(lead({ message })).priority).toBe("urgent");
  });

  it("marks hail and insurance requests high", () => {
    expect(triageByRules(lead({ message: "The insurance adjuster is coming Friday" })).priority).toBe("high");
    expect(triageByRules(lead({ service: "Storm or hail damage", message: "Can you take a look?" })).priority).toBe(
      "high",
    );
  });

  it("marks everything else normal", () => {
    expect(
      triageByRules(lead({ message: "Thinking about replacing our 20-year-old roof next spring." })).priority,
    ).toBe("normal");
  });

  it("lists missing contact details", () => {
    expect(triageByRules(lead({ phone: "", address: "", message: "Roof quote?" })).missing).toEqual([
      "Phone number",
      "Property address",
      "More detail about the problem",
    ]);
  });
});

describe("sanitizeTriage", () => {
  it("accepts well-formed model output", () => {
    const result = sanitizeTriage(
      { priority: "high", summary: "Wind damage near chimney.", missing: [], questions: ["When did it happen?"] },
      lead(),
    );
    expect(result).toEqual({
      priority: "high",
      summary: "Wind damage near chimney.",
      missing: [],
      questions: ["When did it happen?"],
      source: "ai",
    });
  });

  it("falls back to rules on an unknown priority or empty summary", () => {
    expect(sanitizeTriage({ priority: "panic", summary: "x" }, lead()).source).toBe("rules");
    expect(sanitizeTriage({ priority: "high", summary: "  " }, lead()).source).toBe("rules");
    expect(sanitizeTriage(null, lead()).source).toBe("rules");
  });

  it("always includes missing details computed from the lead", () => {
    const result = sanitizeTriage({ priority: "normal", summary: "Quote request.", missing: [] }, lead({ phone: "" }));
    expect(result.missing).toContain("Phone number");
  });

  it("caps list length and item size", () => {
    const result = sanitizeTriage(
      { priority: "normal", summary: "ok", questions: Array.from({ length: 10 }, () => "q".repeat(500)) },
      lead(),
    );
    expect(result.questions).toHaveLength(4);
    expect(result.questions[0]).toHaveLength(160);
  });
});

describe("acknowledgment", () => {
  it("uses the first name and company", () => {
    expect(acknowledgment(lead(), "normal")).toMatch(/^Hi Dana, thanks for contacting Smith Roofing\./);
  });

  it("promises a fast call back for urgent requests", () => {
    expect(acknowledgment(lead(), "urgent")).toContain("within 15 minutes");
  });
});

describe("followUpPlan", () => {
  it("ends with a person for every priority", () => {
    for (const priority of ["urgent", "high", "normal"] as const) {
      expect(followUpPlan(priority).at(-1)?.human).toBe(true);
    }
  });
});
