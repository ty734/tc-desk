import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { entries, onlineAgents } from "@/lib/livechat";

// The Live Chat screen's poll: waiting + active sessions, presence roster,
// and (side effect) the caller's presence heartbeat while checked in.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  await db.agentPresence.updateMany({
    where: { userId: user.id },
    data: { lastSeenAt: new Date() },
  });

  const [sessions, agents] = await Promise.all([
    db.chatSession.findMany({
      where: { status: { in: ["waiting", "live"] } },
      include: {
        inbox: { select: { name: true, brand: true } },
        agent: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    onlineAgents(),
  ]);

  return NextResponse.json({
    checkedIn: agents.some((a) => a.userId === user.id),
    onlineAgents: agents.map((a) => ({ id: a.user.id, name: a.user.name })),
    sessions: sessions.map((s) => {
      const msgs = entries(s.messages);
      const last = msgs[msgs.length - 1];
      return {
        id: s.id,
        status: s.status,
        inbox: s.inbox.name,
        visitorName: s.visitorName,
        visitorEmail: s.visitorEmail,
        agent: s.agent ? { id: s.agent.id, name: s.agent.name } : null,
        waitingSince: s.waitingSince,
        updatedAt: s.updatedAt,
        preview: last ? `${last.role === "user" ? "Customer" : last.name ?? "Bot"}: ${last.content.slice(0, 90)}` : "",
        messageCount: msgs.length,
      };
    }),
  });
}
