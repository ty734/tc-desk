import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature, softphoneConfigured } from "@/lib/twilio";
import { inboxByNumber, routeInboundCall } from "@/lib/voice-ingest";
import { onlineAgents } from "@/lib/livechat";
import { twiml, voicemailPrompt, dialAgents } from "@/lib/voice-twiml";

// Twilio Voice webhook — the "A call comes in" URL on each brand's number.
// Authenticated by X-Twilio-Signature, brand-routed by the dialed (To) number.
//
// Phase 2: if any agent is checked in, ring their browser softphones; if nobody
// answers within the dial timeout, /api/voice/dial-status drops the caller into
// voicemail. If no agent is checked in at all, go straight to voicemail. Either
// way the call is logged as a ticket first (routeInboundCall).

export const maxDuration = 60;

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
    return twiml(
      `<Say voice="alice">Thanks for calling. This line is not yet in service. Goodbye.</Say><Hangup/>`,
    );
  }

  // Log the call as a ticket now, while we have From/To.
  try {
    await routeInboundCall(inbox, from, callSid);
  } catch (err) {
    console.error("[voice/incoming] routing failed", err);
  }

  // Ring every online agent's browser; fall through to voicemail if none answer.
  // Only when the softphone is configured — otherwise no browser can register,
  // so dialing would just ring into the void before voicemail (Phase-1 behavior).
  if (softphoneConfigured()) {
    let agentIds: string[] = [];
    try {
      const agents = await onlineAgents();
      agentIds = agents.map((a) => a.userId);
    } catch (err) {
      console.error("[voice/incoming] presence lookup failed", err);
    }
    if (agentIds.length > 0) {
      return twiml(dialAgents(agentIds));
    }
  }
  return twiml(voicemailPrompt(inbox.name));
}
