import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { entries } from "@/lib/livechat";

// Search past live chats by visitor name/email or transcript content. Read-only.
// Covers all sessions (including archived), so agents can find an old chat when
// a customer says "I already talked to someone about this."
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const like = `%${q}%`;
  const rows = await db.$queryRaw<
    { id: string; visitorName: string | null; visitorEmail: string | null; status: string; updatedAt: Date; messages: unknown }[]
  >`
    SELECT id, "visitorName", "visitorEmail", status, "updatedAt", messages
    FROM "ChatSession"
    WHERE "visitorName" ILIKE ${like}
       OR "visitorEmail" ILIKE ${like}
       OR CAST(messages AS text) ILIKE ${like}
    ORDER BY "updatedAt" DESC
    LIMIT 30
  `;

  const results = rows.map((s) => {
    const msgs = entries(s.messages as Parameters<typeof entries>[0]);
    const last = msgs[msgs.length - 1];
    return {
      id: s.id,
      status: s.status,
      visitorName: s.visitorName,
      visitorEmail: s.visitorEmail,
      updatedAt: s.updatedAt,
      messageCount: msgs.length,
      preview: last
        ? `${last.role === "user" ? "Customer" : last.name ?? "Bot"}: ${last.content.slice(0, 90)}`
        : "",
    };
  });

  return NextResponse.json({ results });
}
