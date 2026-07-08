import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";

async function authorize(columnId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  const column = await db.column.findUnique({ where: { id: columnId } });
  if (!column) return { error: NextResponse.json({ error: "Column not found." }, { status: 404 }) };
  if (!(await getBoardMembership(user.id, column.boardId))) {
    return { error: NextResponse.json({ error: "Not a member of this board." }, { status: 403 }) };
  }
  return { user, column };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ columnId: string }> }) {
  const { columnId } = await params;
  const auth = await authorize(columnId);
  if (auth.error) return auth.error;

  const { name, position } = await req.json();
  const column = await db.column.update({
    where: { id: columnId },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(position !== undefined ? { position: Number(position) } : {}),
    },
  });
  return NextResponse.json({ column });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ columnId: string }> }) {
  const { columnId } = await params;
  const auth = await authorize(columnId);
  if (auth.error) return auth.error;

  const ticketCount = await db.ticket.count({ where: { columnId } });
  if (ticketCount > 0) {
    return NextResponse.json(
      { error: "Move or delete the tickets in this column first." },
      { status: 400 }
    );
  }
  await db.column.delete({ where: { id: columnId } });
  return NextResponse.json({ ok: true });
}
