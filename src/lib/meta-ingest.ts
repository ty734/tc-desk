// Meta webhook ingest — maps normalized FB/IG events (src/lib/meta-webhook.ts)
// onto the existing Ticket/Message model, drafts an AI reply, and runs the
// moderation dial (spec §3, §4, §6). Mirrors the Postmark inbound route's
// routing/idempotency/status logic for the social surface.
//
// Every external dependency (Prisma, the draft model call, the Graph client)
// is injected so scripts/mock-social-harness.ts can run this end to end with
// zero DB writes and zero network. The route at /api/webhooks/meta wires the
// real implementations.

import type { SocialEvent } from "@/lib/meta-webhook";
import {
  type GraphHttpClient,
  type GraphResult,
  replyToFacebookComment,
  replyToInstagramComment,
  sendFacebookDm,
  sendInstagramDm,
  resolveMetaToken,
} from "@/lib/meta-social";
import type { SocialDraftDecision, SocialDraftInput } from "@/lib/social-draft";

// ---- Moderation dial constants (spec §6) -----------------------------------------

export const AUTO_SEND_CONFIDENCE_THRESHOLD = 0.85;
/** Known-FAQ intents eligible for `high_confidence` auto-send. */
export const AUTO_SEND_INTENTS = [
  "product_question",
  "ingredient_question",
  "usage_question",
  "shipping_question",
  "price_promo",
  "praise",
] as const;

export const DM_WINDOW_MS = 24 * 60 * 60 * 1000; // Meta 24h messaging window
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // HUMAN_AGENT tag limit

// ---- Narrow DB surface (structural subset of PrismaClient) -----------------------
// Keeping this to exactly the calls ingest makes lets the harness stub it in
// ~100 lines. The route passes the real client: `db as unknown as SocialDb`.

export type IngestBoard = {
  id: string;
  columns: { id: string; name: string; position: number }[];
  fields: { id: string; name: string; options: { id: string; label: string }[] }[];
};

export type InboxRow = {
  id: string;
  brand: string;
  name: string;
  boardId: string;
  autoSendMode: string;
  metaPageId: string | null;
  metaIgId: string | null;
  metaPageTokenRef: string | null;
  board: IngestBoard;
  /** Dedicated Social board; null = fall back to the primary board. */
  socialBoard: IngestBoard | null;
};

export type TicketRow = {
  id: string;
  status: string;
  subject: string;
  channel: string;
};

export type MessageRow = { id: string; ticketId: string };

