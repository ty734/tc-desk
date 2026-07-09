import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Chip, ChannelBadge, formatAge } from "@/components/ui";

export default async function MyTicketsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const memberships = await db.boardMember.findMany({ where: { userId: user.id } });
  const boardIds = memberships.map((m) => m.boardId);

  const tickets = await db.ticket.findMany({
    where: {
      assigneeId: user.id,
      status: { notIn: ["solved", "closed"] },
      boardId: { in: boardIds },
    },
    include: {
      board: { select: { id: true, name: true, archived: true } },
      column: { select: { name: true } },
      fieldValues: { include: { option: true, field: true } },
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
  });
  const visible = tickets.filter((t) => !t.board.archived);

  // Group by board, keeping the ordering inside each group.
  const groups = new Map<string, { boardName: string; tickets: typeof visible }>();
  for (const ticket of visible) {
    const g = groups.get(ticket.boardId) ?? { boardName: ticket.board.name, tickets: [] };
    g.tickets.push(ticket);
    groups.set(ticket.boardId, g);
  }

  return (
    <div className="flex-1">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-gray-700 font-medium text-sm">
            ← Desk
          </Link>
          <h1 className="text-lg font-bold">My Tickets</h1>
          <span className="text-sm text-gray-500">
            {visible.length} open ticket{visible.length === 1 ? "" : "s"} assigned to you
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {visible.length === 0 && (
          <p className="text-gray-500 text-center py-16">
            Nothing assigned to you right now. Enjoy it while it lasts. 🎉
          </p>
        )}
        {[...groups.entries()].map(([boardId, group]) => (
          <section key={boardId}>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {group.boardName}
            </h2>
            <div className="space-y-2">
              {group.tickets.map((ticket) => {
                const age = formatAge(
                  ticket.lastMessageAt?.toISOString() ?? ticket.createdAt.toISOString()
                );
                return (
                  <Link
                    key={ticket.id}
                    href={`/boards/${boardId}?ticket=${ticket.id}`}
                    className="block bg-white rounded-xl border border-gray-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.08)] hover:shadow-md hover:border-violet-300 transition-all p-4"
                  >
                    <div className="flex items-center gap-3">
                      <ChannelBadge channel={ticket.channel} />
                      {ticket.number != null && (
                        <span className="text-xs font-semibold text-gray-400 shrink-0">#{ticket.number}</span>
                      )}
                      <span className="flex-1 font-medium text-gray-800">{ticket.subject}</span>
                      <span className="text-xs font-semibold shrink-0 text-gray-500">{age}</span>
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                      <span className="text-xs text-gray-400">{ticket.column.name}</span>
                      {ticket.customerName && (
                        <span className="text-xs text-gray-400">· {ticket.customerName}</span>
                      )}
                      {ticket.fieldValues
                        .filter((fv) => fv.option)
                        .slice(0, 4)
                        .map((fv) => (
                          <Chip key={fv.fieldId} label={fv.option!.label} color={fv.option!.color} />
                        ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
