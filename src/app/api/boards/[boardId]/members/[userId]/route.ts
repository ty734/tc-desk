import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ boardId: string; userId: string }> }
) {
  const { boardId, userId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const membership = await getBoardMembership(user.id, boardId);
  // Owners can remove anyone; members can remove themselves (leave board).
  if (!membership || (membership.role !== "owner" && user.id !== userId)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const target = await getBoardMembership(userId, boardId);
  if (!target) return NextResponse.json({ error: "Not a member." }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ error: "The board owner cannot be removed." }, { status: 400 });
  }

  await db.boardMember.delete({ where: { boardId_userId: { boardId, userId } } });
  return NextResponse.json({ ok: true });
}
