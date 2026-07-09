import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import BoardView from "@/components/BoardView";
import type { BoardData } from "@/lib/types";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ ticket?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { boardId } = await params;
  const { ticket: initialTicketId } = await searchParams;

  const membership = await getBoardMembership(user.id, boardId);
  if (!membership) notFound();

  const board = await db.board.findUnique({
    where: { id: boardId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      fields: {
        orderBy: { position: "asc" },
        include: { options: { orderBy: { position: "asc" } } },
      },
      columns: {
        orderBy: { position: "asc" },
        include: {
          tickets: {
            orderBy: { position: "asc" },
            include: { fieldValues: { select: { fieldId: true, optionId: true } } },
          },
        },
      },
    },
  });
  if (!board) notFound();

  const data: BoardData = {
    id: board.id,
    name: board.name,
    members: board.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
    fields: board.fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options.map((o) => ({ id: o.id, label: o.label, color: o.color })),
    })),
    columns: board.columns.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      tickets: c.tickets.map((t) => ({
        id: t.id,
        number: t.number,
        columnId: t.columnId,
        subject: t.subject,
        position: t.position,
        channel: t.channel,
        status: t.status,
        customerName: t.customerName,
        customerEmail: t.customerEmail,
        assigneeId: t.assigneeId,
        lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
        fieldValues: t.fieldValues,
      })),
    })),
  };

  return (
    <BoardView
      board={data}
      currentUserId={user.id}
      currentUserName={user.name}
      isOwner={membership.role === "owner"}
      initialTicketId={initialTicketId ?? null}
    />
  );
}
