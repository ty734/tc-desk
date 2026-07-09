import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Live-chat plumbing shared by the public widget routes and the agent desk.
// A ChatSession moves: bot -> waiting (visitor asked for a person while an
// agent was checked in) -> live (agent accepted) -> ended (or back to bot on
// the no-accept timeout, which falls back to the email-ticket handoff).

export const PRESENCE_TTL_MS = 35_000; // heartbeat window — stale rows ignored
export const WAITING_TIMEOUT_MS = 90_000; // no agent accepted -> fall back

export type ChatEntry = {
  role: "user" | "assistant" | "agent" | "system";
  content: string;
  name?: string;
  at?: string;
};

/** Atomic jsonb append — safe under concurrent visitor/agent writes. */
export async function appendChatMessage(sessionId: string, entry: ChatEntry) {
  const withTs = { ...entry, at: new Date().toISOString() };
  await db.$executeRaw`
    UPDATE "ChatSession"
    SET messages = messages || ${JSON.stringify([withTs])}::jsonb,
        "updatedAt" = now()
    WHERE id = ${sessionId}
  `;
  return withTs;
}

/** Agents currently checked in with a fresh heartbeat. */
export async function onlineAgents() {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
  return db.agentPresence.findMany({
    where: { lastSeenAt: { gte: cutoff } },
    include: { user: { select: { id: true, name: true } } },
  });
}

/**
 * Expire a waiting session whose request nobody accepted: back to bot mode,
 * with an apologetic bot message steering to the email-ticket path. Called
 * lazily from the widget poll route.
 */
export async function expireStaleWaiting(sessionId: string) {
  const cutoff = new Date(Date.now() - WAITING_TIMEOUT_MS);
  const flipped = await db.chatSession.updateMany({
    where: { id: sessionId, status: "waiting", waitingSince: { lt: cutoff } },
    data: { status: "bot", waitingSince: null },
  });
  if (flipped.count > 0) {
    await appendChatMessage(sessionId, {
      role: "assistant",
      content:
        "It looks like our team just stepped away. If you share your email address, I'll create a ticket and someone will get back to you soon.",
    });
  }
}

export function entries(messages: Prisma.JsonValue): ChatEntry[] {
  return Array.isArray(messages) ? (messages as ChatEntry[]) : [];
}
