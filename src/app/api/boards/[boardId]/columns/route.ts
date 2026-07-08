import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  if (!(await getBoardMembership(user.id, boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Column name is required." }, { status: 400 });

  const last = await db.column.findFirst({ where: { boardId }, orderBy: { position: "desc" } });
  const column = await db.column.create({
    data: { boardId, name: name.trim(), position: (last?.position ?? 0) + 1 },
  });
  return NextResponse.json({ column });
}
