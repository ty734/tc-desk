"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardData, TicketData, ColumnData, FieldData, Member } from "@/lib/types";
import { Avatar, ChannelBadge, Chip, formatAge } from "@/components/ui";
import TicketModal from "@/components/TicketModal";
import { InviteModal, FieldsModal } from "@/components/BoardModals";

/* ---------------- Ticket tile ---------------- */

function TicketTile({
  ticket,
  fields,
  members,
  onOpen,
  onArchive,
  dragging,
}: {
  ticket: TicketData;
  fields: FieldData[];
  members: Member[];
  onOpen?: (ticket: TicketData) => void;
  onArchive?: (ticket: TicketData) => void;
  dragging?: boolean;
}) {
  const assignee = members.find((m) => m.id === ticket.assigneeId);
  const age = formatAge(ticket.lastMessageAt ?? ticket.createdAt);
  const chips = ticket.fieldValues
    .map((fv) => {
      const field = fields.find((f) => f.id === fv.fieldId);
      const opt = field?.options.find((o) => o.id === fv.optionId);
      return opt ? { id: fv.fieldId, label: opt.label, color: opt.color } : null;
    })
    .filter(Boolean) as { id: string; label: string; color: string }[];

  return (
    <div
      onClick={() => onOpen?.(ticket)}
      className={`group relative bg-white rounded-xl border border-gray-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.08)] hover:shadow-md hover:border-violet-300 transition-all p-3.5 cursor-pointer select-none ${
        dragging ? "shadow-xl rotate-2 border-violet-400" : ""
      }`}
    >
      {onArchive && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive(ticket);
          }}
          title="Archive (remove from board)"
          className="absolute top-2 right-2 z-10 text-gray-300 hover:text-violet-700 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
            <path d="M10 12h4" />
          </svg>
        </button>
      )}
      <div className="flex items-center gap-2 mb-1 pr-5">
        <ChannelBadge channel={ticket.channel} />
        {ticket.number != null && (
          <span className="text-[11px] font-semibold text-gray-400 shrink-0">#{ticket.number}</span>
        )}
        {ticket.customerName || ticket.customerEmail ? (
          <span className="text-xs text-gray-500 truncate">
            {ticket.customerName ?? ticket.customerEmail}
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="text-[11px] text-gray-400 shrink-0">{age}</span>
      </div>
      <span className="text-sm leading-snug text-gray-800">{ticket.subject}</span>
      {(chips.length > 0 || assignee) && (
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {chips.slice(0, 4).map((c) => (
            <Chip key={c.id} label={c.label} color={c.color} />
          ))}
          <span className="flex-1" />
          {assignee && <Avatar name={assignee.name} size={20} />}
        </div>
      )}
    </div>
  );
}

function SortableTicket(props: {
  ticket: TicketData;
  fields: FieldData[];
  members: Member[];
  onOpen: (ticket: TicketData) => void;
  onArchive: (ticket: TicketData) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.ticket.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TicketTile {...props} />
    </div>
  );
}

/* ---------------- Column ---------------- */

