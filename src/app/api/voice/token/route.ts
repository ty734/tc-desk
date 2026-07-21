import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { mintVoiceToken } from "@/lib/twilio";

// Mints the softphone access token for the logged-in agent. Identity = user.id,
// which the inbound webhook dials as <Client>{user.id}</Client>. Session-authed
// like every other agent-facing route; the id is derived server-side from the
// cookie, never trusted from the client.

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  try {
    const token = mintVoiceToken(user.id);
    return NextResponse.json({ token, identity: user.id });
  } catch (err) {
    // Env not configured yet — the softphone stays dormant rather than crashing.
    console.error("[voice/token] not configured", err);
    return NextResponse.json({ error: "Voice not configured." }, { status: 503 });
  }
}
