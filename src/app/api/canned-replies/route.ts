import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const cannedReplies = await db.cannedReply.findMany({ orderBy: { title: "asc" } });
  return NextResponse.json({ cannedReplies });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const { title, body } = await req.json();
  if (!title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "Title and body are required." }, { status: 400 });
  }
  const cannedReply = await db.cannedReply.create({
    data: { title: title.trim(), body: body.trim() },
  });
  return NextResponse.json({ cannedReply });
}
