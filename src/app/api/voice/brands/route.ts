import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { voiceInboxes } from "@/lib/voice-ingest";

// The brands an agent can place an outbound call as — i.e. every inbox with a
// Twilio number. The softphone dialer uses this to pick the caller ID, so a
// manual dial can't show a customer the other brand's number.

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const brands = await voiceInboxes();
  return NextResponse.json({ brands });
}
