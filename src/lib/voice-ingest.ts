import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { nextTicketNumber } from "@/lib/tickets";
import { downloadTwilioRecording, formatPhone } from "@/lib/twilio";

// Maps an inbound Twilio call onto the existing Ticket/Message model — the
// voice analog of the Postmark inbound route and the Meta ingest. A call is a
// Message with channel "voice" / provider "twilio" (like a social DM is a
// Message), NOT a Comment — Comments are internal notes only and must never
// leave the desk. The voice channel simply has no email send path, so the
// "never email a recording" rule holds automatically.
//
// Phase 1 is voicemail-only: incoming calls create/route a ticket and the
// recording callback attaches the audio. Live answer (softphone) and outbound
// come in Phase 2 / 3.

const STATUSES = ["new", "open", "pending", "solved", "closed"];
const THREAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // reuse a recent open ticket per caller

// Placeholder body written when a call first lands, before we know how it ends.
// Exported so the "did anything overwrite this yet?" checks can't drift from it.
export const CALL_PENDING_BODY = "📞 Incoming call — in progress…";

/** "1:05" from seconds; "" when we have no usable duration. */
function durationStamp(sec: number | null): string {
  if (sec == null || sec <= 0) return "";
  return ` (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")})`;
}

/** Resolve the brand/inbox that owns a dialed Twilio number, with its board. */
export function inboxByNumber(toNumber: string) {
  return db.inbox.findUnique({
    where: { twilioNumber: toNumber },
    include: {
      board: { include: { columns: true, fields: { include: { options: true } } } },
    },
  });
}

export type VoiceInbox = NonNullable<Awaited<ReturnType<typeof inboxByNumber>>>;

/**
 * Log an inbound call as a ticket + placeholder Message, keyed by CallSid.
 * Called from the incoming webhook, where From/To are available (the later
 * recording callback carries only the CallSid, so it matches back to here).
 * Idempotent: one CallSid = one Message.
 */
export async function routeInboundCall(
  inbox: VoiceInbox,
  from: string,
  callSid: string,
): Promise<{ ticketId: string; messageId: string; created: boolean }> {
  const existing = await db.message.findFirst({
    where: { providerMessageId: callSid, ticket: { inboxId: inbox.id } },
    select: { id: true, ticketId: true },
  });
  if (existing) return { ticketId: existing.ticketId, messageId: existing.id, created: false };

  const columns = [...inbox.board.columns].sort((a, b) => a.position - b.position);
  const colByStatus = (s: string) =>
    columns.find((c) => c.name.trim().toLowerCase() === s) ?? columns[0];

  // Thread onto a recent open ticket from the same caller (mirrors email rule c).
  let ticket = await db.ticket.findFirst({
    where: {
      inboxId: inbox.id,
      customerPhone: from,
      status: { notIn: ["closed"] },
      updatedAt: { gte: new Date(Date.now() - THREAD_WINDOW_MS) },
    },
    orderBy: { updatedAt: "desc" },
  });
  let created = false;

  if (!ticket) {
    created = true;
    // Callers usually have no email, and Customer.email is required + unique, so
    // we can't mint a Customer row here — match an existing one by phone, else
    // leave customerId null and keep the number on the ticket (social pattern).
    const customer = await db.customer.findFirst({ where: { phone: from } });
    const newCol = colByStatus("new");
    const last = await db.ticket.findFirst({
      where: { columnId: newCol.id },
      orderBy: { position: "desc" },
    });
    const number = await nextTicketNumber(inbox.id);
    ticket = await db.ticket.create({
      data: {
        number,
        inboxId: inbox.id,
        boardId: inbox.boardId,
        columnId: newCol.id,
        subject: `Call from ${formatPhone(from)}`,
        position: (last?.position ?? 0) + 1,
        channel: "voice",
        status: STATUSES.includes(newCol.name.trim().toLowerCase())
          ? newCol.name.trim().toLowerCase()
          : "new",
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? formatPhone(from),
        customerPhone: from,
        lastMessageAt: new Date(),
      },
    });

    // Channel chip so board filters work (silent no-op until the board's
    // Channel field has a "Phone" option — see scripts/setup-voice-brand.ts).
    const field = inbox.board.fields.find((f) => f.name === "Channel");
    const opt = field?.options.find((o) => o.label.toLowerCase() === "phone");
    if (field && opt) {
      await db.ticketFieldValue.upsert({
        where: { ticketId_fieldId: { ticketId: ticket.id, fieldId: field.id } },
        create: { ticketId: ticket.id, fieldId: field.id, optionId: opt.id },
        update: { optionId: opt.id },
      });
    }
  } else if (["pending", "solved", "closed"].includes(ticket.status)) {
    // A repeat caller on a resolved ticket reopens it (same rule as email).
    const openCol = colByStatus("open");
    await db.ticket.update({
      where: { id: ticket.id },
      data: { columnId: openCol.id, status: "open", lastMessageAt: new Date() },
    });
  } else {
    await db.ticket.update({ where: { id: ticket.id }, data: { lastMessageAt: new Date() } });
  }

  const message = await db.message.create({
    data: {
      ticketId: ticket.id,
      direction: "inbound",
      authorId: null,
      fromAddr: from,
      toAddr: inbox.twilioNumber ?? "",
      subject: null,
      bodyText: CALL_PENDING_BODY,
      provider: "twilio",
      providerMessageId: callSid,
    },
  });

  return { ticketId: ticket.id, messageId: message.id, created };
}

