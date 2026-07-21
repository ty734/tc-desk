import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature } from "@/lib/twilio";
import { inboxByNumber, routeInboundCall } from "@/lib/voice-ingest";

// Twilio Voice webhook — set as the "A CALL COMES IN" URL on each brand's
// number (Phase 1). Authenticated by X-Twilio-Signature, brand-routed by the
// dialed (To) number. Phase 1 is voicemail-only: greet, record, hang up; the
// recording callback (/api/voice/recording) attaches the audio to the ticket.
// Phase 2 slots a <Dial><Client> to online agents ABOVE the <Record>.

export const maxDuration = 60;

const ESCAPE: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "'": "&apos;",
  '"': "&quot;",
};
function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ESCAPE[c]);
}

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  const to = params.To?.trim();
  const from = params.From?.trim() || "unknown";
  const callSid = params.CallSid?.trim();
  if (!to || !callSid) {
    return twiml(`<Say voice="alice">Sorry, something went wrong. Goodbye.</Say><Hangup/>`);
  }

  const inbox = await inboxByNumber(to);
  if (!inbox) {
    // Number not yet mapped to a brand (run scripts/setup-voice-brand.ts).
    return twiml(
      `<Say voice="alice">Thanks for calling. This line is not yet in service. Goodbye.</Say><Hangup/>`,
    );
  }

  // Log the call as a ticket now, while we have From/To. If this throws we still
  // let the caller leave a voicemail — we just may miss the ticket for this call.
  try {
    await routeInboundCall(inbox, from, callSid);
  } catch (err) {
    console.error("[voice/incoming] routing failed", err);
  }

  const greeting =
    `Thank you for calling ${inbox.name}. ` +
    `No one is available to take your call right now. ` +
    `Please leave a message after the tone, and we'll get back to you as soon as possible.`;

  return twiml(
    `<Say voice="alice">${xmlEscape(greeting)}</Say>` +
      `<Record maxLength="120" playBeep="true" trim="trim-silence" ` +
      `recordingStatusCallback="/api/voice/recording" ` +
      `recordingStatusCallbackEvent="completed" />` +
      `<Say voice="alice">Thank you. Goodbye.</Say><Hangup/>`,
  );
}
