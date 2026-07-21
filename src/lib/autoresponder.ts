import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sendCustomerEmail } from "@/lib/mailer";

// AI-tailored first-response acknowledgment. Fires on a customer's FIRST email
// (new ticket only), once. It acknowledges and lightly reflects the topic but
// NEVER answers, promises, quotes prices/policies, or makes product/health
// claims. A human follows up. Junk/marketing/automated mail gets no reply.

const MODEL = "claude-sonnet-5";

// Cheap deterministic pre-filter — never auto-reply to these (loop/spam guard).
const NOISE_DOMAINS = [
  "manychat.com",
  "rechargemail.com",
  "shopify.com",
  "mrsmeyers.com",
  "mangovoice.com",
  "amazonses.com",
  "bounces.",
  "mailer-daemon",
];
export function isLikelyNoise(fromEmail: string, subject: string): string | null {
  const f = fromEmail.toLowerCase();
  const s = (subject ?? "").toLowerCase();
  if (/no-?reply|noreply|no_reply|do-?not-?reply|mailer-daemon|postmaster/.test(f))
    return "no-reply/system sender";
  if (NOISE_DOMAINS.some((d) => f.includes(d))) return "notification/marketing domain";
  if (/^(automatic reply|auto(matic)? response|out of office|undeliverable|delivery status)/i.test(s))
    return "auto-reply/bounce subject";
  return null;
}

// Desk noise cleanup — HIGH-CONFIDENCE junk only, so a real customer is never
// archived. Deliberately tight: bounces/auto-replies and a short list of
// pure-notification/marketing senders that are NEVER a customer. Excludes
// shopify.com ("New customer message" forwards a real buyer) and voicemail.
const JUNK_ONLY_DOMAINS = ["manychat.com", "rechargemail.com", "mrsmeyers.com", "klaviyomail.com"];
export function isDeskJunk(fromEmail: string, subject: string): string | null {
  const f = fromEmail.toLowerCase();
  const s = (subject ?? "").toLowerCase();
  // Never archive real customer forwards / voicemails.
  if (f.includes("shopify.com") || f.includes("mangovoice")) return null;
  if (/mailer-daemon|postmaster|^bounce|delivery-?status/.test(f)) return "bounce/system";
  if (/^(automatic reply|auto(matic)? response|out of office|undeliverable|delivery status notification|returned mail|mail delivery)/i.test(s))
    return "auto-reply/bounce";
  if (JUNK_ONLY_DOMAINS.some((d) => f.endsWith(d))) return "notification/marketing sender";
  return null;
}

type Inbound = { fromName: string | null; fromEmail: string; subject: string; bodyText: string };
type Decision = { respond: boolean; reason: string; reply?: string };

function systemPrompt(brand: string): string {
  if (brand === "longer-together") {
    return `You are the first-response assistant for Longer Together Pet Co's customer support inbox. Longer Together is a family-run pet-health brand; its product is Daily Dental Defense, a daily dental-support topper for dogs (a supplement, not a medicine). A message just arrived at the support inbox. Do two things:

1) DECIDE whether this is a REAL customer (a pet parent) who should get a friendly acknowledgment, or junk that should get NO reply.
   - respond=false for: sales/marketing pitches, cold outreach, agency/SEO/affiliate/partnership/collab solicitations, investment or supplier offers, newsletters, automated notifications, spam, or anything not from an actual customer with a genuine question or issue.
   - respond=true for: a real customer asking about an order, the product, shipping, a return, how to use it, their pet, a problem, or any sincere inquiry. When genuinely unsure but it reads like a real person, lean respond=true.

2) IF respond=true, write a SHORT acknowledgment following these rules exactly:
   - Warm, human, plain-spoken, 2 to 4 sentences, like a fellow pet lover. No em dashes. No shame or fear.
   - Acknowledge you received their message and LIGHTLY reflect their topic ("about your order", "your question about Daily Dental Defense", "about your pup") WITHOUT answering it.
   - Make NO specific commitments: no refund/replacement/shipping promises, no prices, no policies, no product claims. It is a supplement, not a medicine: never use drug-claim words (treat, cure, prevent, heal, fights, kills, reverses), and never call it a probiotic. You do not need to describe the product at all in an acknowledgment.
   - If the message involves the pet's health, a symptom, medication, or anything medical, keep it EXTRA gentle and neutral, do NOT engage the health topic, and gently note that for anything about their pet's health they should check with their veterinarian; assure them the team will help with everything else.
   - Tell them a member of the team will personally reply within 1 to 2 business days.
   - End with the sign-off line exactly: "Warmly,\\nLonger Together Support". Do not invent a personal name.
   - Output ONLY the email body text (no subject line).

Return ONLY valid JSON, no prose, in this shape:
{"respond": true, "reason": "<short>", "reply": "<email body>"}
or
{"respond": false, "reason": "<short>", "reply": ""}`;
  }
  return `You are the first-response assistant for Living Well with Dr. Michelle's customer support inbox. A message just arrived at support@. Do two things:

1) DECIDE whether this is a REAL customer who should get a friendly acknowledgment, or junk that should get NO reply.
   - respond=false for: sales/marketing pitches, cold outreach, agency/SEO/affiliate/partnership/collab solicitations, investment or supplier offers, newsletters, automated notifications, spam, or anything not from an actual customer with a genuine question or issue.
   - respond=true for: a real customer asking about an order, product, subscription, return, shipping, usage, a problem, or any sincere inquiry. When genuinely unsure but it reads like a real person, lean respond=true.

2) IF respond=true, write a SHORT acknowledgment following these rules exactly:
   - Warm, human, 2 to 4 sentences. Plain language. No em dashes. No shame or fear.
   - Acknowledge you received their message and LIGHTLY reflect their topic ("about your order", "about your subscription", "your question about our tooth powder") WITHOUT answering it.
   - Make NO specific commitments: no refund/replacement/shipping promises, no prices, no policies, no product or health claims. Never use drug-claim words (treat, cure, prevent, heal, fights, kills, reverses).
   - If the message involves a health concern, symptom, or anything medical, keep it EXTRA gentle and neutral and do NOT engage the health topic at all, just assure them the team will help.
   - Tell them a member of the team will personally reply within 1 to 2 business days.
   - End with the sign-off line exactly: "Warmly,\\nLiving Well Support Team". Do not invent a personal name.
   - Output ONLY the email body text (no subject line).

Return ONLY valid JSON, no prose, in this shape:
{"respond": true, "reason": "<short>", "reply": "<email body>"}
or
{"respond": false, "reason": "<short>", "reply": ""}`;
}

