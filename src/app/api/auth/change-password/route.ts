import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  if (!(await verifyPassword(currentPassword ?? "", user.passwordHash))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Log out every other device/session; keep this one.
  const cookieStore = await cookies();
  const currentSession = cookieStore.get("session")?.value;
  await db.session.deleteMany({
    where: { userId: user.id, ...(currentSession ? { id: { not: currentSession } } : {}) },
  });

  return NextResponse.json({ ok: true });
}
