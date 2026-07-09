import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { entries, expireStaleWaiting } from "@/lib/livechat";

// Widget poll while waiting for / talking with a live agent. Public — the
// unguessable sessionId is the credential. Also lazily expires waiting
// sessions nobody accepted (fall back to the bot + email-ticket path).
export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId")?.slice(0, 64);
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId." }, { status: 400, headers });

  await expireStaleWaiting(sessionId);

  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    include: { agent: { select: { name: true } } },
  });
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404, headers });

  return NextResponse.json(
    {
      status: session.status,
      agentName: session.agent?.name ?? null,
      messages: entries(session.messages),
    },
    { headers }
  );
}
