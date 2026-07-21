import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { setVoiceAvailable, isVoiceAvailable } from "@/lib/voice-presence";

// Softphone availability. GET reads the current state; POST { on } toggles it
// and (when on) doubles as the heartbeat the softphone sends every ~20s.

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  return NextResponse.json({ available: await isVoiceAvailable(user.id) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const on = body?.on !== false; // default true (also the heartbeat)
  await setVoiceAvailable(user.id, on);
  return NextResponse.json({ available: on });
}
