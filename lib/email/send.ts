// Nodemailer over SMTP (§2), and §7.1's one-email-per-person-per-day guard.
//
// §2 names the transport: "Nodemailer over SMTP (Brevo free tier, or a
// dedicated Gmail + app password)". Nothing here is Brevo-specific — host, port
// and credentials all come from the environment, so switching providers is an
// env change rather than a code change.
//
// The guard is the interesting half of this file. §7.2: "rely on email_log's
// unique constraint to make double-firing harmless", and CLAUDE.md states the
// same as a hard rule. cron-job.org and the vercel.json backup can both fire,
// and Vercel Hobby's own cron "fires anywhere within the hour" (§2) — so the
// claim below is a database insert, not a check-then-send.

import type { ReactElement } from "react";
import { render } from "@react-email/render";
import nodemailer, { type Transporter } from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type EmailType = "digest_student" | "digest_guardian" | "digest_tutor";

export type SendOutcome = "sent" | "failed" | "skipped_empty" | "already_sent";

let cached: Transporter | null = null;

/**
 * The SMTP transport, built once per warm function instance.
 *
 * Reused deliberately: the nightly job writes to several recipients in one
 * invocation, and a fresh connection per message would spend most of the run in
 * TLS handshakes — which matters when Vercel Hobby caps the function at 60s (§2).
 */
export function transport(): Transporter {
  if (cached) return cached;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASSWORD must all be set.");
  }

  const port = Number(process.env.SMTP_PORT ?? 587);

  cached = nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 starts plaintext and upgrades via STARTTLS.
    // Getting this backwards fails at connect time rather than silently
    // sending in the clear, but it fails every night, so derive it.
    secure: port === 465,
    auth: { user, pass },
  });

  return cached;
}

/**
 * CLAUDE.md: use "PlaypenGo" in "the PWA manifest, and email subject lines/sender
 * name". The address falls back to the SMTP user, which is what most free tiers
 * require the envelope sender to be anyway.
 */
function from(): string {
  const address = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  return `PlaypenGo <${address}>`;
}

export type SendRequest = {
  supabase: SupabaseClient<Database>;
  recipientId: string;
  to: string;
  /** The recipient's local date — never the server's. */
  sendDate: string;
  emailType: EmailType;
  subject: string;
  element: ReactElement;
  /** The composed digest, kept on the log row as the audit trail. */
  payload: unknown;
};

/** Postgres unique_violation — the idempotency guard doing its job. */
const UNIQUE_VIOLATION = "23505";

/**
 * Take tonight's slot for this person, if it is still free.
 *
 * The order is the whole point: claim first, send second. Two concurrent runs
 * then race on a unique index rather than on an inbox, and the loser is told
 * the row already exists. Checking first and sending second leaves a window
 * between the two in which both runs see nothing and both send.
 *
 * A previous `failed` row is re-claimable, and only a `failed` one. A digest
 * that was actually delivered must never go twice; one that never left the
 * building should be retried on the next firing, and §7.2 keeps the vercel.json
 * cron precisely so there is a second firing.
 */
async function claimSlot(
  request: SendRequest,
  status: "sent" | "skipped_empty",
): Promise<"claimed" | "taken"> {
  const { supabase, recipientId, sendDate, emailType, subject, payload } = request;

  const row = {
    recipient_id: recipientId,
    send_date: sendDate,
    email_type: emailType,
    subject_line: subject,
    payload: payload as never,
    status,
  };

  const insert = await supabase.from("email_log").insert(row);
  if (!insert.error) return "claimed";
  if (insert.error.code !== UNIQUE_VIOLATION) throw insert.error;

  // Somebody already wrote tonight's row. Only a failure may be retaken, and
  // the `eq("status", "failed")` is what makes that atomic: a concurrent run
  // that just flipped the row to 'sent' matches nothing here.
  const retake = await supabase
    .from("email_log")
    .update(row)
    .eq("recipient_id", recipientId)
    .eq("send_date", sendDate)
    .eq("email_type", emailType)
    .eq("status", "failed")
    .select("id");

  if (retake.error) throw retake.error;
  return (retake.data?.length ?? 0) > 0 ? "claimed" : "taken";
}

async function markFailed(request: SendRequest, message: string): Promise<void> {
  await request.supabase
    .from("email_log")
    .update({ status: "failed", subject_line: `${request.subject} — ${message}`.slice(0, 500) })
    .eq("recipient_id", request.recipientId)
    .eq("send_date", request.sendDate)
    .eq("email_type", request.emailType);
}

/**
 * §7.1: "If every section is empty, nothing is sent." The row is still written,
 * so a quiet evening is distinguishable from a cron that never fired — and it
 * takes the slot, so a second firing does not reconsider.
 */
export async function logSkippedEmpty(request: SendRequest): Promise<SendOutcome> {
  const claimed = await claimSlot(request, "skipped_empty");
  return claimed === "claimed" ? "skipped_empty" : "already_sent";
}

/** Claim, render, send — and record a failure so the next firing can retry. */
export async function sendDigest(request: SendRequest): Promise<SendOutcome> {
  const claimed = await claimSlot(request, "sent");
  if (claimed === "taken") return "already_sent";

  try {
    const { html, text } = await renderEmail(request.element);
    await deliver({ to: request.to, subject: request.subject, html, text });
    return "sent";
  } catch (error) {
    await markFailed(request, error instanceof Error ? error.message : "send failed");
    return "failed";
  }
}

/**
 * Render a template to the HTML and plain-text pair every message carries.
 *
 * The text part is not optional politeness: a message with no text/plain
 * alternative scores worse with spam filters, and this app's whole delivery
 * channel is one address on a free tier.
 */
export async function renderEmail(element: ReactElement) {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { html, text };
}

export async function deliver(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  await transport().sendMail({
    from: from(),
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
}
