import { NextResponse } from "next/server";
import { readTwilioParams, validateTwilioSignature } from "@/lib/twilio";
import { attachVoicemailRecording } from "@/lib/voice-ingest";

// Twilio recordingStatusCallback (referenced from the <Record> in
// /api/voice/incoming). Fires when a voicemail finishes uploading. Carries only
// the CallSid (no From/To), so it matches back to the Message the incoming
// webhook already created. Returning non-2xx makes Twilio retry, which is safe
// because attachVoicemailRecording is idempotent.

export const maxDuration = 60;

export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 401 });
  }

  const status = params.RecordingStatus;
  if (status && status !== "completed") {
    return NextResponse.json({ ok: true, skipped: `status=${status}` });
  }

  const callSid = params.CallSid?.trim();
  const recordingUrl = params.RecordingUrl?.trim();
  if (!callSid || !recordingUrl) {
    return NextResponse.json({ ok: true, skipped: "missing CallSid/RecordingUrl" });
  }

  const parsed = params.RecordingDuration ? parseInt(params.RecordingDuration, 10) : NaN;
  const durationSec = Number.isFinite(parsed) ? parsed : null;

  try {
    const result = await attachVoicemailRecording({ callSid, recordingUrl, durationSec });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[voice/recording] failed", err);
    return NextResponse.json({ ok: false, error: "recording processing failed" }, { status: 500 });
  }
}
