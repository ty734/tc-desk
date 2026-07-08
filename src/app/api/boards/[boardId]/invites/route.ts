import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership, isBoardOwner } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/mailer";

export async function POST(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  if (!(await isBoardOwner(user.id, boardId))) {
    return NextResponse.json({ error: "Only the board owner can invite people." }, { status: 403 });
  }

  const { email } = await req.json();
  const normalizedEmail = (email ?? "").trim().toLowerCase();
  if (!normalizedEmail) return NextResponse.json({ error: "Email is required." }, { status: 400 });

  const board = await db.board.findUnique({ where: { id: boardId } });
  if (!board) return NextResponse.json({ error: "Board not found." }, { status: 404 });

  // If they already have an account, just add them to the board.
  const existingUser = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    const existingMembership = await getBoardMembership(existingUser.id, boardId);
    if (existingMembership) {
      return NextResponse.json({ error: "That person is already on this board." }, { status: 409 });
    }
    await db.boardMember.create({ data: { boardId, userId: existingUser.id } });
    return NextResponse.json({ added: { id: existingUser.id, name: existingUser.name, email: existingUser.email } });
  }

  // Otherwise create an invite and email them a registration link.
  const token = randomBytes(24).toString("hex");
  await db.invite.create({
    data: { token, email: normalizedEmail, boardId, invitedById: user.id },
  });
  // Await — Vercel freezes the function after the response, killing unawaited sends.
  await sendInviteEmail({ to: normalizedEmail, inviterName: user.name, boardName: board.name, token });
  return NextResponse.json({ invited: normalizedEmail });
}
