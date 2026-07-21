import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature } from "@/lib/twilio";
import { inboxByNumber } from "@/lib/voice-ingest";
import { twiml, voicemailPrompt } from "@/lib/voice-twiml";

// The <Dial action> callback from /api/voice/incoming. Twilio POSTs here when
// the agent dial finishes. If an agent answered (DialCallStatus "completed"),
// the call is over — hang up. Otherwise nobody picked up, so drop to voicemail
// (recording still attaches to the ticket via /api/voice/recording, keyed by
// the same CallSid the incoming webhook already logged).

export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  // completed = an agent answered and the call ended normally.
  if (params.DialCallStatus === "completed") {
    return twiml(`<Hangup/>`);
  }

  // no-answer | busy | failed | canceled → voicemail.
  const to = params.To?.trim();
  const inbox = to ? await inboxByNumber(to) : null;
  return twiml(voicemailPrompt(inbox?.name ?? "our support team"));
}
