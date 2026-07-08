import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { token, password } = await req.json();
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const reset = token
    ? await db.passwordReset.findUnique({ where: { token }, include: { user: true } })
    : null;
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "This reset link is invalid or expired. Request a new one." },
      { status: 403 }
    );
  }

  await db.user.update({
    where: { id: reset.userId },
    data: { passwordHash: await hashPassword(password) },
  });
  await db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
  // Invalidate all existing sessions, then start a fresh one.
  await db.session.deleteMany({ where: { userId: reset.userId } });
  await createSession(reset.userId);

  return NextResponse.json({ ok: true });
}
