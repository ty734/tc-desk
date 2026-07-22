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

/** Renders untrusted customer email HTML inside a sandboxed iframe: no scripts
 *  can run (no allow-scripts), links open in a new tab, and the email's own CSS
 *  can't leak into the app. Height auto-fits the content. */
function EmailHtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>
  html,body{margin:0;padding:0;}
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;} table{max-width:100%;} *{max-width:100%;box-sizing:border-box;}
  a{color:#6d4a9c;}
  blockquote{margin:0.5em 0;padding-left:0.8em;border-left:3px solid #e5e7eb;color:#6b7280;}
</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref}
      title="Email content"
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      className="w-full border-0 block"
      style={{ height }}
      onLoad={() => {
        try {
          const doc = ref.current?.contentDocument;
          if (doc?.body) setHeight(Math.min(doc.body.scrollHeight + 4, 1400));
        } catch {
          /* cross-origin guard — leave default height */
        }
      }}
    />
  );
}

/** A single email message body. Fixes the blank-message bug (HTML-only emails)
 *  and adds a quoted-history / original-email toggle on inbound messages. */
function MessageBody({ m }: { m: MessageData }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const hasText = !!m.bodyText && m.bodyText.trim().length > 0;
  const hasHtml = !!m.bodyHtml && m.bodyHtml.trim().length > 0;

  // Blank-message fix: no plain-text body but HTML exists → render the HTML.
  if (!hasText && hasHtml) {
    return <EmailHtmlFrame html={m.bodyHtml!} />;
  }

  return (
    <>
      <p className="text-sm text-gray-800 whitespace-pre-wrap">
        {m.bodyText || "(no content)"}
      </p>
      {hasHtml && m.direction === "inbound" && (
        <div className="mt-2">
          <button
            onClick={() => setShowOriginal((v) => !v)}
            className="text-xs font-medium text-gray-400 hover:text-gray-600"
          >
            {showOriginal ? "Hide original email" : "Show original email / quoted history"}
          </button>
          {showOriginal && (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <EmailHtmlFrame html={m.bodyHtml!} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function TicketModal({
  ticket,
  columns,
  fields,
  members,
  currentUserId,
  currentUserName,
  canTrain = false,
  onClose,
  onPatch,
  onSave,
  onDelete,
  onChangeColumn,
  onMerged,
}: {
  ticket: TicketData;
  boardId: string;
  columns: { id: string; name: string }[];
  fields: FieldData[];
  members: Member[];
  currentUserId: string;
  currentUserName: string;
  canTrain?: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<TicketData>) => void;
  onSave: (body: Record<string, unknown>) => void;
  onDelete: () => void;
  onChangeColumn: (columnId: string) => void;
  onMerged: (targetId: string) => void;
}) {
  const [subject, setSubject] = useState(ticket.subject);
  const [customerName, setCustomerName] = useState(ticket.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(ticket.customerEmail ?? "");
  const [notes, setNotes] = useState<CommentData[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [reply, setReply] = useState("");
  const draftKey = `lw-desk-draft-${ticket.id}`;
  const [sending, setSending] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<
    | {
        id: string;
        number: number | null;
        subject: string;
        customerName: string | null;
        customerEmail: string | null;
        status: string;
        lastMessageAt: string | null;
      }[]
    | null
  >(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [hiding, setHiding] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);
  // Parent post/video a social comment is replying to (resolved via Graph).
  // Tagged with ticketId so a stale result never renders under a different
  // ticket when the modal is reused — avoids a synchronous reset in the effect.
  const [postContext, setPostContext] = useState<{
    ticketId: string;
    permalink: string | null;
    caption: string | null;
    thumbnailUrl: string | null;
    mediaType: string | null;
  } | null>(null);
  const [canned, setCanned] = useState<{ id: string; title: string; body: string }[] | null>(null);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [shopify, setShopify] = useState<{
    configured: boolean;
    noEmail?: boolean;
    error?: string;
    storeHandle?: string;
    subscriptions?: {
      productTitle: string;
      variantTitle: string | null;
      status: string;
      quantity: number;
      price: string | null;
      nextChargeDate: string | null;
      frequency: string;
    }[];
    orders: {
      name: string;
      legacyResourceId: string;
      createdAt: string;
      fulfillmentStatus: string;
      financialStatus: string;
      total: string;
      currency: string;
      lineItems: { title: string; quantity: number }[];
      tracking: { company: string | null; number: string | null; url: string | null }[];
      statusPageUrl: string | null;
    }[];
  } | null>(null);
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
          const msgs: MessageData[] = data.ticket.messages ?? [];
          setMessages(msgs);
          setNotesLoaded(true);
          // Social tickets: pre-fill the composer with the AI draft — but
          // never clobber a restored localStorage draft or typed text.
          if (
            ["facebook_comment", "facebook_dm", "instagram_comment", "instagram_dm"].includes(
              ticket.channel
            )
          ) {
            const draft = [...msgs].reverse().find((m) => m.direction === "inbound" && m.aiDraft)?.aiDraft;
            if (draft) setReply((prev) => (prev.trim() ? prev : draft));
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id, ticket.channel]);

  // Social comments: resolve the parent post/video so the agent can see (and
  // open) what the customer is replying to. Comment channels only — DMs and
  // email have no parent post. Failures resolve to null and render nothing.
  useEffect(() => {
    if (!["facebook_comment", "instagram_comment"].includes(ticket.channel)) return;
    let cancelled = false;
    fetch(`/api/tickets/${ticket.id}/social-post`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.context) setPostContext({ ticketId: ticket.id, ...data.context });
      })
      .catch(() => {
        /* leave null — the card simply doesn't render */
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id, ticket.channel]);

  // Draft auto-save: restore any saved draft for this ticket on open, then
  // persist as the agent types so work is never lost on navigation/refresh.
  // Only writes non-empty drafts; it's cleared explicitly on a successful send.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setReply(saved);
    } catch {
      /* localStorage unavailable — skip */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!reply.trim()) return;
    try {
      localStorage.setItem(draftKey, reply);
    } catch {
      /* localStorage unavailable — skip */
    }
  }, [reply, draftKey]);

  // Shopify order lookup — re-runs if the customer email is edited.
  useEffect(() => {
    let cancelled = false;
    setShopify(null);
    fetch(`/api/tickets/${ticket.id}/shopify`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setShopify(data);
      })
      .catch(() => {
        if (!cancelled) setShopify({ configured: true, error: "Shopify lookup failed.", orders: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id, ticket.customerEmail]);

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

  const isAmazon = ticket.channel === "amazon";
  // Social (Meta) channels: replies go back through the Graph API, not email.
  const isSocial = ["facebook_comment", "facebook_dm", "instagram_comment", "instagram_dm"].includes(
    ticket.channel
  );
  const isSocialDm = isSocial && ticket.channel.endsWith("_dm");
  const isSocialComment = isSocial && ticket.channel.endsWith("_comment");
  const platformLabel = ticket.channel.startsWith("facebook") ? "Facebook" : "Instagram";

  // Latest inbound platform message: the reply target, the AI draft carrier,
  // and (for DMs) the 24h-window anchor. Each new inbound resets the window.
  // The clock is snapshotted once per modal open (render purity).
  const [openedAt] = useState(() => Date.now());
  const lastInboundSocial = [...messages]
    .reverse()
    .find((m) => m.direction === "inbound" && m.platformMessageId);
  const dmWindowExpired =
    isSocialDm && lastInboundSocial?.windowExpiresAt
      ? openedAt > new Date(lastInboundSocial.windowExpiresAt).getTime()
      : false;
  // Past 7 days even HUMAN_AGENT can't reply — Meta offers no compliant path.
  const dmHumanAgentExpired =
    isSocialDm && lastInboundSocial
      ? openedAt > new Date(lastInboundSocial.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000
      : false;

  const canReply =
    isSocial ? !!lastInboundSocial && !dmHumanAgentExpired : isAmazon || !!(customerEmail || ticket.customerEmail);

  async function openCanned() {
    setCannedOpen((v) => !v);
    if (canned === null) {
      const res = await fetch("/api/canned-replies");
      if (res.ok) setCanned((await res.json()).cannedReplies);
      else setCanned([]);
    }
  }

  function insertCanned(body: string) {
    const firstName = (customerName || ticket.customerName || "").split(/\s+/)[0] || "there";
    const merged = body.replace(/\{\{\s*first_name\s*\}\}/g, firstName);
    setReply((r) => (r ? `${r}\n${merged}` : merged));
    setCannedOpen(false);
  }

  async function openMerge() {
    setMergeOpen(true);
    setMergeError(null);
    if (mergeCandidates === null) {
      const res = await fetch(`/api/tickets/${ticket.id}/merge`);
      const data = await res.json().catch(() => ({}));
      setMergeCandidates(res.ok ? data.candidates ?? [] : []);
    }
  }

  async function doMerge(targetId: string) {
    if (merging) return;
    setMerging(true);
    setMergeError(null);
    const res = await fetch(`/api/tickets/${ticket.id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetTicketId: targetId }),
    });
    const data = await res.json().catch(() => ({}));
    setMerging(false);
    if (res.ok) {
      onMerged(data.targetId ?? targetId);
    } else {
      setMergeError(data.error ?? "Could not merge the tickets.");
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    setReplyError(null);
    // Social tickets send through the Meta connector; everything else emails.
    const endpoint = isSocial ? `/api/tickets/${ticket.id}/social-reply` : `/api/tickets/${ticket.id}/reply`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyText: reply.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);
    if (res.ok) {
      setReply("");
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* localStorage unavailable — skip */
      }
      setMessages((m) => [...m, data.message]);
      if (data.status) onPatch({ status: data.status });
    } else {
      setReplyError(data.error ?? "Could not send the reply.");
    }
  }

  // Hide the inbound comment on the platform (comment tickets only) instead
  // of replying — the moderation path for nasty/negative comments. The route
  // records an internal note and moves the ticket to resolved.
  async function hideComment() {
    if (hiding || hidden) return;
    if (
      !confirm(
        `Hide this comment on ${platformLabel}? It stays visible to the person who wrote it but no one else. You can unhide it from the platform.`
      )
    )
      return;
    setHiding(true);
    setHideError(null);
    const res = await fetch(`/api/tickets/${ticket.id}/hide-comment`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setHiding(false);
    if (res.ok) {
      setHidden(true);
      if (data.status) {
        onPatch({ status: data.status, ...(data.columnId ? { columnId: data.columnId } : {}) });
      }
    } else {
      setHideError(data.error ?? "Could not hide the comment.");
    }
  }

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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_320px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-6 pt-5">
          <ChannelBadge channel={ticket.channel} />
          {ticket.number != null && (
            <span className="text-sm font-semibold text-gray-400">#{ticket.number}</span>
          )}
          {columns.length > 0 && (
            <select
              value={ticket.columnId}
              onChange={(e) => onChangeColumn(e.target.value)}
              className="text-xs font-semibold uppercase tracking-wide text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer"
              title="Change status"
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          {ticket.customerPhone && (
            <button
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("tc-desk:call", {
                    detail: {
                      to: ticket.customerPhone,
                      ticketId: ticket.id,
                      label: ticket.customerName ?? ticket.customerPhone,
                    },
                  }),
                )
              }
              className="text-emerald-700 hover:text-emerald-800 text-sm font-medium px-2"
              title={`Call ${ticket.customerPhone}`}
            >
              📞 Call
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => (mergeOpen ? setMergeOpen(false) : openMerge())}
              className="text-gray-400 hover:text-violet-700 text-sm px-2"
              title="Merge this ticket into another"
            >
              Merge
            </button>
            {mergeOpen && (
              <div className="absolute right-0 top-8 z-20 w-80 bg-white border border-gray-200 rounded-xl shadow-xl p-3">
                <p className="text-xs text-gray-500 mb-2">
                  Merge this ticket into another. Its messages and notes move over and this ticket is
                  archived.
                </p>
                {mergeCandidates === null ? (
                  <p className="text-sm text-gray-400 py-3 text-center">Loading…</p>
                ) : mergeCandidates.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3 text-center">
                    No other tickets from this customer.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {mergeCandidates.map((c) => (
                      <button
                        key={c.id}
                        disabled={merging}
                        onClick={() => {
                          if (
                            confirm(
                              `Merge this ticket into #${c.number ?? "?"}? This ticket will be archived.`
                            )
                          )
                            doMerge(c.id);
                        }}
                        className="w-full text-left rounded-lg border border-gray-100 hover:border-violet-300 hover:bg-violet-50 p-2 disabled:opacity-50"
                      >
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-semibold text-gray-700">#{c.number ?? "?"}</span>
                          <span className="uppercase tracking-wide">{c.status}</span>
                        </div>
                        <div className="text-sm text-gray-800 truncate">{c.subject}</div>
                      </button>
                    ))}
                  </div>
                )}
                {mergeError && <p className="text-xs text-red-600 mt-2">{mergeError}</p>}
              </div>
            )}
          </div>
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

        {/* Parent post/video context — what the customer commented on. Social
            comment tickets only; renders once the Graph lookup resolves. */}
        {isSocialComment && postContext?.ticketId === ticket.id && (
          <div className="px-6 pb-4">
            <h4 className="text-sm font-semibold text-gray-600 mb-2">In reply to</h4>
            <div className="flex gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {postContext.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={postContext.thumbnailUrl}
                  alt=""
                  className="h-16 w-16 flex-shrink-0 rounded-md object-cover border border-gray-200"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {platformLabel}
                  {postContext.mediaType ? ` · ${postContext.mediaType.toLowerCase()}` : " post"}
                </div>
                {postContext.caption ? (
                  <p className="mt-0.5 text-sm text-gray-700 line-clamp-2">{postContext.caption}</p>
                ) : (
                  <p className="mt-0.5 text-sm italic text-gray-400">No caption</p>
                )}
                {postContext.permalink && (
                  <a
                    href={postContext.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-sm font-medium text-violet-700 hover:text-violet-900 hover:underline"
                  >
                    View original on {platformLabel} ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

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
                      {m.direction === "inbound"
                        ? isSocial
                          ? ticket.customerName ?? m.fromAddr
                          : m.fromAddr
                        : m.author?.name ?? (isSocial ? "Auto-sent (AI)" : m.fromAddr)}
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
                  <MessageBody m={m} />
                  {m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {m.attachments.map((a) =>
                        a.contentType.startsWith("audio/") ? (
                          <audio
                            key={a.id}
                            controls
                            preload="none"
                            src={a.blobUrl}
                            className="w-full mt-1"
                          />
                        ) : (
                          <a
                            key={a.id}
                            href={a.blobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded px-2 py-1 hover:bg-violet-100"
                          >
                            📎 {a.filename}
                          </a>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* REPLY TO CUSTOMER — sends a real email. Deliberately styled violet
            (vs the amber team-only notes below) so the two can never be
            confused. */}
        <div className="px-6 pb-5">
          <div className="border-2 border-violet-300 rounded-xl bg-violet-50/40 p-4">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-violet-800">
                {isSocialComment
                  ? `💬 Reply publicly on ${platformLabel}`
                  : isSocialDm
                    ? `📩 Reply by ${platformLabel} DM`
                    : "✉️ Reply to customer"}
              </h4>
              <span className="flex-1" />
              <div className="relative">
                <button
                  type="button"
                  onClick={openCanned}
                  className="text-xs font-medium text-violet-700 border border-violet-200 rounded-lg px-2 py-1 hover:bg-violet-100"
                >
                  Canned replies ▾
                </button>
                {cannedOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setCannedOpen(false)} />
                    <div className="absolute right-0 z-20 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-64 max-h-56 overflow-y-auto">
                      {canned === null ? (
                        <p className="text-xs text-gray-400 px-3 py-2">Loading…</p>
                      ) : canned.length === 0 ? (
                        <p className="text-xs text-gray-400 px-3 py-2">
                          No canned replies yet. Create them via POST /api/canned-replies.
                        </p>
                      ) : (
                        canned.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50"
                            onClick={() => insertCanned(c.body)}
                          >
                            {c.title}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-violet-700/70 mb-2">
              {isSocialComment
                ? `Posts a PUBLIC reply under ${customerName || ticket.customerName || "the customer"}'s ${platformLabel} comment — anyone can read it.`
                : isSocialDm
                  ? `Sends a private ${platformLabel} direct message to ${customerName || ticket.customerName || "the customer"}.`
                  : isAmazon
                    ? "Sends through Amazon's buyer messaging relay (Amazon strips attachments)."
                    : canReply
                      ? `Sends a real email to ${customerEmail || ticket.customerEmail} from your support address.`
                      : "Add a customer email above to enable replies."}
            </p>
            {isSocial && lastInboundSocial?.aiDraft && (
              <div
                className={`text-xs rounded-lg border px-3 py-2 mb-2 ${
                  lastInboundSocial.aiFlagReason
                    ? "bg-amber-50 border-amber-300 text-amber-800"
                    : "bg-violet-100/60 border-violet-200 text-violet-800"
                }`}
              >
                <span className="font-semibold">🤖 AI draft pre-filled</span>
                {typeof lastInboundSocial.aiConfidence === "number" && (
                  <span> · confidence {Math.round(lastInboundSocial.aiConfidence * 100)}%</span>
                )}
                {lastInboundSocial.aiIntent && <span> · {lastInboundSocial.aiIntent.replace(/_/g, " ")}</span>}
                <span> — review and edit before sending.</span>
                {lastInboundSocial.aiFlagReason && (
                  <div className="font-semibold mt-0.5">⚠️ Flagged: {lastInboundSocial.aiFlagReason}</div>
                )}
                {canTrain && (
                  <button
                    type="button"
                    onClick={() => {
                      const comment = (lastInboundSocial.bodyText ?? "").trim();
                      const draft = (lastInboundSocial.aiDraft ?? "").trim();
                      const seed =
                        `This AI draft was wrong and I want to correct what the bot knows.\n\n` +
                        `Customer ${isSocialComment ? "comment" : "message"}: "${comment}"\n` +
                        `AI draft: "${draft}"\n\n` +
                        `The correct information is: `;
                      window.dispatchEvent(new CustomEvent("kb-trainer:open", { detail: { seed } }));
                    }}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold px-2.5 py-1 text-[11px]"
                    title="Correct the knowledge base this reply was drafted from"
                  >
                    🎓 Train this
                  </button>
                )}
              </div>
            )}
            {isSocialDm && dmHumanAgentExpired && (
              <div className="text-xs rounded-lg border border-red-300 bg-red-50 text-red-700 px-3 py-2 mb-2">
                This conversation is more than 7 days old — Meta does not allow any reply (even with the
                HUMAN_AGENT tag). Ask the customer to message again, or reach them by email.
              </div>
            )}
            {isSocialDm && dmWindowExpired && !dmHumanAgentExpired && (
              <div className="text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 mb-2">
                ⏱ Past the 24h messaging window — human replies only. Your send will carry Meta&apos;s
                HUMAN_AGENT tag (allowed up to 7 days after their last message).
              </div>
            )}
            <form onSubmit={sendReply}>
              <textarea
                rows={4}
                className="w-full border border-violet-300 rounded-lg p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                placeholder={
                  canReply
                    ? isSocial
                      ? "Write (or edit the AI draft of) your reply…"
                      : "Write your reply to the customer…"
                    : isSocial
                      ? "No reply is possible on this ticket."
                      : "No customer email on this ticket."
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                disabled={!canReply || sending}
              />
              {replyError && <p className="text-sm text-red-600 mt-1">{replyError}</p>}
              {hideError && <p className="text-sm text-red-600 mt-1">{hideError}</p>}
              <div className="flex items-center gap-3 mt-2">
                <button
                  disabled={!canReply || !reply.trim() || sending}
                  className="bg-violet-700 hover:bg-violet-800 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-5 py-2"
                >
                  {sending
                    ? "Sending…"
                    : isSocialComment
                      ? "Post public reply"
                      : isSocialDm
                        ? "Send DM"
                        : "Send reply"}
                </button>
                {isSocialComment && (
                  <button
                    type="button"
                    onClick={hideComment}
                    disabled={!lastInboundSocial || hiding || hidden}
                    title={`Hide this comment on ${platformLabel} instead of replying`}
                    className="text-violet-700 bg-white border border-violet-300 hover:bg-violet-100 disabled:opacity-40 text-sm font-semibold rounded-lg px-4 py-2"
                  >
                    {hiding ? "Hiding…" : hidden ? "Comment hidden ✓" : "Hide comment"}
                  </button>
                )}
                <span className="text-xs text-gray-400">
                  {isSocialComment
                    ? "Replying moves the ticket to Pending; hiding resolves it."
                    : "Sending moves the ticket to Pending."}
                </span>
              </div>
            </form>
          </div>
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

        {/* Shopify order sidebar (spec §8, read-only) */}
        <aside className="border-t lg:border-t-0 lg:border-l border-violet-100 bg-violet-50/50 px-5 py-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-900/70 mb-3">
            Shopify orders
          </h4>
          {shopify === null ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !shopify.configured ? (
            <p className="text-sm text-gray-400">Shopify isn&apos;t connected for this inbox yet.</p>
          ) : shopify.noEmail ? (
            <p className="text-sm text-gray-400">Add a customer email to look up their orders.</p>
          ) : shopify.error ? (
            <p className="text-sm text-red-600">{shopify.error}</p>
          ) : shopify.orders.length === 0 ? (
            <p className="text-sm text-gray-400">No orders found for this customer.</p>
          ) : (
            <div className="space-y-3">
              {shopify.orders.map((o) => (
                <div key={o.name} className="bg-white rounded-xl border border-violet-100 shadow-[0_1px_2px_rgba(15,23,42,0.05)] p-3">
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://admin.shopify.com/store/${shopify.storeHandle}/orders/${o.legacyResourceId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-sm text-violet-800 hover:underline"
                      title="Open in Shopify admin"
                    >
                      {o.name}
                    </a>
                    <span className="flex-1" />
                    <span className="text-xs text-gray-400">
                      {new Date(o.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                    <OrderStatusChip label={o.fulfillmentStatus} />
                    <OrderStatusChip label={o.financialStatus} />
                    <span className="text-xs font-semibold text-gray-700 ml-auto">
                      ${Number(o.total).toFixed(2)} {o.currency !== "USD" ? o.currency : ""}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {o.lineItems.map((li, i) => (
                      <li key={i} className="text-xs text-gray-600 truncate">
                        {li.quantity}× {li.title}
                      </li>
                    ))}
                  </ul>
                  {o.tracking.filter((t) => t.number).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {o.tracking
                        .filter((t) => t.number)
                        .map((t, i) => (
                          <a
                            key={i}
                            href={t.url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs font-medium text-violet-700 hover:underline truncate"
                          >
                            🚚 {t.company ?? "Tracking"}: {t.number}
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {shopify && shopify.configured && !shopify.noEmail && (shopify.subscriptions?.length ?? 0) > 0 && (
            <>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-900/70 mt-5 mb-3">
                Subscriptions
              </h4>
              <div className="space-y-2">
                {shopify.subscriptions!.map((sub, i) => (
                  <div key={i} className="bg-white rounded-xl border border-violet-100 shadow-[0_1px_2px_rgba(15,23,42,0.05)] p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {sub.productTitle}
                      </span>
                      <span className="flex-1" />
                      <OrderStatusChip label={sub.status.toUpperCase()} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {sub.quantity}× {sub.frequency}
                      {sub.price ? ` · $${sub.price}` : ""}
                    </p>
                    {sub.nextChargeDate && sub.status === "active" && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Next charge:{" "}
                        {new Date(sub.nextChargeDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function OrderStatusChip({ label }: { label: string }) {
  const good = ["FULFILLED", "PAID", "ACTIVE"].includes(label);
  const warn = ["UNFULFILLED", "PARTIALLY_FULFILLED", "PENDING", "PARTIALLY_PAID"].includes(label);
  return (
    <span
      className={`inline-block text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${
        good
          ? "bg-violet-100 text-violet-900"
          : warn
            ? "bg-amber-100 text-amber-800"
            : "bg-gray-100 text-gray-600"
      }`}
    >
      {label.replace(/_/g, " ").toLowerCase()}
    </span>
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
