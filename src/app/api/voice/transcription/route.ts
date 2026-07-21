import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature } from "@/lib/twilio";
import { attachTranscript } from "@/lib/voice-ingest";

// Twilio transcribeCallback for voicemail (set on the <Record> in voice-twiml).
// Arrives separately from the recording; matches back to the voicemail Message
// by CallSid and appends the transcript text. Degrades silently if Twilio
// transcription is unavailable or empty.

export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  const status = params.TranscriptionStatus;
  if (status && status !== "completed") {
    return NextResponse.json({ ok: true, skipped: `status=${status}` });
  }
  const callSid = (params.CallSid || "").trim();
  const text = (params.TranscriptionText || "").trim();
  if (!callSid || !text) {
    return NextResponse.json({ ok: true, skipped: "no transcript" });
  }

  try {
    await attachTranscript(callSid, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[voice/transcription] failed", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
