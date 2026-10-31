/*
 * Lead triage for the speed-to-lead demo (/demo).
 *
 * Two layers, mirroring how a real pilot is built:
 *   1. The instant acknowledgment is a pre-approved template (`acknowledgment`).
 *      AI never writes customer-facing text.
 *   2. The office alert (summary, suggested priority, missing details, callback
 *      questions) comes from Claude when the triage-lead function has a key, or
 *      from `triageByRules` otherwise. Staff always confirm the priority.
 *
 * Shared by the browser (rules, templates, follow-up plan) and the
 * triage-lead Netlify Function (validation of model output).
 */

export const SERVICES = ["Repair", "Replacement", "Inspection", "Storm or hail damage", "Not sure"] as const;
export type Service = (typeof SERVICES)[number];

export const PRIORITIES = ["urgent", "high", "normal"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const LIMITS = { name: 80, company: 80, phone: 30, address: 160, message: 1200 } as const;

export interface DemoLead {
  /** The roofing company the demo is personalised for ("Your Roofing Co." if blank). */
  company: string;
  name: string;
  phone: string;
  address: string;
  service: Service;
  message: string;
}

export interface Triage {
  priority: Priority;
  /** One or two sentences for the office, in plain language. */
  summary: string;
  /** Details the office still needs before booking an inspection. */
  missing: string[];
  /** Questions for the person who calls the homeowner back. */
  questions: string[];
  /** Where the triage came from, shown on the demo page. */
  source: "ai" | "rules";
}

export const DEFAULT_COMPANY = "Your Roofing Co.";

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Normalises untrusted form input into a DemoLead, or returns null if it's unusable. */
export function parseLead(input: Record<string, unknown>): DemoLead | null {
  const service = SERVICES.find((s) => s === input.service) ?? "Not sure";
  const lead: DemoLead = {
    company: clean(input.company, LIMITS.company) || DEFAULT_COMPANY,
    name: clean(input.name, LIMITS.name),
    phone: clean(input.phone, LIMITS.phone),
    address: clean(input.address, LIMITS.address),
    service,
    message: clean(input.message, LIMITS.message),
  };
  return lead.name && lead.message ? lead : null;
}

const URGENT = [
  /\bleak(s|ing|ed)?\b/,
  /\bdrip(s|ping)?\b/,
  /water (is )?(coming|getting|pouring)/,
  /\bceiling\b/,
  /\btarp\b/,
  /\bhole\b/,
  /\btree\b/,
  /\bcollaps/,
];
const HIGH = [
  /\bhail\b/,
  /\bstorm\b/,
  /\bwind\b/,
  /\binsurance\b/,
  /\badjuster\b/,
  /missing shingles?/,
  /\bshingles? (blew|came) off/,
];

/** Keyword-based triage: the fallback when the AI layer is unavailable. */
export function triageByRules(lead: DemoLead): Triage {
  const text = `${lead.service} ${lead.message}`.toLowerCase();
  const priority: Priority = URGENT.some((re) => re.test(text))
    ? "urgent"
    : lead.service === "Storm or hail damage" || HIGH.some((re) => re.test(text))
      ? "high"
      : "normal";

  const firstSentence = lead.message.split(/(?<=[.!?])\s/)[0] ?? lead.message;
  const summary = `${lead.service} request from ${lead.name}: "${firstSentence.slice(0, 160)}"`;

  const questions =
    priority === "urgent"
      ? ["Is water coming in right now, and where?", "Do you need a temporary tarp today?"]
      : priority === "high"
        ? ["When did the storm damage happen?", "Have you already contacted your insurance company?"]
        : ["How old is the roof, roughly?", "What days work for an inspection?"];

  return { priority, summary, missing: missingDetails(lead), questions, source: "rules" };
}

export function missingDetails(lead: DemoLead): string[] {
  const missing: string[] = [];
  if (!lead.phone) missing.push("Phone number");
  if (!lead.address) missing.push("Property address");
  if (lead.message.length < 40) missing.push("More detail about the problem");
  return missing;
}

const MAX_ITEMS = 4;
const MAX_TEXT = 280;

/**
 * Validates model output before it reaches the page. Model output is untrusted:
 * anything malformed falls back to the rules result, and missing details are
 * always recomputed from the lead itself rather than taken on trust.
 */
export function sanitizeTriage(raw: unknown, lead: DemoLead): Triage {
  const fallback = triageByRules(lead);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;

  const priority = PRIORITIES.find((p) => p === r.priority);
  const summary = clean(r.summary, MAX_TEXT);
  if (!priority || !summary) return fallback;

  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .map((item) => clean(item, 160))
          .filter(Boolean)
          .slice(0, MAX_ITEMS)
      : [];

  const questions = list(r.questions);
  return {
    priority,
    summary,
    missing: [...new Set([...missingDetails(lead), ...list(r.missing)])].slice(0, MAX_ITEMS),
    questions: questions.length ? questions : fallback.questions,
    source: "ai",
  };
}

const firstName = (name: string) => name.split(" ")[0] || name;

/** The pre-approved instant reply the homeowner receives. */
export function acknowledgment(lead: DemoLead, priority: Priority): string {
  const hi = `Hi ${firstName(lead.name)}, thanks for contacting ${lead.company}. We got your request about ${lead.service.toLowerCase()}.`;
  if (priority === "urgent") {
    return `${hi} It sounds like this could be active damage, so we've flagged it for our team right now. Expect a call within 15 minutes. If water is coming in, move valuables away from the area.`;
  }
  return `${hi} Someone from our office will call you today to find a time for an inspection. Reply to this message if there's anything else we should know.`;
}

export interface FollowUpStep {
  when: string;
  action: string;
  /** True when a person, not the automation, does this step. */
  human: boolean;
}

/** What happens next if nobody books the inspection. */
export function followUpPlan(priority: Priority): FollowUpStep[] {
  if (priority === "urgent") {
    return [
      { when: "Now", action: "Text and call alert to the on-call person", human: false },
      { when: "+15 min", action: "If nobody has called back, escalate to the owner", human: false },
      { when: "Today", action: "Owner or crew lead decides on emergency repair or tarp", human: true },
    ];
  }
  return [
    { when: "Now", action: "Lead added to your CRM with the summary attached", human: false },
    { when: "+4 hours", action: "Reminder to the office if no call has been logged", human: false },
    { when: "Day 2", action: "Polite follow-up text with a booking link", human: false },
    { when: "Day 5", action: "Hand back to the office for a personal call", human: true },
  ];
}
