import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature } from "@/lib/twilio";
import { resolveOutboundCallerId, logOutboundCall } from "@/lib/voice-ingest";
import { twiml, xmlEscape } from "@/lib/voice-twiml";

// The TwiML App's Voice Request URL. Hit when an agent's softphone places an
// outbound call (device.connect({ params: { To, ticketId, brand } })). Twilio
// sends From = "client:<agentUserId>". We dial the customer with the brand's
// Twilio number as caller ID, and log the call on a ticket (best-effort).

export const maxDuration = 60;

/** Normalize a dialed number to E.164 (assumes US for bare 10-digit input). */
function toE164(raw: string): string | null {
  const s = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  return null;
}

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  const to = toE164((params.To || "").trim());
  const callSid = (params.CallSid || "").trim();
  const ticketId = (params.ticketId || "").trim() || undefined;
  const brand = (params.brand || "").trim() || undefined;
  const agentUserId = params.From?.startsWith("client:")
    ? params.From.slice("client:".length)
    : null;

  if (!to) {
    return twiml(`<Say voice="alice">Sorry, that number can't be dialed. Goodbye.</Say><Hangup/>`);
  }

  // Null means "no number configured" OR "more than one brand and nothing told
  // us which" — we refuse rather than risk showing the wrong brand's caller ID.
  const callerId = await resolveOutboundCallerId({ ticketId, brand });
  if (!callerId) {
    console.error("[voice/outbound] no caller ID", { ticketId, brand, to });
    return twiml(
      `<Say voice="alice">This call could not be placed because no outbound ` +
        `number was selected. Goodbye.</Say><Hangup/>`,
    );
  }

  // Log the call without blocking it if the DB write hiccups.
  try {
    await logOutboundCall({ to, callSid, agentUserId, ticketId, brand });
  } catch (err) {
    console.error("[voice/outbound] logging failed", err);
  }

  return twiml(
    `<Dial callerId="${xmlEscape(callerId)}" answerOnBridge="true">` +
      `<Number>${xmlEscape(to)}</Number></Dial>`,
  );
}
