import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { sendAssignedEmail } from "@/lib/mailer";

const STATUSES = ["new", "open", "pending", "solved", "closed"];

async function authorize(ticketId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Not logged in." }, { status: 401 }) };
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { board: true } });
  if (!ticket) return { error: NextResponse.json({ error: "Ticket not found." }, { status: 404 }) };
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return { error: NextResponse.json({ error: "Not a member of this board." }, { status: 403 }) };
  }
  return { user, ticket };
}

export async function GET(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const auth = await authorize(ticketId);
  if (auth.error) return auth.error;
  const full = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      customer: true,
      fieldValues: true,
      messages: {
        include: { attachments: true, author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return NextResponse.json({ ticket: full });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const auth = await authorize(ticketId);
  if (auth.error) return auth.error;
  const { user, ticket } = auth;

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.subject !== undefined) data.subject = String(body.subject).trim();
  if (body.position !== undefined) data.position = Number(body.position);
  if (body.archived !== undefined) data.archived = Boolean(body.archived);
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null;
  if (body.customerName !== undefined) data.customerName = body.customerName || null;
  if (body.customerEmail !== undefined) data.customerEmail = body.customerEmail || null;
  if (body.channel !== undefined) data.channel = String(body.channel);
  if (body.columnId !== undefined) {
    const column = await db.column.findUnique({ where: { id: body.columnId } });
    if (!column || column.boardId !== ticket.boardId) {
      return NextResponse.json({ error: "Column not found on this board." }, { status: 404 });
    }
    data.columnId = body.columnId;
    // Keep the denormalized status in sync with the status column.
    const normalized = column.name.trim().toLowerCase();
    if (STATUSES.includes(normalized)) data.status = normalized;
  }

  const updated = await db.ticket.update({
    where: { id: ticketId },
    data,
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      fieldValues: true,
    },
  });

  // Custom field values: [{ fieldId, optionId?, textValue? }]
  if (Array.isArray(body.fieldValues)) {
    for (const fv of body.fieldValues) {
      if (!fv?.fieldId) continue;
      const field = await db.customField.findUnique({ where: { id: fv.fieldId } });
      if (!field || field.boardId !== ticket.boardId) continue;
      if (!fv.optionId && !fv.textValue) {
        await db.ticketFieldValue.deleteMany({ where: { ticketId, fieldId: fv.fieldId } });
      } else {
        await db.ticketFieldValue.upsert({
          where: { ticketId_fieldId: { ticketId, fieldId: fv.fieldId } },
          create: { ticketId, fieldId: fv.fieldId, optionId: fv.optionId ?? null, textValue: fv.textValue ?? null },
          update: { optionId: fv.optionId ?? null, textValue: fv.textValue ?? null },
        });
      }
    }
  }

  // Notify on new assignment (not on self-assign).
  if (
    body.assigneeId &&
    body.assigneeId !== ticket.assigneeId &&
    body.assigneeId !== user.id &&
    updated.assignee
  ) {
    // Await — Vercel freezes the function after the response, killing unawaited sends.
    await sendAssignedEmail({
      to: updated.assignee.email,
      assignerName: user.name,
      ticketSubject: updated.subject,
      boardName: ticket.board.name,
      boardId: ticket.boardId,
      ticketId,
    });
  }

  const full = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      fieldValues: true,
      comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  return NextResponse.json({ ticket: full });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const auth = await authorize(ticketId);
  if (auth.error) return auth.error;
  await db.ticket.delete({ where: { id: ticketId } });
  return NextResponse.json({ ok: true });
}