export async function evaluateAndDraft(m: Inbound, brand: string): Promise<Decision> {
  const noise = isLikelyNoise(m.fromEmail, m.subject);
  if (noise) return { respond: false, reason: `pre-filter: ${noise}` };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { respond: false, reason: "no API key" };

  const userContent = `New email to support@:
From: ${m.fromName ?? "(no name)"} <${m.fromEmail}>
Subject: ${m.subject || "(no subject)"}

${(m.bodyText || "(no body)").slice(0, 3000)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 900,
      system: systemPrompt(brand),
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    console.error("[autoresponder] anthropic error", res.status);
    return { respond: false, reason: `model error ${res.status}` };
  }
  const data = await res.json();
  const text = (data.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
  try {
    const json = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    if (json && typeof json.respond === "boolean") {
      return {
        respond: json.respond,
        reason: String(json.reason ?? ""),
        reply: typeof json.reply === "string" ? json.reply.trim() : undefined,
      };
    }
  } catch {
    console.error("[autoresponder] could not parse decision:", text.slice(0, 200));
  }
  return { respond: false, reason: "unparseable decision" };
}

// Sends the acknowledgment as a threaded customer email and records it as an
// outbound Message (authorId null = system-sent). Returns the message id or null.
export async function sendAutoReply(opts: {
  inbox: { supportEmail: string; fromName: string; sendingDomain: string };
  ticketId: string;
  ticketSubject: string;
  customerEmail: string;
  inboundMessageIdHeader: string | null;
  replyText: string;
}): Promise<string | null> {
  const subject = /^re:/i.test(opts.ticketSubject) ? opts.ticketSubject : `Re: ${opts.ticketSubject}`;
  const text = opts.replyText.trim();
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#1e1f21;white-space:pre-wrap">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</div>`;
  const ourMessageId = `tkt-${opts.ticketId}-${randomBytes(6).toString("hex")}@${opts.inbox.sendingDomain}`;
  const refs = opts.inboundMessageIdHeader ? [opts.inboundMessageIdHeader] : [];

  const sent = await sendCustomerEmail({
    from: `${opts.inbox.fromName} <${opts.inbox.supportEmail}>`,
    to: opts.customerEmail,
    replyTo: opts.inbox.supportEmail,
    subject,
    textBody: text,
    htmlBody: html,
    messageId: ourMessageId,
    inReplyTo: opts.inboundMessageIdHeader,
    references: refs,
  });
  if (!sent.ok) {
    console.error("[autoresponder] send failed:", sent.error);
    return null;
  }
  const message = await db.message.create({
    data: {
      ticketId: opts.ticketId,
      direction: "outbound",
      authorId: null, // system-sent (no human author)
      fromAddr: opts.inbox.supportEmail,
      toAddr: opts.customerEmail,
      subject,
      bodyText: text,
      bodyHtml: html,
      messageIdHeader: sent.messageIdHeader,
      inReplyTo: opts.inboundMessageIdHeader,
      references: refs.map((r) => `<${r}>`).join(" ") || null,
      provider: "postmark",
      providerMessageId: sent.providerMessageId,
    },
  });
  return message.id;
}
