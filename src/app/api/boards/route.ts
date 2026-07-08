import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// List the caller's boards (JSON) — used by the agent API and My Tasks tooling.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  const memberships = await db.boardMember.findMany({
    where: { userId: user.id },
    include: {
      board: { include: { columns: { orderBy: { position: "asc" }, select: { id: true, name: true } } } },
    },
  });
  const boards = memberships
    .map((m) => ({ ...m.board, role: m.role }))
    .filter((b) => !b.archived)
    .sort((a, b) => a.position - b.position);
  return NextResponse.json({ boards });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Board name is required." }, { status: 400 });

  const last = await db.board.findFirst({ orderBy: { position: "desc" } });
  const board = await db.board.create({
    data: {
      name: name.trim(),
      position: (last?.position ?? 0) + 1,
      members: { create: { userId: user.id, role: "owner" } },
      columns: {
        create: [
          { name: "New", position: 1 },
          { name: "Open", position: 2 },
          { name: "Pending", position: 3 },
          { name: "Solved", position: 4 },
          { name: "Closed", position: 5 },
        ],
      },
    },
  });
  return NextResponse.json({ board });
}
