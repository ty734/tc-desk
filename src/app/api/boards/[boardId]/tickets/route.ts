import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { nextTicketNumber } from "@/lib/tickets";

const STATUSES = ["new", "open", "pending", "solved", "closed"];

// Manually create a ticket on an inbox board (e.g. logging a phone call).
// Inbound email (Phase B) creates tickets through the webhook instead.
export async function POST(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });
  if (!(await getBoardMembership(user.id, boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }

  const { subject, columnId, channel, customerEmail, customerName } = await req.json();
  if (!subject?.trim() || !columnId) {
    return NextResponse.json({ error: "Subject and column are required." }, { status: 400 });
  }
  const column = await db.column.findUnique({ where: { id: columnId } });
  if (!column || column.boardId !== boardId) {
    return NextResponse.json({ error: "Column not found on this board." }, { status: 404 });
  }
  // Every ticket belongs to an inbox (brand). Boards without an inbox are not
  // ticket boards.
  const inbox = await db.inbox.findUnique({ where: { boardId } });
  if (!inbox) {
    return NextResponse.json(
      { error: "This board has no inbox — tickets can only be created on an inbox board." },
      { status: 400 }
    );
  }

  const normalized = column.name.trim().toLowerCase();
  const last = await db.ticket.findFirst({ where: { columnId }, orderBy: { position: "desc" } });
  const number = await nextTicketNumber(inbox.id);
  const ticket = await db.ticket.create({
    data: {
      number,
      inboxId: inbox.id,
      boardId,
      columnId,
      subject: subject.trim(),
      position: (last?.position ?? 0) + 1,
      channel: typeof channel === "string" && channel ? channel : "email",
      status: STATUSES.includes(normalized) ? normalized : "new",
      customerEmail: customerEmail || null,
      customerName: customerName || null,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      fieldValues: true,
      comments: true,
    },
  });
  return NextResponse.json({ ticket });
}
