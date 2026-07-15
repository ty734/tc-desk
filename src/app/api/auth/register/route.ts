import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { name, email, password, token } = await req.json();
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Name, email, and a password of at least 8 characters are required." },
      { status: 400 }
    );
  }
  const normalizedEmail = email.trim().toLowerCase();

  const userCount = await db.user.count();
  let invite = null;

  if (userCount > 0) {
    // After the first account, registration is invite-only.
    if (!token) {
      return NextResponse.json(
        { error: "Registration is invite-only. Ask for an invite link." },
        { status: 403 }
      );
    }
    invite = await db.invite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt) {
      return NextResponse.json({ error: "This invite link is invalid or was already used." }, { status: 403 });
    }
  }

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists. Try logging in." }, { status: 409 });
  }

  const user = await db.user.create({
    data: { name: name.trim(), email: normalizedEmail, passwordHash: await hashPassword(password) },
  });

  if (invite) {
    await db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    if (invite.boardId) {
      await db.boardMember.create({ data: { boardId: invite.boardId, userId: user.id } });
    }
  }

  // Every agent automatically joins all inbox (support) boards — the primary
  // board AND the dedicated Social board where one exists. The first account
  // becomes their owner.
  const inboxes = await db.inbox.findMany({ select: { boardId: true, socialBoardId: true } });
  const joinBoardIds = new Set(
    inboxes.flatMap((i) => (i.socialBoardId ? [i.boardId, i.socialBoardId] : [i.boardId]))
  );
  for (const boardId of joinBoardIds) {
    await db.boardMember.upsert({
      where: { boardId_userId: { boardId, userId: user.id } },
      create: { boardId, userId: user.id, role: userCount === 0 ? "owner" : "member" },
      update: {},
    });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