/* eslint-disable @typescript-eslint/no-explicit-any -- structural bridge to PrismaClient */
export type SocialDb = {
  inbox: { findFirst(args: any): Promise<InboxRow | null> };
  ticket: {
    findFirst(args: any): Promise<(TicketRow & { position?: number }) | null>;
    create(args: any): Promise<TicketRow>;
    update(args: any): Promise<TicketRow>;
  };
  message: {
    findFirst(args: any): Promise<MessageRow | null>;
    create(args: any): Promise<MessageRow>;
    update(args: any): Promise<MessageRow>;
  };
  ticketFieldValue: { upsert(args: any): Promise<unknown> };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type IngestDeps = {
  db: SocialDb;
  /** Atomic per-inbox ticket number (src/lib/tickets.ts nextTicketNumber). */
  nextTicketNumber: (inboxId: string) => Promise<number>;
  /** AI draft step (src/lib/social-draft.ts draftSocialReply, with real KB + model). */
  draft: (input: SocialDraftInput) => Promise<SocialDraftDecision>;
  /** Graph API HTTP layer — stubbed in the harness; fetch in production. */
  graphClient?: GraphHttpClient;
  now?: () => Date;
};

export type AutoSendOutcome = {
  attempted: boolean;
  sent: boolean;
  reason: string;
};

export type IngestResult = {
  event: SocialEvent;
  skipped?: string;
  inboxId?: string;
  ticketId?: string;
  messageId?: string;
  created?: boolean;
  channel?: string;
  windowExpiresAt?: Date | null;
  draft?: SocialDraftDecision;
  autoSend?: AutoSendOutcome;
};

const STATUSES = ["new", "open", "pending", "solved", "closed"];

export function channelFor(event: Pick<SocialEvent, "platform" | "kind">): string {
  return `${event.platform}_${event.kind === "dm" ? "dm" : "comment"}`;
}

function subjectFor(event: SocialEvent): string {
  const label = event.platform === "facebook" ? "FB" : "IG";
  const who = event.fromName ?? event.fromId;
  if (event.kind === "dm") return `${label} DM from ${who}`;
  const excerpt = event.text.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${label} comment from ${who}: ${excerpt || "(no text)"}`;
}

// ---- Auto-send gate + execution (spec §6) -----------------------------------------
// The path below is COMPLETE but unreachable in the launch state: every Inbox
// defaults autoSendMode="off", and there is no UI to change it yet. Flipping
// the dial is a deliberate Phase 2 act.

async function maybeAutoSend(opts: {
  inbox: InboxRow;
  event: SocialEvent;
  ticketId: string;
  decision: SocialDraftDecision;
  windowExpiresAt: Date | null;
  deps: IngestDeps;
}): Promise<AutoSendOutcome> {
  const { inbox, event, decision, deps } = opts;
  const mode = inbox.autoSendMode;
  if (mode !== "high_confidence" && mode !== "all") {
    return { attempted: false, sent: false, reason: "autoSendMode off — draft awaits human approval" };
  }
  if (!decision.respond || !decision.reply) {
    return { attempted: false, sent: false, reason: "no reply drafted" };
  }
  if (decision.flagReason) {
    return { attempted: false, sent: false, reason: `compliance-flagged: ${decision.flagReason}` };
  }
  if (decision.confidence < AUTO_SEND_CONFIDENCE_THRESHOLD) {
    return { attempted: false, sent: false, reason: `confidence ${decision.confidence} below threshold` };
  }
  if (mode === "high_confidence" && !(AUTO_SEND_INTENTS as readonly string[]).includes(decision.intent)) {
    return { attempted: false, sent: false, reason: `intent "${decision.intent}" not auto-send eligible` };
  }
  const now = (deps.now ?? (() => new Date()))();
  if (event.kind === "dm" && opts.windowExpiresAt && now > opts.windowExpiresAt) {
    // Outside 24h only a HUMAN may reply (HUMAN_AGENT tag). Bots are blocked.
    return { attempted: false, sent: false, reason: "outside the 24h DM window — human reply only" };
  }
  const token = resolveMetaToken(inbox.metaPageTokenRef);
  if (!token) return { attempted: false, sent: false, reason: "no Meta token configured" };

  let result: GraphResult;
  if (event.kind === "comment") {
    result =
      event.platform === "facebook"
        ? await replyToFacebookComment(
            { commentId: event.commentId!, message: decision.reply, token },
            deps.graphClient
          )
        : await replyToInstagramComment(
            { commentId: event.commentId!, message: decision.reply, token },
            deps.graphClient
          );
  } else {
    const dm = { recipientId: event.fromId, text: decision.reply, token }; // NEVER humanAgentTag here
    result =
      event.platform === "facebook"
        ? await sendFacebookDm(dm, deps.graphClient)
        : await sendInstagramDm(dm, deps.graphClient);
  }
  if (!result.ok) return { attempted: true, sent: false, reason: `send failed: ${result.error}` };

  // Audit trail: system-authored outbound Message (same pattern as the email
  // autoresponder — authorId null = no human author).
  await deps.db.message.create({
    data: {
      ticketId: opts.ticketId,
      direction: "outbound",
      authorId: null,
      fromAddr: `${event.platform}:${inbox.metaPageId ?? inbox.metaIgId ?? "page"}`,
      toAddr: `${event.platform}:${event.fromId}`,
      subject: null,
      bodyText: decision.reply,
      provider: "meta",
      providerMessageId: result.id,
      platformMessageId: result.id,
      platformThreadId: event.platformThreadId,
    },
  });
  return { attempted: true, sent: true, reason: `auto-sent (${mode}, confidence ${decision.confidence})` };
}

// ---- Main ingest ------------------------------------------------------------------

export async function ingestSocialEvent(event: SocialEvent, deps: IngestDeps): Promise<IngestResult> {
  const { db } = deps;

  // Echoes (our own outbound reflected back) never re-enter the pipeline.
  if (event.isEcho) return { event, skipped: "echo of our own message" };

  // Which brand/inbox owns this Page or IG account?
  const inbox = await db.inbox.findFirst({
    where:
      event.platform === "facebook" ? { metaPageId: event.accountId } : { metaIgId: event.accountId },
    include: {
      board: { include: { columns: true, fields: { include: { options: true } } } },
      socialBoard: { include: { columns: true, fields: { include: { options: true } } } },
    },
  });
  if (!inbox) return { event, skipped: `no inbox mapped to ${event.platform} account ${event.accountId}` };

  // The Page/IG account commenting on its own post (e.g. a manual reply from
  // the native app) is not a customer message.
  if (event.fromId === inbox.metaPageId || event.fromId === inbox.metaIgId) {
    return { event, skipped: "authored by our own account", inboxId: inbox.id };
  }

  // Idempotency: Meta retries webhook deliveries; a platformMessageId we have
  // already stored is a no-op (mirrors the Postmark MessageID dedupe).
  const dupe = await db.message.findFirst({
    where: { platformMessageId: event.platformMessageId, ticket: { inboxId: inbox.id } },
    select: { id: true, ticketId: true },
  });
  if (dupe) {
    return { event, skipped: "duplicate delivery", inboxId: inbox.id, ticketId: dupe.ticketId, messageId: dupe.id };
  }

  // ---- Route to a ticket: one comment thread / one DM conversation = one Ticket.
  let ticket: TicketRow | null = null;
  const threadMatch = await db.message.findFirst({
    where: { platformThreadId: event.platformThreadId, ticket: { inboxId: inbox.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, ticketId: true },
  });
  if (threadMatch) {
    ticket = await db.ticket.findFirst({ where: { id: threadMatch.ticketId } });
  }

  const channel = channelFor(event);
  // Social tickets live on the dedicated Social board when one is configured;
  // until then (socialBoardId null) they land on the primary board as before.
  // Either way the ticket keeps inboxId = this inbox, so replies, the Page
  // token, KB grounding, and dedupe/threading are unaffected.
  const board = inbox.socialBoard ?? inbox.board;
  const columns = [...board.columns].sort((a, b) => a.position - b.position);
  const colByStatus = (s: string) => columns.find((c) => c.name.trim().toLowerCase() === s) ?? columns[0];
  let created = false;

  if (!ticket) {
    created = true;
    const newCol = colByStatus("new");
    const last = await db.ticket.findFirst({ where: { columnId: newCol.id }, orderBy: { position: "desc" } });
    const number = await deps.nextTicketNumber(inbox.id);
    ticket = await db.ticket.create({
      data: {
        number,
        inboxId: inbox.id,
        boardId: board.id,
        columnId: newCol.id,
        subject: subjectFor(event),
        position: (last?.position ?? 0) + 1,
        channel,
        status: STATUSES.includes(newCol.name.trim().toLowerCase())
          ? newCol.name.trim().toLowerCase()
          : "new",
        // Social users have no email; the agent can add one later for the
        // Shopify sidebar. customerName keeps the board card readable.
        customerName: event.fromName ?? null,
        lastMessageAt: event.timestamp,
      },
    });

    // Channel chip so board filters work. The Social board seeded by
    // scripts/seed-social-board.ts ships a Channel field with Facebook +
    // Instagram options; on a board without them this is a silent no-op.
    const channelField = board.fields.find((f) => f.name === "Channel");
    const label = event.platform === "facebook" ? "facebook" : "instagram";
    const opt = channelField?.options.find((o) => o.label.toLowerCase() === label);
    if (channelField && opt) {
      await db.ticketFieldValue.upsert({
        where: { ticketId_fieldId: { ticketId: ticket.id, fieldId: channelField.id } },
        create: { ticketId: ticket.id, fieldId: channelField.id, optionId: opt.id },
        update: { optionId: opt.id },
      });
    }
  }

  // ---- Store the inbound message. DMs get the 24h window stamp; each new
  // inbound resets it (spec §5).
  const windowExpiresAt = event.kind === "dm" ? new Date(event.timestamp.getTime() + DM_WINDOW_MS) : null;
  const message = await db.message.create({
    data: {
      ticketId: ticket.id,
      direction: "inbound",
      fromAddr: `${event.platform}:${event.fromId}`,
      toAddr: `${event.platform}:${event.accountId}`,
      subject: null,
      bodyText: event.text || null,
      provider: "meta",
      providerMessageId: event.platformMessageId,
      platformMessageId: event.platformMessageId,
      platformThreadId: event.platformThreadId,
      windowExpiresAt,
      createdAt: event.timestamp,
    },
  });

  // ---- Status transition (same rule as email): new tickets stay in New;
  // replies on existing tickets reopen pending/solved/closed to Open.
  const update: Record<string, unknown> = { lastMessageAt: event.timestamp };
  if (!created && ["pending", "solved", "closed"].includes(ticket.status)) {
    const openCol = colByStatus("open");
    update.columnId = openCol.id;
    update.status = "open";
  }
  await db.ticket.update({ where: { id: ticket.id }, data: update });

  // ---- AI draft (reuses the KB-grounded brain; never breaks ingest on failure).
  let decision: SocialDraftDecision | undefined;
  try {
    decision = await deps.draft({
      platform: event.platform,
      kind: event.kind,
      fromName: event.fromName,
      text: event.text,
      inbox: { id: inbox.id, name: inbox.name },
    });
    if (decision.respond && decision.reply) {
      await db.message.update({
        where: { id: message.id },
        data: {
          aiDraft: decision.reply,
          aiConfidence: decision.confidence,
          aiIntent: decision.intent,
          aiFlagReason: decision.flagReason ?? null,
        },
      });
    }
  } catch (err) {
    console.error("[meta-ingest] draft failed", err);
  }

  // ---- Moderation dial (unreachable while every inbox is "off").
  let autoSend: AutoSendOutcome = { attempted: false, sent: false, reason: "no draft" };
  if (decision) {
    autoSend = await maybeAutoSend({ inbox, event, ticketId: ticket.id, decision, windowExpiresAt, deps });
  }

  return {
    event,
    inboxId: inbox.id,
    ticketId: ticket.id,
    messageId: message.id,
    created,
    channel,
    windowExpiresAt,
    draft: decision,
    autoSend,
  };
}

export async function ingestSocialEvents(events: SocialEvent[], deps: IngestDeps): Promise<IngestResult[]> {
  // Sequential on purpose: events in one delivery can share a thread/ticket.
  const results: IngestResult[] = [];
  for (const event of events) {
    try {
      results.push(await ingestSocialEvent(event, deps));
    } catch (err) {
      console.error("[meta-ingest] event failed", err);
      results.push({ event, skipped: `error: ${String(err)}` });
    }
  }
  return results;
}
