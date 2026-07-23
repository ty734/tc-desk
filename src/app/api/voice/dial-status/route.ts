import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature } from "@/lib/twilio";
import { inboxByNumber, markCallAnswered } from "@/lib/voice-ingest";
import { twiml, voicemailPrompt } from "@/lib/voice-twiml";

// The <Dial action> callback from /api/voice/incoming. Twilio POSTs here when
// the agent dial finishes. If an agent answered (DialCallStatus "completed"),
// the call is over — record that on the ticket and hang up. Otherwise nobody
// picked up, so drop to voicemail (recording still attaches to the ticket via
// /api/voice/recording, keyed by the same CallSid the incoming webhook logged).

export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  // completed = an agent answered and the call ended normally.
  if (params.DialCallStatus === "completed") {
    // CallSid here is the parent (inbound) call — the same one routeInboundCall
    // keyed the Message on. DialCallDuration is the answered leg, in seconds.
    const callSid = params.CallSid?.trim();
    const dur = Number.parseInt(params.DialCallDuration ?? "", 10);
    if (callSid) {
      try {
        await markCallAnswered(callSid, Number.isFinite(dur) ? dur : null);
      } catch (err) {
        console.error("[voice/dial-status] answered-marking failed", err);
      }
    }
    return twiml(`<Hangup/>`);
  }

  // no-answer | busy | failed | canceled → voicemail.
  const to = params.To?.trim();
  const inbox = to ? await inboxByNumber(to) : null;
  return twiml(voicemailPrompt(inbox?.name ?? "our support team"));
}
