import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/mailer";

export async function POST(req: Request) {
  const { email } = await req.json();
  const normalizedEmail = (email ?? "").trim().toLowerCase();

  // Always respond ok — never reveal whether an account exists.
  if (normalizedEmail) {
    const user = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (user) {
      const token = randomBytes(32).toString("hex");
      await db.passwordReset.create({
        data: { token, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      // Must await: on Vercel the function freezes after the response is sent,
      // so a fire-and-forget request to Resend never completes.
      await sendPasswordResetEmail({ to: user.email, token });
    }
  }
  return NextResponse.json({ ok: true });
}