function Column({
  column,
  fields,
  members,
  onOpen,
  onArchive,
  onAddTicket,
  onRename,
  onMove,
  onDelete,
}: {
  column: ColumnData;
  fields: FieldData[];
  members: Member[];
  onOpen: (ticket: TicketData) => void;
  onArchive: (ticket: TicketData) => void;
  onAddTicket: (columnId: string, subject: string) => void;
  onRename: (columnId: string, name: string) => void;
  onMove: (columnId: string, dir: -1 | 1) => void;
  onDelete: (columnId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);
  const [adding, setAdding] = useState(false);
  const [newSubject, setNewSubject] = useState("");

  const visible = column.tickets;
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });

  return (
    <div className="w-80 shrink-0 flex flex-col max-h-full">
      <div className="flex items-center justify-between px-1 pb-2">
        {renaming ? (
          <input
            autoFocus
            className="text-sm font-semibold bg-white border border-violet-400 rounded px-1.5 py-0.5 w-full mr-2 focus:outline-none"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (nameDraft.trim() && nameDraft !== column.name) onRename(column.id, nameDraft.trim());
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h3 className="text-sm font-semibold text-gray-700 truncate">
            {column.name}{" "}
            <span className="text-gray-400 font-normal">{visible.length}</span>
          </h3>
        )}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-gray-400 hover:text-gray-700 px-1.5 rounded hover:bg-gray-200"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-7 z-20 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-40 text-sm">
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setNameDraft(column.name);
                    setRenaming(true);
                  }}
                >
                  Rename
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onMove(column.id, -1);
                  }}
                >
                  ← Move left
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50"
                  onClick={() => {
                    setMenuOpen(false);
                    onMove(column.id, 1);
                  }}
                >
                  Move right →
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-600"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(column.id);
                  }}
                >
                  Delete column
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-2xl p-2.5 space-y-2.5 transition-colors ${
          isOver ? "bg-violet-200" : "bg-[#EAF0EC]"
        }`}
      >
        <SortableContext items={visible.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {visible.map((ticket) => (
            <SortableTicket
              key={ticket.id}
              ticket={ticket}
              fields={fields}
              members={members}
              onOpen={onOpen}
              onArchive={onArchive}
            />
          ))}
        </SortableContext>

        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newSubject.trim()) {
                onAddTicket(column.id, newSubject.trim());
                setNewSubject("");
              }
            }}
          >
            <textarea
              autoFocus
              rows={2}
              className="w-full bg-white border border-violet-400 rounded-lg p-2 text-sm resize-none focus:outline-none"
              placeholder="Ticket subject — Enter or click away to add"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).form?.requestSubmit();
                }
                if (e.key === "Escape") {
                  setNewSubject("");
                  setAdding(false);
                }
              }}
              onBlur={() => {
                // Clicking away saves the ticket instead of losing it.
                if (newSubject.trim()) {
                  onAddTicket(column.id, newSubject.trim());
                  setNewSubject("");
                }
                setAdding(false);
              }}
            />
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full text-left text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-lg px-2 py-1.5"
          >
            + Add ticket
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Board ---------------- */

export default function BoardView({
  board: initial,
  currentUserId,
  currentUserName,
  isOwner,
  initialTicketId,
}: {
  board: BoardData;
  currentUserId: string;
  currentUserName: string;
  isOwner: boolean;
  initialTicketId: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [editingName, setEditingName] = useState(false);
  const [columns, setColumns] = useState<ColumnData[]>(initial.columns);
  const [fields, setFields] = useState<FieldData[]>(initial.fields);
  const [members, setMembers] = useState<Member[]>(initial.members);
  const [activeTicket, setActiveTicket] = useState<TicketData | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(initialTicketId);
  const [showInvite, setShowInvite] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | "mine" | "unassigned">("all");
  const [priorityFilter, setPriorityFilter] = useState(false);
  const [search, setSearch] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ---- live refresh: pull other people's changes on tab focus + every 45s ----
  // Skipped while dragging or within 8s of a local edit so it never stomps
  // optimistic state mid-interaction.
  const lastLocalChange = useRef(0);
  const draggingRef = useRef(false);
  const touch = () => {
    lastLocalChange.current = Date.now();
  };

  useEffect(() => {
    let cancelled = false;
    async function refreshFromServer() {
      if (document.hidden || draggingRef.current) return;
      if (Date.now() - lastLocalChange.current < 8000) return;
      try {
        const res = await fetch(`/api/boards/${initial.id}`);
        if (!res.ok || cancelled) return;
        const { board } = await res.json();
        if (!board || cancelled || draggingRef.current) return;
        if (Date.now() - lastLocalChange.current < 8000) return;
        setColumns(
          board.columns.map(
            (c: {
              id: string;
              name: string;
              position: number;
              tickets: (TicketData & { fieldValues: { fieldId: string; optionId: string | null }[] })[];
            }) => ({
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
                lastMessageAt: t.lastMessageAt,
                createdAt: t.createdAt,
                fieldValues: t.fieldValues.map((fv) => ({ fieldId: fv.fieldId, optionId: fv.optionId })),
              })),
            })
          )
        );
        setFields(
          board.fields.map((f: FieldData & { options: { id: string; label: string; color: string }[] }) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            options: f.options.map((o) => ({ id: o.id, label: o.label, color: o.color })),
          }))
        );
        setMembers(
          board.members.map((m: { role: string; user: { id: string; name: string; email: string } }) => ({
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
          }))
        );
      } catch {
        // Offline or transient error — try again on the next tick.
      }
    }
    const onVisible = () => {
      if (!document.hidden) refreshFromServer();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(refreshFromServer, 45000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [initial.id]);

  const openTicket = useMemo(
    () => columns.flatMap((c) => c.tickets).find((t) => t.id === openTicketId) ?? null,
    [columns, openTicketId]
  );

  // Ticket queues: filter every column by assignee. "Assigned to me" and
  // "Unassigned" run over the assigneeId data that already exists; the Closed
  // column already serves as "Recently Closed".
  // Option ids that mean Priority = High. Keyed off the "Priority" custom field
  // by name (case-insensitive) so it works on whichever board defines one, and
  // matches every "High" option regardless of color. Empty set → the High
  // Priority toggle hides everything, which is the honest signal that this board
  // has no High priority option configured.
  const highPriorityOptionIds = useMemo(() => {
    const field = fields.find((f) => f.name.trim().toLowerCase() === "priority");
    return new Set(
      (field?.options ?? [])
        .filter((o) => o.label.trim().toLowerCase() === "high")
        .map((o) => o.id)
    );
  }, [fields]);

  const filteredColumns = useMemo(() => {
    if (assigneeFilter === "all" && !priorityFilter) return columns;
    return columns.map((c) => ({
      ...c,
      tickets: c.tickets.filter((t) => {
        const assigneeOk =
          assigneeFilter === "all"
            ? true
            : assigneeFilter === "mine"
            ? t.assigneeId === currentUserId
            : !t.assigneeId;
        const priorityOk =
          !priorityFilter ||
          t.fieldValues.some((fv) => fv.optionId && highPriorityOptionIds.has(fv.optionId));
        return assigneeOk && priorityOk;
      }),
    }));
  }, [columns, assigneeFilter, priorityFilter, currentUserId, highPriorityOptionIds]);

  // Ticket search: match by number, customer name/email, or subject across
  // every loaded ticket (all columns, open and closed). Read-only — clicking a
  // result just opens that ticket.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const all = columns.flatMap((c) => c.tickets.map((t) => ({ ...t, columnName: c.name })));
    return all
      .filter((t) => {
        const num = String(t.number ?? "");
        return (
          num.includes(q.replace(/^#/, "")) ||
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (t.customerEmail ?? "").toLowerCase().includes(q) ||
          (t.subject ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 12);
  }, [search, columns]);

  /* ---- helpers ---- */

  function patchTicketState(ticketId: string, patch: Partial<TicketData>) {
    touch();
    setColumns((cols) =>
      cols.map((col) => ({
        ...col,
        tickets: col.tickets.map((t) => (t.id === ticketId ? { ...t, ...patch } : t)),
      }))
    );
  }

  async function apiPatchTicket(ticketId: string, body: Record<string, unknown>) {
    touch();
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) router.refresh();
  }

  function findColumnOfTicket(ticketId: string) {
    return columns.find((c) => c.tickets.some((t) => t.id === ticketId));
  }

  /* ---- ticket ops ---- */

  async function addTicket(columnId: string, subject: string) {
    touch();
    const res = await fetch(`/api/boards/${initial.id}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, columnId }),
    });
    if (res.ok) {
      const { ticket } = await res.json();
      setColumns((cols) =>
        cols.map((col) =>
          col.id === columnId
            ? {
                ...col,
                tickets: [
                  ...col.tickets,
                  {
                    id: ticket.id,
                    number: ticket.number,
                    columnId,
                    subject: ticket.subject,
                    position: ticket.position,
                    channel: ticket.channel,
                    status: ticket.status,
                    customerName: ticket.customerName,
                    customerEmail: ticket.customerEmail,
                    assigneeId: null,
                    lastMessageAt: null,
                    createdAt: ticket.createdAt,
                    fieldValues: [],
                  },
                ],
              }
            : col
        )
      );
    } else {
      const { error } = await res.json().catch(() => ({ error: "Could not create the ticket." }));
      alert(error ?? "Could not create the ticket.");
    }
  }

  function deleteTicket(ticketId: string) {
    touch();
    setColumns((cols) => cols.map((c) => ({ ...c, tickets: c.tickets.filter((x) => x.id !== ticketId) })));
    setOpenTicketId(null);
    fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
  }

  // Archive: remove from the board but keep the record (customer thread stays
  // retrievable). Permanent delete lives in the ticket modal.
  function archiveTicket(ticketId: string) {
    touch();
    setColumns((cols) => cols.map((c) => ({ ...c, tickets: c.tickets.filter((x) => x.id !== ticketId) })));
    if (openTicketId === ticketId) setOpenTicketId(null);
    fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
  }

  const STATUSES = ["new", "open", "pending", "solved", "closed"];

  // Move a ticket to another status column from the modal (relocates the tile
  // in state + persists; the API syncs status from the column name).
  function moveTicketToColumn(ticketId: string, columnId: string) {
    touch();
    const target = columns.find((c) => c.id === columnId);
    if (!target) return;
    const normalized = target.name.trim().toLowerCase();
    const status = STATUSES.includes(normalized) ? normalized : undefined;
    setColumns((cols) => {
      let moved: TicketData | undefined;
      const stripped = cols.map((col) => {
        const found = col.tickets.find((t) => t.id === ticketId);
        if (found) moved = { ...found, columnId, ...(status ? { status } : {}) };
        return { ...col, tickets: col.tickets.filter((t) => t.id !== ticketId) };
      });
      if (!moved) return cols;
      return stripped.map((col) =>
        col.id === columnId ? { ...col, tickets: [moved!, ...col.tickets] } : col
      );
    });
    apiPatchTicket(ticketId, { columnId });
  }

  /* ---- column ops ---- */

  async function addColumn() {
    touch();
    const colName = prompt("Column name:");
    if (!colName?.trim()) return;
    const res = await fetch(`/api/boards/${initial.id}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: colName.trim() }),
    });
    if (res.ok) {
      const { column } = await res.json();
      setColumns((cols) => [...cols, { ...column, tickets: [] }]);
    }
  }

  function renameColumn(columnId: string, newName: string) {
    touch();
    setColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, name: newName } : c)));
    fetch(`/api/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
  }

  function moveColumn(columnId: string, dir: -1 | 1) {
    touch();
    const idx = columns.findIndex((c) => c.id === columnId);
    const target = idx + dir;
    if (target < 0 || target >= columns.length) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(target, 0, moved);
    setColumns(reordered);
    // Persist as position between new neighbors.
    const before = reordered[target - 1]?.position;
    const after = reordered[target + 1]?.position;
    const pos =
      before !== undefined && after !== undefined
        ? (before + after) / 2
        : before !== undefined
          ? before + 1
          : after !== undefined
            ? after - 1
            : 1;
    fetch(`/api/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: pos }),
    });
  }

  async function deleteColumn(columnId: string) {
    touch();
    const col = columns.find((c) => c.id === columnId);
    if (!col) return;
    if (col.tickets.length > 0) {
      alert("Move or delete the tickets in this column first.");
      return;
    }
    if (!confirm(`Delete column "${col.name}"?`)) return;
    setColumns((cols) => cols.filter((c) => c.id !== columnId));
    fetch(`/api/columns/${columnId}`, { method: "DELETE" });
  }

  /* ---- drag & drop ---- */

  function handleDragStart(event: DragStartEvent) {
    draggingRef.current = true;
    touch();
    const ticket = columns.flatMap((c) => c.tickets).find((t) => t.id === event.active.id);
    setActiveTicket(ticket ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    touch();
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const sourceCol = findColumnOfTicket(activeId);
    const targetCol = overId.startsWith("col:")
      ? columns.find((c) => `col:${c.id}` === overId)
      : findColumnOfTicket(overId);
    if (!sourceCol || !targetCol || sourceCol.id === targetCol.id) return;

    // Move the ticket into the target column (at the end, or before the hovered ticket).
    setColumns((cols) => {
      const src = cols.find((c) => c.id === sourceCol.id)!;
      const ticket = src.tickets.find((t) => t.id === activeId)!;
      const overIndex = overId.startsWith("col:")
        ? -1
        : cols.find((c) => c.id === targetCol.id)!.tickets.findIndex((t) => t.id === overId);
      return cols.map((col) => {
        if (col.id === sourceCol.id) {
          return { ...col, tickets: col.tickets.filter((t) => t.id !== activeId) };
        }
        if (col.id === targetCol.id) {
          const tickets = [...col.tickets];
          const moved = { ...ticket, columnId: col.id };
          if (overIndex === -1) tickets.push(moved);
          else tickets.splice(overIndex, 0, moved);
          return { ...col, tickets };
        }
        return col;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    draggingRef.current = false;
    touch();
    const { active, over } = event;
    setActiveTicket(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const col = findColumnOfTicket(activeId);
    if (!col) return;

    // Reorder within the column if dropped on another ticket.
    let finalTickets = col.tickets;
    if (!overId.startsWith("col:") && overId !== activeId) {
      const oldIndex = col.tickets.findIndex((t) => t.id === activeId);
      const newIndex = col.tickets.findIndex((t) => t.id === overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        finalTickets = [...col.tickets];
        const [moved] = finalTickets.splice(oldIndex, 1);
        finalTickets.splice(newIndex, 0, moved);
        setColumns((cols) => cols.map((c) => (c.id === col.id ? { ...c, tickets: finalTickets } : c)));
      }
    }

    // Compute a stable position between neighbors and persist.
    const idx = finalTickets.findIndex((t) => t.id === activeId);
    const before = finalTickets[idx - 1]?.position;
    const after = finalTickets[idx + 1]?.position;
    const pos =
      before !== undefined && after !== undefined
        ? (before + after) / 2
        : before !== undefined
          ? before + 1
          : after !== undefined
            ? after - 1
            : 1;
    patchTicketState(activeId, { position: pos, columnId: col.id });
    apiPatchTicket(activeId, { columnId: col.id, position: pos });
  }

  /* ---- render ---- */

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-5 py-3.5 flex items-center gap-4 shrink-0">
        <Link href="/" className="text-gray-400 hover:text-gray-700 font-medium text-sm">
          ← Desk
        </Link>
        {editingName && isOwner ? (
          <input
            autoFocus
            className="text-lg font-bold border border-violet-400 rounded px-2 py-0.5 focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              fetch(`/api/boards/${initial.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h1
            className={`text-xl font-bold rounded-lg px-2 py-0.5 ${isOwner ? "cursor-pointer hover:bg-gray-100" : ""}`}
            title={isOwner ? "Click to rename" : undefined}
            onClick={() => isOwner && setEditingName(true)}
          >
            {name}
          </h1>
        )}
        <div className="flex -space-x-1.5 ml-2">
          {members.map((m) => (
            <Avatar key={m.id} name={m.name} size={26} />
          ))}
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInvite(true)}
            className="text-sm font-medium text-violet-700 hover:bg-violet-50 border border-violet-200 rounded-lg px-3 py-1"
          >
            + Invite
          </button>
        )}
        <div className="flex-1" />
        {/* Ticket search — number, customer name/email, or subject */}
        <div className="relative w-72">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets — #, name, email, subject"
            className="w-full text-sm border border-gray-300 rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm leading-none"
              title="Clear"
            >
              ×
            </button>
          )}
          {search.trim() && (
            <div className="absolute right-0 top-9 z-30 w-96 max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl">
              {searchResults.length === 0 ? (
                <p className="text-sm text-gray-400 px-4 py-3">No tickets match &ldquo;{search}&rdquo;.</p>
              ) : (
                searchResults.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setOpenTicketId(t.id);
                      setSearch("");
                    }}
                    className="w-full text-left border-b border-gray-100 last:border-0 hover:bg-violet-50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-semibold text-gray-700">#{t.number ?? "?"}</span>
                      <span className="uppercase tracking-wide rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                        {t.columnName}
                      </span>
                      <span className="flex-1" />
                      <span className="truncate max-w-[45%]">
                        {t.customerName || t.customerEmail || ""}
                      </span>
                    </div>
                    <div className="text-sm text-gray-800 truncate mt-0.5">{t.subject}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {/* Ticket queues — quick assignee filter over the whole board */}
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(
            [
              ["all", "All"],
              ["mine", "Assigned to me"],
              ["unassigned", "Unassigned"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setAssigneeFilter(val)}
              className={`px-3 py-1 font-medium transition-colors ${
                assigneeFilter === val
                  ? "bg-violet-700 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* High Priority filter — narrows the board to tickets chipped High on
            the Priority field. Stacks with the assignee queue above. */}
        <button
          onClick={() => setPriorityFilter((v) => !v)}
          aria-pressed={priorityFilter}
          className={`rounded-lg border px-3 py-1 text-sm font-medium transition-colors ${
            priorityFilter
              ? "border-red-300 bg-red-600 text-white"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
          title="Show only High Priority tickets"
        >
          High Priority
        </button>
        {isOwner && (
          <button
            onClick={() => setShowFields(true)}
            className="text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg px-3 py-1"
          >
            Fields
          </button>
        )}
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <main className="board-scroll flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 p-4 h-full items-start">
            {filteredColumns.map((col) => (
              <Column
                key={col.id}
                column={col}
                fields={fields}
                members={members}
                onOpen={(ticket) => setOpenTicketId(ticket.id)}
                onArchive={(ticket) => archiveTicket(ticket.id)}
                onAddTicket={addTicket}
                onRename={renameColumn}
                onMove={moveColumn}
                onDelete={deleteColumn}
              />
            ))}
            <button
              onClick={addColumn}
              className="w-64 shrink-0 rounded-xl border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 text-gray-500 hover:text-violet-700 font-medium py-3"
            >
              + Add column
            </button>
          </div>
        </main>
        <DragOverlay>
          {activeTicket && (
            <TicketTile ticket={activeTicket} fields={fields} members={members} dragging />
          )}
        </DragOverlay>
      </DndContext>

      {openTicket && (
        <TicketModal
          ticket={openTicket}
          boardId={initial.id}
          columns={columns.map((c) => ({ id: c.id, name: c.name }))}
          fields={fields}
          members={members}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onClose={() => setOpenTicketId(null)}
          onPatch={(patch) => {
            patchTicketState(openTicket.id, patch);
          }}
          onSave={(body) => apiPatchTicket(openTicket.id, body)}
          onDelete={() => deleteTicket(openTicket.id)}
          onChangeColumn={(columnId) => moveTicketToColumn(openTicket.id, columnId)}
          onMerged={(targetId) => {
            // Source ticket is now archived server-side; drop it from the board
            // and jump the agent to the surviving (target) ticket.
            touch();
            const sourceId = openTicket.id;
            setColumns((cols) =>
              cols.map((c) => ({ ...c, tickets: c.tickets.filter((t) => t.id !== sourceId) }))
            );
            setOpenTicketId(targetId);
          }}
        />
      )}
      {showInvite && (
        <InviteModal
          boardId={initial.id}
          onClose={() => setShowInvite(false)}
          onAdded={(member) => setMembers((m) => [...m, member])}
        />
      )}
      {showFields && (
        <FieldsModal
          boardId={initial.id}
          fields={fields}
          onClose={() => setShowFields(false)}
          onChange={setFields}
        />
      )}
    </div>
  );
}