/**
 * Attach a completed voicemail recording to the call's Message. Re-hosts the
 * audio on Vercel Blob (like an email attachment) so the desk can play it
 * without Twilio auth. Idempotent (callback retries are a no-op).
 */
export async function attachVoicemailRecording(opts: {
  callSid: string;
  recordingUrl: string;
  durationSec: number | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const message = await db.message.findFirst({
    where: { providerMessageId: opts.callSid },
    select: { id: true, ticketId: true },
  });
  if (!message) return { ok: false, reason: "no message for CallSid (call not routed)" };

  const already = await db.attachment.findFirst({ where: { messageId: message.id } });
  if (already) return { ok: true, reason: "already attached" };

  const { buffer, contentType } = await downloadTwilioRecording(opts.recordingUrl);
  const filename = `voicemail-${opts.callSid}.mp3`;
  const blob = await put(`tickets/${message.ticketId}/${message.id}/${filename}`, buffer, {
    access: "public",
    contentType,
  });
  await db.attachment.create({
    data: {
      messageId: message.id,
      filename,
      contentType,
      blobUrl: blob.url,
      sizeBytes: buffer.length,
    },
  });

  const stamp = durationStamp(opts.durationSec);
  await db.message.update({
    where: { id: message.id },
    data: { bodyText: `📞 Voicemail${stamp} — audio attached.` },
  });
  await db.ticket.update({ where: { id: message.ticketId }, data: { lastMessageAt: new Date() } });
  return { ok: true };
}

/**
 * Append a voicemail transcript to its Message (matched by CallSid). Idempotent:
 * re-strips any prior transcript before re-appending, so callback retries are safe.
 */
export async function attachTranscript(callSid: string, text: string): Promise<void> {
  const message = await db.message.findFirst({
    where: { providerMessageId: callSid },
    select: { id: true, bodyText: true },
  });
  if (!message) return;
  const base = (message.bodyText ?? "📞 Voicemail").split("\n\nTranscript:")[0].trimEnd();
  await db.message.update({
    where: { id: message.id },
    data: { bodyText: `${base}\n\nTranscript: ${text}` },
  });
}

/**
 * Mark a call as answered by an agent (the <Dial> finished with someone on the
 * line, so there is no voicemail coming). Without this the placeholder body
 * would sit on the ticket forever, reading as if a voicemail were still pending.
 *
 * Only overwrites the placeholder — a recording or transcript that somehow beat
 * us here is the better record and is left alone. Idempotent on callback retry.
 */
export async function markCallAnswered(callSid: string, durationSec: number | null): Promise<void> {
  const message = await db.message.findFirst({
    where: { providerMessageId: callSid },
    select: { id: true, bodyText: true, ticketId: true },
  });
  if (!message || message.bodyText !== CALL_PENDING_BODY) return;

  await db.message.update({
    where: { id: message.id },
    data: { bodyText: `📞 Call answered${durationStamp(durationSec)}.` },
  });
  await db.ticket.update({ where: { id: message.ticketId }, data: { lastMessageAt: new Date() } });
}

// NOTE: a caller who hangs up mid-ring, or at the voicemail beep without
// speaking, leaves the placeholder in place — no callback reliably fires for
// that case without adding a per-number statusCallback. "In progress…" is at
// least honest; the old wording claimed a voicemail was coming.

// ---- Outbound (Phase 3) ------------------------------------------------------

function inboxWithBoardById(id: string) {
  return db.inbox.findUnique({
    where: { id },
    include: { board: { include: { columns: true, fields: { include: { options: true } } } } },
  });
}

/** Every brand with a voice number configured, stable order. */
export function voiceInboxes() {
  return db.inbox.findMany({
    where: { twilioNumber: { not: null } },
    select: { brand: true, name: true, twilioNumber: true },
    orderBy: { brand: "asc" },
  });
}

/**
 * The caller-ID number an outbound call should show, resolved by ticket → brand.
 * Cheap (no board) — used to build the <Dial>.
 *
 * Returns null rather than guessing when neither is given: with more than one
 * brand on the account, a fallback would happily show a Living Well customer the
 * Longer Together number. Callers must pass a ticketId or an explicit brand —
 * the softphone dialer has a brand picker for exactly this reason.
 */
export async function resolveOutboundCallerId(opts: {
  ticketId?: string;
  brand?: string;
}): Promise<string | null> {
  if (opts.ticketId) {
    const t = await db.ticket.findUnique({
      where: { id: opts.ticketId },
      select: { inbox: { select: { twilioNumber: true } } },
    });
    if (t?.inbox?.twilioNumber) return t.inbox.twilioNumber;
  }
  if (opts.brand) {
    const inbox = await db.inbox.findUnique({
      where: { brand: opts.brand },
      select: { twilioNumber: true },
    });
    if (inbox?.twilioNumber) return inbox.twilioNumber;
  }
  // Single-brand accounts have no ambiguity, so falling back is still safe there.
  const all = await voiceInboxes();
  return all.length === 1 ? all[0].twilioNumber : null;
}

/**
 * Log an agent-placed outbound call as an outbound Message — on the ticket it
 * was launched from, else threading/creating one by the dialed number so every
 * call lands on the board. Best-effort (the route must not block the call on
 * it). Idempotent per CallSid.
 */
export async function logOutboundCall(opts: {
  to: string;
  callSid: string;
  agentUserId: string | null;
  ticketId?: string;
  brand?: string;
}): Promise<void> {
  const dupe = await db.message.findFirst({
    where: { providerMessageId: opts.callSid },
    select: { id: true },
  });
  if (dupe) return;

  let inbox: VoiceInbox | null = null;
  let ticketId = opts.ticketId ?? null;

  if (ticketId) {
    const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { inboxId: true } });
    if (t) inbox = await inboxWithBoardById(t.inboxId);
    else ticketId = null;
  }
  if (!inbox && opts.brand) {
    inbox = await db.inbox.findUnique({
      where: { brand: opts.brand },
      include: { board: { include: { columns: true, fields: { include: { options: true } } } } },
    });
  }
  if (!inbox) {
    // Same rule as resolveOutboundCallerId: only assume the brand when there is
    // exactly one, otherwise the call would be logged onto another brand's board.
    const voice = await voiceInboxes();
    if (voice.length !== 1) return;
    inbox = await db.inbox.findUnique({
      where: { brand: voice[0].brand },
      include: { board: { include: { columns: true, fields: { include: { options: true } } } } },
    });
  }
  if (!inbox) return;

  // No launching ticket → thread onto a recent open call ticket for this number,
  // else create one (same rules as inbound routing).
  if (!ticketId) {
    const columns = [...inbox.board.columns].sort((a, b) => a.position - b.position);
    const colByStatus = (s: string) =>
      columns.find((c) => c.name.trim().toLowerCase() === s) ?? columns[0];
    const open = await db.ticket.findFirst({
      where: {
        inboxId: inbox.id,
        customerPhone: opts.to,
        status: { notIn: ["closed"] },
        updatedAt: { gte: new Date(Date.now() - THREAD_WINDOW_MS) },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (open) {
      ticketId = open.id;
    } else {
      const customer = await db.customer.findFirst({ where: { phone: opts.to } });
      const newCol = colByStatus("new");
      const last = await db.ticket.findFirst({
        where: { columnId: newCol.id },
        orderBy: { position: "desc" },
      });
      const number = await nextTicketNumber(inbox.id);
      const created = await db.ticket.create({
        data: {
          number,
          inboxId: inbox.id,
          boardId: inbox.boardId,
          columnId: newCol.id,
          subject: `Call to ${formatPhone(opts.to)}`,
          position: (last?.position ?? 0) + 1,
          channel: "voice",
          status: STATUSES.includes(newCol.name.trim().toLowerCase())
            ? newCol.name.trim().toLowerCase()
            : "new",
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? formatPhone(opts.to),
          customerPhone: opts.to,
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });
      const field = inbox.board.fields.find((f) => f.name === "Channel");
      const opt = field?.options.find((o) => o.label.toLowerCase() === "phone");
      if (field && opt) {
        await db.ticketFieldValue.upsert({
          where: { ticketId_fieldId: { ticketId: created.id, fieldId: field.id } },
          create: { ticketId: created.id, fieldId: field.id, optionId: opt.id },
          update: { optionId: opt.id },
        });
      }
      ticketId = created.id;
    }
  }

  // Validate the agent id before using it as authorId (FK safety).
  let authorId: string | null = null;
  if (opts.agentUserId) {
    const u = await db.user.findUnique({ where: { id: opts.agentUserId }, select: { id: true } });
    authorId = u?.id ?? null;
  }

  await db.message.create({
    data: {
      ticketId,
      direction: "outbound",
      authorId,
      fromAddr: inbox.twilioNumber ?? "",
      toAddr: opts.to,
      subject: null,
      bodyText: `📞 Outbound call to ${formatPhone(opts.to)}`,
      provider: "twilio",
      providerMessageId: opts.callSid,
    },
  });
  await db.ticket.update({ where: { id: ticketId }, data: { lastMessageAt: new Date() } });
}
