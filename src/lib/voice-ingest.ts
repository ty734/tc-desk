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
      bodyText: "📞 Incoming call — voicemail pending…",
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

  const d = opts.durationSec;
  const stamp = d != null && d > 0 ? ` (${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")})` : "";
  await db.message.update({
    where: { id: message.id },
    data: { bodyText: `📞 Voicemail${stamp} — audio attached.` },
  });
  await db.ticket.update({ where: { id: message.ticketId }, data: { lastMessageAt: new Date() } });
  return { ok: true };
}
