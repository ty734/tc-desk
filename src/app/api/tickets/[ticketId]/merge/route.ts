import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";

// Merge duplicate tickets. The OPEN ticket (source) is merged INTO a target
// ticket the agent picks: the source's messages and internal notes move to the
// target, an audit note is left on both, and the source is archived. Read-only
// GET lists likely duplicates (the same customer's other live tickets).

async function authorizeSource(ticketId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { board: true } });
  if (!ticket) return { error: NextResponse.json({ error: "Ticket not found." }, { status: 404 }) };
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return { error: NextResponse.json({ error: "Not a member of this board." }, { status: 403 }) };
  }
  return { user, ticket };
}

// Candidate targets to merge into: same inbox, not this ticket, not archived.
// The same customer's other tickets come first (the usual duplicate case).
export async function GET(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const auth = await authorizeSource(ticketId);
  if (auth.error) return auth.error;
  const { ticket } = auth;

  const candidates = await db.ticket.findMany({
    where: {
      inboxId: ticket.inboxId,
      archived: false,
      id: { not: ticket.id },
      ...(ticket.customerEmail ? { customerEmail: ticket.customerEmail } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: 20,
    select: {
      id: true,
      number: true,
      subject: true,
      customerName: true,
      customerEmail: true,
      status: true,
      lastMessageAt: true,
    },
  });

  return NextResponse.json({ candidates });
}

export async function POST(req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const auth = await authorizeSource(ticketId);
  if (auth.error) return auth.error;
  const { user, ticket: source } = auth;

  const { targetTicketId } = await req.json().catch(() => ({}));
  if (typeof targetTicketId !== "string" || !targetTicketId) {
    return NextResponse.json({ error: "Pick a ticket to merge into." }, { status: 400 });
  }
  if (targetTicketId === source.id) {
    return NextResponse.json({ error: "Can't merge a ticket into itself." }, { status: 400 });
  }

  const target = await db.ticket.findUnique({ where: { id: targetTicketId } });
  if (!target) return NextResponse.json({ error: "Target ticket not found." }, { status: 404 });
  if (target.inboxId !== source.inboxId) {
    return NextResponse.json({ error: "Tickets are in different inboxes." }, { status: 400 });
  }
  if (target.archived) {
    return NextResponse.json({ error: "The target ticket is archived." }, { status: 400 });
  }

  const latestMessageAt =
    [source.lastMessageAt, target.lastMessageAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? target.lastMessageAt;

  await db.$transaction([
    // Move the customer-visible thread and internal notes onto the target.
    db.message.updateMany({ where: { ticketId: source.id }, data: { ticketId: target.id } }),
    db.comment.updateMany({ where: { ticketId: source.id }, data: { ticketId: target.id } }),
    // Audit trail on the surviving ticket.
    db.comment.create({
      data: {
        ticketId: target.id,
        authorId: user.id,
        body: `Merged ticket #${source.number ?? "?"}${source.customerEmail ? ` (${source.customerEmail})` : ""} into this ticket.`,
      },
    }),
    // And on the archived source, so its history explains where it went.
    db.comment.create({
      data: {
        ticketId: source.id,
        authorId: user.id,
        body: `This ticket was merged into #${target.number ?? "?"} and archived.`,
      },
    }),
    db.ticket.update({
      where: { id: target.id },
      data: { lastMessageAt: latestMessageAt },
    }),
    db.ticket.update({
      where: { id: source.id },
      data: { archived: true, status: "closed" },
    }),
  ]);

  return NextResponse.json({ ok: true, targetId: target.id, targetNumber: target.number });
}
