/*
 * The instant confirmation email sent when someone requests a discovery call.
 * Built here (pure, tested) and sent by the submission-created Netlify Function.
 */

export interface DiscoveryRequest {
  name: string;
  email: string;
  business: string;
  requestedTime: string;
}

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Netlify's submission payload `data` -> DiscoveryRequest, or null if there's no one to reply to. */
export function parseSubmission(data: Record<string, unknown> | undefined): DiscoveryRequest | null {
  const get = (key: string) => String(data?.[key] ?? "").trim();
  const email = get("email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null;
  return {
    name: get("name").slice(0, 80),
    email,
    business: get("business").slice(0, 80),
    // "Tue, Oct 20 at 10:00 AM CDT / visitor: ... (2026-...Z)": keep the human part only.
    requestedTime: get("requested_time")
      .split(" / ")[0]
      .replace(/\s*\([^)]*\)\s*$/, ""),
  };
}

export function confirmationEmail(req: DiscoveryRequest, founder: string): Email {
  const first = req.name.split(" ")[0] || "there";
  const when = req.requestedTime ? ` for ${req.requestedTime}` : "";
  return {
    to: req.email,
    subject: "Got it: your discovery call request",
    text: [
      `Hi ${first},`,
      "",
      `Thanks for reaching out${req.business ? ` about ${req.business}` : ""}. Your request for a 30-minute discovery call${when} came through.`,
      "",
      "I'll confirm that time (or suggest another) by email today if it's a business day, otherwise the next one, with a video link.",
      "",
      "Before we talk, it helps to think of the last few enquiries or jobs where something slowed down: who handled it, what tools were involved, and where it waited.",
      "",
      "If anything's urgent, just reply to this email.",
      "",
      founder,
      "Parameter · parameter.digital",
    ].join("\n"),
  };
}
