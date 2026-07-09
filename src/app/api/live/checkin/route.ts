import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Toggle the agent's live-chat availability.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const { on } = await req.json().catch(() => ({ on: true }));
  if (on) {
    await db.agentPresence.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: { lastSeenAt: new Date() },
    });
  } else {
    await db.agentPresence.deleteMany({ where: { userId: user.id } });
  }
  return NextResponse.json({ checkedIn: !!on });
}
