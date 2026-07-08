"use client";

import { useEffect, useRef, useState } from "react";
import type { TicketData, CommentData, MessageData, FieldData, Member } from "@/lib/types";
import { Avatar, ChannelBadge, Chip } from "@/components/ui";
import { optionColor } from "@/lib/colors";

// Matches a partial "@name" (up to two words) ending at the caret.
const MENTION_PARTIAL = /@([^\s@]*(?: [^\s@]*)?)$/;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Renders a note body with @Member Name occurrences highlighted. */
function NoteBody({ body, members }: { body: string; members: Member[] }) {
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length);
  if (names.length === 0) return <p className="text-sm text-gray-700 whitespace-pre-wrap">{body}</p>;
  const re = new RegExp(`@(${names.map(escapeRegExp).join("|")})`, "g");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    parts.push(
      <span key={match.index} className="text-violet-700 bg-violet-100 font-medium rounded px-0.5">
        @{match[1]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <p className="text-sm text-gray-700 whitespace-pre-wrap">{parts}</p>;
}

export default function TicketModal({
  ticket,
  fields,
  members,
  currentUserId,
  currentUserName,
  onClose,
  onPatch,
  onSave,
  onDelete,
}: {
  ticket: TicketData;
  boardId: string;
  fields: FieldData[];
  members: Member[];
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onPatch: (patch: Partial<TicketData>) => void;
  onSave: (body: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [subject, setSubject] = useState(ticket.subject);
  const [customerName, setCustomerName] = useState(ticket.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(ticket.customerEmail ?? "");
  const [notes, setNotes] = useState<CommentData[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const noteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tickets/${ticket.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.ticket) {
          setNotes(
            data.ticket.comments.map(
              (c: { id: string; body: string; createdAt: string; author: { id: string; name: string } }) => c
            )
          );
          setMessages(data.ticket.messages ?? []);
          setNotesLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  function setFieldValue(fieldId: string, optionId: string | null) {
    const next = ticket.fieldValues.filter((fv) => fv.fieldId !== fieldId);
    if (optionId) next.push({ fieldId, optionId });
    onPatch({ fieldValues: next });
    onSave({ fieldValues: [{ fieldId, optionId }] });
  }

  function handleNoteChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setNewNote(value);
    const caret = e.target.selectionStart ?? value.length;
    const match = value.slice(0, caret).match(MENTION_PARTIAL);
    setMentionQuery(match ? match[1] : null);
  }

  function pickMention(member: Member) {
    const input = noteInputRef.current;
    const caret = input?.selectionStart ?? newNote.length;
    const before = newNote.slice(0, caret).replace(MENTION_PARTIAL, `@${member.name} `);
    setNewNote(before + newNote.slice(caret));
    setMentionedIds((ids) => [...new Set([...ids, member.id])]);
    setMentionQuery(null);
    input?.focus();
  }

  const mentionMatches =
    mentionQuery === null
      ? []
      : members.filter(
          (m) =>
            m.id !== currentUserId &&
            m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())
        );

  async function postNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;
    const body = newNote.trim();
    // Only count mentions whose @Name is still present (user may have deleted it).
    const mentionedUserIds = mentionedIds.filter((id) => {
      const member = members.find((m) => m.id === id);
      return member && body.includes(`@${member.name}`);
    });
    setNewNote("");
    setMentionedIds([]);
    setMentionQuery(null);
    // Optimistic append.
    const temp: CommentData = {
      id: `temp-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      author: { id: currentUserId, name: currentUserName },
    };
    setNotes((c) => [...c, temp]);
    const res = await fetch(`/api/tickets/${ticket.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, mentionedUserIds }),
    });
    if (res.ok) {
      const { comment } = await res.json();
      setNotes((c) => c.map((x) => (x.id === temp.id ? comment : x)));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-10 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5">
          <ChannelBadge channel={ticket.channel} />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {ticket.status}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => {
              if (confirm("Delete this ticket?")) onDelete();
            }}
            className="text-gray-400 hover:text-red-600 text-sm px-2"
            title="Delete ticket"
          >
            Delete
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl px-2">
            ×
          </button>
        </div>

        {/* Subject */}
        <div className="px-6 pt-3">
          <textarea
            className="w-full text-2xl font-bold resize-none focus:outline-none focus:bg-gray-50 rounded-lg p-1 -m-1"
            rows={subject.length > 60 ? 2 : 1}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => {
              if (subject.trim() && subject !== ticket.subject) {
                onPatch({ subject: subject.trim() });
                onSave({ subject: subject.trim() });
              }
            }}
          />
        </div>

        {/* Properties */}
        <div className="px-6 py-4 grid grid-cols-[120px_1fr] gap-y-3 gap-x-4 text-sm items-center">
          <span className="text-gray-500">Customer</span>
          <div className="flex items-center gap-2">
            <input
              className="border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 w-40"
              placeholder="Name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              onBlur={() => {
                if (customerName !== (ticket.customerName ?? "")) {
                  onPatch({ customerName: customerName || null });
                  onSave({ customerName: customerName || null });
                }
              }}
            />
            <input
              className="border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 flex-1"
              placeholder="email@example.com"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              onBlur={() => {
                if (customerEmail !== (ticket.customerEmail ?? "")) {
                  onPatch({ customerEmail: customerEmail || null });
                  onSave({ customerEmail: customerEmail || null });
                }
              }}
            />
          </div>

          <span className="text-gray-500">Assignee</span>
          <div className="flex items-center gap-2">
            <select
              className="border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              value={ticket.assigneeId ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                onPatch({ assigneeId: v });
                onSave({ assigneeId: v });
              }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {ticket.assigneeId && (
              <Avatar name={members.find((m) => m.id === ticket.assigneeId)?.name ?? "?"} size={26} />
            )}
          </div>

          {fields.map((field) => {
            const fv = ticket.fieldValues.find((x) => x.fieldId === field.id);
            const selected = field.options.find((o) => o.id === fv?.optionId);
            return (
              <FieldRow
                key={field.id}
                name={field.name}
                options={field.options}
                selectedId={selected?.id ?? null}
                onSelect={(optionId) => setFieldValue(field.id, optionId)}
              />
            );
          })}
        </div>

        {/* Customer conversation — the email thread. Reply composer arrives in
            Phase C as a clearly separate, non-amber input. */}
        <div className="px-6 pb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-2">Conversation</h4>
          {messages.length === 0 ? (
            <div className="border border-gray-200 rounded-lg p-3 text-sm text-gray-400 bg-gray-50">
              No email on this ticket yet.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-3 ${
                    m.direction === "inbound"
                      ? "bg-white border-gray-200 border-l-4 border-l-sky-400"
                      : "bg-violet-50 border-violet-200 border-l-4 border-l-violet-500"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5">
                    <span
                      className={`font-semibold uppercase tracking-wide text-[10px] rounded px-1.5 py-0.5 ${
                        m.direction === "inbound"
                          ? "bg-sky-100 text-sky-800"
                          : "bg-violet-100 text-violet-800"
                      }`}
                    >
                      {m.direction === "inbound" ? "Customer" : "Reply"}
                    </span>
                    <span className="font-medium text-gray-700">
                      {m.direction === "inbound" ? m.fromAddr : m.author?.name ?? m.fromAddr}
                    </span>
                    <span className="flex-1" />
                    <span>
                      {new Date(m.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">
                    {m.bodyText || "(no text body)"}
                  </p>
                  {m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {m.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={a.blobUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1 hover:bg-violet-100"
                        >
                          📎 {a.filename}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* INTERNAL NOTES — amber styling makes it unmistakable these never
            reach the customer. The customer reply composer (Phase C) is a
            separate, differently-colored input. */}
        <div className="border-t-2 border-amber-300 bg-amber-50 rounded-b-2xl px-6 py-4">
          <h4 className="text-sm font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
            🔒 Internal notes
          </h4>
          <p className="text-xs text-amber-700/80 mb-3">
            Only your team sees these. Never sent to the customer.
          </p>
          {!notesLoaded ? (
            <p className="text-sm text-gray-400 mb-3">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-gray-400 mb-3">No internal notes yet.</p>
          ) : (
            <div className="space-y-3 mb-4">
              {notes.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar name={c.author.name} size={28} />
                  <div className="flex-1">
                    <div className="text-sm">
                      <span className="font-semibold">{c.author.name}</span>{" "}
                      <span className="text-gray-400 text-xs">
                        {new Date(c.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <NoteBody body={c.body} members={members} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={postNote} className="flex gap-2.5 relative">
            <Avatar name={currentUserName} size={28} />
            <div className="flex-1 relative">
              {mentionMatches.length > 0 && (
                <div className="absolute bottom-full mb-1 left-0 z-30 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-64 max-h-48 overflow-y-auto">
                  {mentionMatches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="w-full text-left px-3 py-1.5 hover:bg-violet-50 flex items-center gap-2"
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep input focus
                        pickMention(m);
                      }}
                    >
                      <Avatar name={m.name} size={22} />
                      <span className="text-sm">{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={noteInputRef}
                className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="Internal note (team-only)… @ to mention"
                value={newNote}
                onChange={handleNoteChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && mentionMatches.length > 0) {
                    e.preventDefault();
                    pickMention(mentionMatches[0]);
                  }
                  if (e.key === "Escape") setMentionQuery(null);
                }}
                onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
              />
            </div>
            <button
              disabled={!newNote.trim()}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-4"
            >
              Add note
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  name,
  options,
  selectedId,
  onSelect,
}: {
  name: string;
  options: { id: string; label: string; color: string }[];
  selectedId: string | null;
  onSelect: (optionId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === selectedId);
  return (
    <>
      <span className="text-gray-500">{name}</span>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 bg-white hover:border-gray-300 min-w-[140px] text-left"
        >
          {selected ? <Chip label={selected.label} color={selected.color} /> : <span className="text-gray-400">—</span>}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-56 max-h-64 overflow-y-auto">
              <button
                className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                Clear
              </button>
              {options.map((o) => {
                const c = optionColor(o.color);
                return (
                  <button
                    key={o.id}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2"
                    onClick={() => {
                      onSelect(o.id);
                      setOpen(false);
                    }}
                  >
                    <span className="w-3 h-3 rounded-full" style={{ background: c.bg, border: `1px solid ${c.text}22` }} />
                    <span className="text-sm">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
