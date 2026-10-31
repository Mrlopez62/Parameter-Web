// Sends the instant confirmation email for discovery-call requests. Netlify runs
// a function with this exact name after every verified (non-spam) form submission.
//
// Sends from the hello@ mailbox over Hostinger SMTP. Inactive until SMTP_PASSWORD
// is set in Netlify (Project configuration -> Environment variables); override
// SMTP_HOST / SMTP_USER if the mailbox moves. Failures are logged and never
// affect the submission itself, which Netlify has already stored and emailed to us.
import type { Handler } from "@netlify/functions";
import nodemailer from "nodemailer";
import { site } from "../../src/data/site.ts";
import { confirmationEmail, parseSubmission } from "../../src/lib/autoreply.ts";

export const handler: Handler = async (event) => {
  const { payload } = JSON.parse(event.body ?? "{}") as {
    payload?: { form_name?: string; data?: Record<string, unknown> };
  };
  if (payload?.form_name !== "discovery-call") return { statusCode: 200 };

  const password = process.env.SMTP_PASSWORD;
  if (!password) {
    console.log("autoreply: SMTP_PASSWORD not set, skipping");
    return { statusCode: 200 };
  }

  const request = parseSubmission(payload.data);
  if (!request) return { statusCode: 200 };

  const user = process.env.SMTP_USER ?? site.email;
  const email = confirmationEmail(request, site.founder);
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: { user, pass: password },
    });
    await transport.sendMail({
      from: `${site.founder} at ${site.name} <${user}>`,
      replyTo: site.email,
      ...email,
    });
    console.log("autoreply: sent");
  } catch (err) {
    console.log(`autoreply: failed (${(err as Error)?.message ?? "error"})`);
  }
  return { statusCode: 200 };
};
