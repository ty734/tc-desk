import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { sendNoteEmail, sendMentionEmail } from "@/lib/mailer";

// INTERNAL notes only. This route creates a Comment, which is never emailed
// to the customer — agent notification emails below go to team members only.
// Customer-visible replies are a separate route (POST /api/tickets/{id}/reply,
// Phase C) that creates a Message.
export async function POST(req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { board: true, assignee: true },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }

  const { body, mentionedUserIds } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "Note cannot be empty." }, { status: 400 });

  const comment = await db.comment.create({
    data: { ticketId, authorId: user.id, body: body.trim() },
    include: { author: { select: { id: true, name: true } } },
  });

  // Mentioned users (board members only, never the author) get a mention email.
  const mentionIds = Array.isArray(mentionedUserIds) ? [...new Set(mentionedUserIds as string[])] : [];
  const mentionRecipients: { id: string; email: string }[] = [];
  for (const uid of mentionIds) {
    if (typeof uid !== "string" || uid === user.id) continue;
    if (!(await getBoardMembership(uid, ticket.boardId))) continue;
    const mentioned = await db.user.findUnique({ where: { id: uid } });
    if (mentioned) mentionRecipients.push({ id: mentioned.id, email: mentioned.email });
  }

  // The assignee gets the regular note email — unless they were mentioned
  // (mention email wins) or wrote the note themselves.
  const mentionedSet = new Set(mentionRecipients.map((r) => r.id));
  const plainRecipients = new Map<string, string>();
  if (ticket.assignee && ticket.assignee.id !== user.id && !mentionedSet.has(ticket.assignee.id)) {
    plainRecipients.set(ticket.assignee.id, ticket.assignee.email);
  }

  // Await — Vercel freezes the function after the response, killing unawaited sends.
  await Promise.all([
    ...mentionRecipients.map((r) =>
      sendMentionEmail({
        to: r.email,
        mentionerName: user.name,
        ticketSubject: ticket.subject,
        boardName: ticket.board.name,
        boardId: ticket.boardId,
        ticketId,
        body: comment.body,
      })
    ),
    ...[...plainRecipients.values()].map((email) =>
      sendNoteEmail({
        to: email,
        authorName: user.name,
        ticketSubject: ticket.subject,
        boardName: ticket.board.name,
        boardId: ticket.boardId,
        ticketId,
        body: comment.body,
      })
    ),
  ]);

  return NextResponse.json({ comment });
}
