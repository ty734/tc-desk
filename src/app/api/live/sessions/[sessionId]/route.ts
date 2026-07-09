import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { appendChatMessage, entries } from "@/lib/livechat";

async function authorize(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    include: { agent: { select: { id: true, name: true } } },
  });
  if (!session) return { error: NextResponse.json({ error: "Session not found." }, { status: 404 }) };
  return { user, session };
}

// Agent view of one conversation (polled while the chat is open).
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const auth = await authorize(sessionId);
  if (auth.error) return auth.error;
  const { session } = auth;
  return NextResponse.json({
    id: session.id,
    status: session.status,
    visitorName: session.visitorName,
    visitorEmail: session.visitorEmail,
    agent: session.agent,
    messages: entries(session.messages),
  });
}

// Agent actions: accept | message | end.
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const auth = await authorize(sessionId);
  if (auth.error) return auth.error;
  const { user, session } = auth;

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "accept") {
    // First accept wins — guard on status still being "waiting".
    const claimed = await db.chatSession.updateMany({
      where: { id: sessionId, status: "waiting" },
      data: { status: "live", agentId: user.id, waitingSince: null },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: "Chat was already taken (or expired)." }, { status: 409 });
    }
    await appendChatMessage(sessionId, {
      role: "system",
      content: `${user.name} joined the chat`,
    });
    return NextResponse.json({ ok: true, status: "live" });
  }

  if (action === "message") {
    if (session.status !== "live") {
      return NextResponse.json({ error: "Chat is not live." }, { status: 400 });
    }
    const content = String(body.content ?? "").trim();
    if (!content) return NextResponse.json({ error: "Empty message." }, { status: 400 });
    const entry = await appendChatMessage(sessionId, {
      role: "agent",
      name: user.name,
      content: content.slice(0, 4000),
    });
    return NextResponse.json({ ok: true, entry });
  }

  if (action === "end") {
    await db.chatSession.update({
      where: { id: sessionId },
      data: { status: "ended" },
    });
    await appendChatMessage(sessionId, {
      role: "system",
      content: "Chat ended. You can keep typing to ask the assistant anything else.",
    });
    return NextResponse.json({ ok: true, status: "ended" });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
