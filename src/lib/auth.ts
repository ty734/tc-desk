import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { id, userId, expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (id) {
    await db.session.deleteMany({ where: { id } });
    cookieStore.delete(SESSION_COOKIE);
  }
}

/**
 * Resolves the current user from either:
 * 1. `Authorization: Bearer <AGENT_SECRET>` — the agent/API integration, which
 *    acts as the admin user (AGENT_USER_EMAIL). Used by Claude to manage tickets.
 * 2. The session cookie (normal browser login).
 */
export async function getCurrentUser() {
  const agentSecret = process.env.AGENT_SECRET;
  if (agentSecret) {
    const headerStore = await headers();
    const auth = headerStore.get("authorization");
    if (auth === `Bearer ${agentSecret}`) {
      const email = process.env.AGENT_USER_EMAIL ?? "tycoles@gmail.com";
      const agentUser = await db.user.findUnique({ where: { email } });
      if (agentUser) return agentUser;
    }
  }

  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const session = await db.session.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

/**
 * KB Trainer access — a small email allow-list (env `KB_TRAINER_EMAILS`,
 * comma-separated) rather than a role column, matching how `AGENT_USER_EMAIL`
 * already gates the agent path. Only these users see the Trainer widget and can
 * write to the knowledge base. Fails CLOSED: if the env var is unset, no one has
 * access (set it in the tc-desk Vercel project to turn the feature on).
 */
export function kbTrainerEmails(): string[] {
  return (process.env.KB_TRAINER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isKbTrainer(email: string | null | undefined): boolean {
  if (!email) return false;
  return kbTrainerEmails().includes(email.toLowerCase());
}

/** Returns the user's membership row for the board, else null. */
export async function getBoardMembership(userId: string, boardId: string) {
  return db.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
  });
}

/** True when the user is the board's owner. */
export async function isBoardOwner(userId: string, boardId: string) {
  const membership = await getBoardMembership(userId, boardId);
  return membership?.role === "owner";
}
