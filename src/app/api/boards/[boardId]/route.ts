import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";

// Full board JSON (columns, tickets, fields, members) for the agent API and tooling.
export async function GET(_req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  if (!(await getBoardMembership(user.id, boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } },
      columns: {
        orderBy: { position: "asc" },
        include: {
          tickets: {
            where: { archived: false },
            orderBy: { position: "asc" },
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              fieldValues: true,
            },
          },
        },
      },
    },
  });
  return NextResponse.json({ board });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const membership = await getBoardMembership(user.id, boardId);
  if (!membership) return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  if (membership.role !== "owner") {
    return NextResponse.json({ error: "Only the board owner can rename or archive a board." }, { status: 403 });
  }

  const { name, archived } = await req.json();
  const board = await db.board.update({
    where: { id: boardId },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(archived !== undefined ? { archived: Boolean(archived) } : {}),
    },
  });
  return NextResponse.json({ board });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const membership = await getBoardMembership(user.id, boardId);
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the board owner can delete a board." }, { status: 403 });
  }
  await db.board.delete({ where: { id: boardId } });
  return NextResponse.json({ ok: true });
}
