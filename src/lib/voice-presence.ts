import { db } from "@/lib/db";

// Phone-call availability, separate from live-chat check-in (AgentPresence).
// An agent is "available for calls" while the softphone heartbeats a VoicePresence
// row; the inbound webhook rings only these agents. Presence = a fresh heartbeat.

export const VOICE_PRESENCE_TTL_MS = 40_000; // heartbeat window (softphone beats ~20s)

/** Agents currently available for calls (fresh heartbeat). */
export async function onlineVoiceAgents() {
  const cutoff = new Date(Date.now() - VOICE_PRESENCE_TTL_MS);
  return db.voicePresence.findMany({
    where: { lastSeenAt: { gte: cutoff } },
    select: { userId: true },
  });
}

/** Toggle availability. `on` also serves as the heartbeat (bumps lastSeenAt). */
export async function setVoiceAvailable(userId: string, on: boolean) {
  if (on) {
    await db.voicePresence.upsert({
      where: { userId },
      create: { userId },
      update: { lastSeenAt: new Date() },
    });
  } else {
    await db.voicePresence.deleteMany({ where: { userId } });
  }
}

export async function isVoiceAvailable(userId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - VOICE_PRESENCE_TTL_MS);
  const row = await db.voicePresence.findFirst({
    where: { userId, lastSeenAt: { gte: cutoff } },
    select: { userId: true },
  });
  return !!row;
}
