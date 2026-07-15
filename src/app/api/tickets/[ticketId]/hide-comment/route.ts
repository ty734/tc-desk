import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { hideTicketComment, type HideDb } from "@/lib/hide-comment";

// Hides the ticket's inbound FB/IG comment on the platform (a HUMAN action,
// like /social-reply) instead of replying — for nasty/negative comments that
// don't deserve a public answer. Comment tickets only: DMs and emails have
// no public comment to hide. On success an internal note records who hid it
// and the ticket moves to the board's resolved column.

export async function POST(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      inbox: true,
      board: { include: { columns: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }

  try {
    const result = await hideTicketComment({
      ticket,
      agent: { id: user.id, name: user.name },
      db: db as unknown as HideDb,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    }
    return NextResponse.json({
      ok: true,
      platformLabel: result.platformLabel,
      status: result.ticketStatus,
      columnId: result.columnId,
    });
  } catch (err) {
    console.error("[hide-comment] failed", err);
    return NextResponse.json({ error: "Could not hide the comment." }, { status: 500 });
  }
}
