// Mock harness for the social engagement layer (BUILD-SPEC §8). Runs the full
// inbound → ingest → draft → moderation-dial → would-send pipeline for FB + IG
// comments and DMs with Prisma AND the Graph API client AND the model call all
// stubbed: ZERO database access, ZERO network calls (global fetch is booby-
// trapped below to prove it).
//
// Usage: npx tsx scripts/mock-social-harness.ts
// Exits 0 with a PASS summary, or 1 listing every failed assertion.

import { createHmac } from "crypto";
import {
  verifyChallenge,
  verifySignature,
  parseMetaWebhook,
  type MetaWebhookPayload,
} from "../src/lib/meta-webhook";
import {
  ingestSocialEvents,
  AUTO_SEND_CONFIDENCE_THRESHOLD,
  DM_WINDOW_MS,
  type SocialDb,
  type IngestDeps,
  type InboxRow,
} from "../src/lib/meta-ingest";
import { draftSocialReply, type SocialDraftDecision } from "../src/lib/social-draft";
import { sendFacebookDm, type GraphHttpClient } from "../src/lib/meta-social";
import { hideTicketComment, type HideDb, type HideTicketRow } from "../src/lib/hide-comment";

// ---- Hard no-network guard --------------------------------------------------------
// Any code path that reaches for the real network fails the run loudly.
(globalThis as { fetch: unknown }).fetch = () => {
  throw new Error("NETWORK CALL ATTEMPTED — the harness must run fully stubbed");
};

// ---- Tiny test runner ---------------------------------------------------------------
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
  }
}
function section(title: string) {
  console.log(`\n== ${title} ==`);
}

// ---- Stub Prisma (in-memory; the ONLY writes in this run land here) -----------------

type AnyRow = Record<string, unknown>;

function makeStubDb(inbox: InboxRow) {
  const tickets: AnyRow[] = [];
  const messages: AnyRow[] = [];
  const fieldValues: AnyRow[] = [];
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;

  const db: SocialDb = {
    inbox: {
      async findFirst(args: { where: { metaPageId?: string; metaIgId?: string } }) {
        const w = args.where;
        if (w.metaPageId && inbox.metaPageId === w.metaPageId) return inbox;
        if (w.metaIgId && inbox.metaIgId === w.metaIgId) return inbox;
        return null;
      },
    },
    ticket: {
      async findFirst(args: { where: AnyRow; orderBy?: AnyRow }) {
        let rows = tickets.filter((t) =>
          Object.entries(args.where).every(([k, v]) => t[k] === v)
        );
        if (args.orderBy && (args.orderBy as { position?: string }).position === "desc") {
          rows = [...rows].sort((a, b) => (b.position as number) - (a.position as number));
        }
        return (rows[0] as never) ?? null;
      },
      async create(args: { data: AnyRow }) {
        const row = { id: id("tkt"), ...args.data };
        tickets.push(row);
        return row as never;
      },
      async update(args: { where: { id: string }; data: AnyRow }) {
        const row = tickets.find((t) => t.id === args.where.id);
        if (!row) throw new Error("ticket not found");
        Object.assign(row, args.data);
        return row as never;
      },
    },
    message: {
      async findFirst(args: { where: AnyRow; orderBy?: AnyRow }) {
        const w = args.where as { platformMessageId?: string; platformThreadId?: string; ticket?: { inboxId: string } };
        let rows = messages.filter(
          (m) =>
            (w.platformMessageId === undefined || m.platformMessageId === w.platformMessageId) &&
            (w.platformThreadId === undefined || m.platformThreadId === w.platformThreadId)
        );
        if (w.ticket?.inboxId) {
          rows = rows.filter((m) => {
            const t = tickets.find((t) => t.id === m.ticketId);
            return t?.inboxId === w.ticket!.inboxId;
          });
        }
        rows = [...rows].sort(
          (a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
        );
        return (rows[0] as never) ?? null;
      },
      async create(args: { data: AnyRow }) {
        const row = { id: id("msg"), createdAt: new Date(), ...args.data };
        messages.push(row);
        return row as never;
      },
      async update(args: { where: { id: string }; data: AnyRow }) {
        const row = messages.find((m) => m.id === args.where.id);
        if (!row) throw new Error("message not found");
        Object.assign(row, args.data);
        return row as never;
      },
    },
    ticketFieldValue: {
      async upsert(args: AnyRow) {
        fieldValues.push(args);
        return args;
      },
    },
  };
  return { db, tickets, messages, fieldValues };
}

function makeInbox(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    id: "inbox_lw",
    brand: "living-well",
    name: "Living Well Support",
    boardId: "board_lw",
    autoSendMode: "off",
    metaPageId: "PAGE_1001",
    metaIgId: "IG_2002",
    metaPageTokenRef: "env:LW_META_PAGE_TOKEN",
    board: {
      id: "board_lw",
      columns: [
        { id: "col_new", name: "New", position: 0 },
        { id: "col_open", name: "Open", position: 1 },
        { id: "col_pending", name: "Pending", position: 2 },
      ],
      fields: [{ id: "fld_channel", name: "Channel", options: [{ id: "opt_fb", label: "Facebook" }] }],
    },
    socialBoard: null, // launch state: fall back to the primary board
    ...overrides,
  };
}

/** The dedicated Social board as seeded by scripts/seed-social-board.ts. */
function makeSocialBoard() {
  return {
    id: "board_social",
    columns: [
      { id: "col_s_new", name: "New", position: 1 },
      { id: "col_s_open", name: "Open", position: 2 },
      { id: "col_s_pending", name: "Pending", position: 3 },
    ],
    fields: [
      {
        id: "fld_s_channel",
        name: "Channel",
        options: [
          { id: "opt_s_fb", label: "Facebook" },
          { id: "opt_s_ig", label: "Instagram" },
        ],
      },
    ],
  };
}

// ---- Stub Graph client (records every would-send; answers success) -------------------

function makeStubGraph() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const client: GraphHttpClient = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body ?? "{}") });
    return { ok: true, status: 200, json: async () => ({ id: "sent_123", message_id: "sent_123" }) };
  };
  return { calls, client };
}

// ---- Stub model + KB (the draft step runs its REAL code around these) ----------------

const KB_HIT = {
  id: "kb1",
  source: "faq.md",
  title: "Remineralizing Tooth Powder FAQ",
  content:
    "The Remineralizing Tooth Powder is fluoride free and features hydroxyapatite, the mineral your teeth are made of. Use it twice daily in place of toothpaste.",
  rank: 1,
};
const kbCalls: { inboxId: string; query: string }[] = [];
const stubSearchKb = async (inboxId: string, query: string) => {
  kbCalls.push({ inboxId, query });
  return [KB_HIT];
};

let capturedSystemPrompt = "";
function stubComplete(json: Record<string, unknown>) {
  return async (system: string) => {
    capturedSystemPrompt = system;
    return JSON.stringify(json);
  };
}

const GOOD_DRAFT = {
  respond: true,
  confidence: 0.92,
  intent: "product_question",
  reply:
    "Great question! Our Remineralizing Tooth Powder is fluoride free and features hydroxyapatite, the mineral your teeth are made of. You can find the full ingredient list on the product page, and we're happy to help anytime at support@livingwellwithdrmichelle.com.",
  flag: "",
};

function draftWith(json: Record<string, unknown>) {
  return (input: Parameters<typeof draftSocialReply>[0]) =>
    draftSocialReply(input, { searchKb: stubSearchKb, complete: stubComplete(json) });
}

// ---- Sample webhook payloads (real shapes per BUILD-SPEC §5) --------------------------

const NOW_S = Math.floor(Date.now() / 1000);
const NOW_MS = Date.now();

const fbCommentPayload: MetaWebhookPayload = {
  object: "page",
  entry: [
    {
      id: "PAGE_1001",
      time: NOW_S,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "PAGE_1001_98765",
            post_id: "PAGE_1001_11111",
            from: { id: "fbuser_501", name: "Sarah Miller" },
            message: "Is the tooth powder fluoride free? What are the ingredients?",
            created_time: NOW_S,
          },
        },
      ],
    },
  ],
};

const fbDmPayload: MetaWebhookPayload = {
  object: "page",
  entry: [
    {
      id: "PAGE_1001",
      time: NOW_S,
      messaging: [
        {
          sender: { id: "psid_777" },
          recipient: { id: "PAGE_1001" },
          timestamp: NOW_MS,
          message: { mid: "mid.fb.001", text: "Hi! Where is my order? I ordered last week." },
        },
      ],
    },
  ],
};

const igCommentPayload: MetaWebhookPayload = {
  object: "instagram",
  entry: [
    {
      id: "IG_2002",
      time: NOW_S,
      changes: [
        {
          field: "comments",
          value: {
            id: "igc_31337",
            from: { id: "iguser_42", username: "wellness.mom" },
            media: { id: "igmedia_555" },
            text: "Love this! How often should my kids use the powder?",
          },
        },
      ],
    },
  ],
};

const igDmPayload: MetaWebhookPayload = {
  object: "instagram",
  entry: [
    {
      id: "IG_2002",
      time: NOW_S,
      messaging: [
        {
          sender: { id: "igsid_888" },
          recipient: { id: "IG_2002" },
          timestamp: NOW_MS,
          message: { mid: "mid.ig.001", text: "Does the mouthwash work with braces?" },
        },
      ],
    },
  ],
};

// ---- The run ---------------------------------------------------------------------------

async function main() {
  // 1. Webhook verification plumbing (pure functions).
  section("Webhook verification");
  process.env.LW_META_PAGE_TOKEN = "FAKE_TEST_TOKEN_NOT_REAL"; // env-ref target for the stub runs
  const verifyToken = "verify-me";
  const goodParams = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": verifyToken,
    "hub.challenge": "challenge-42",
  });
  check("GET challenge echoes hub.challenge on token match", verifyChallenge(goodParams, verifyToken) === "challenge-42");
  const badParams = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": "wrong",
    "hub.challenge": "x",
  });
  check("GET challenge rejects a wrong verify token", verifyChallenge(badParams, verifyToken) === null);

  const appSecret = "fake-app-secret-for-tests";
  const rawBody = JSON.stringify(fbCommentPayload);
  const sig = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  check("POST signature verifies a correctly signed body", verifySignature(rawBody, sig, appSecret));
  check("POST signature rejects a tampered body", !verifySignature(rawBody + " ", sig, appSecret));
  check("POST signature rejects a missing header", !verifySignature(rawBody, null, appSecret));

  // 2. Payload parsing.
  section("Payload parsing (§5 shapes)");
  const fbCommentEvents = parseMetaWebhook(fbCommentPayload);
  check("FB feed comment parses to one comment event", fbCommentEvents.length === 1 && fbCommentEvents[0].kind === "comment" && fbCommentEvents[0].platform === "facebook");
  check("FB comment carries comment_id/post_id/from/message", fbCommentEvents[0].commentId === "PAGE_1001_98765" && fbCommentEvents[0].postId === "PAGE_1001_11111" && fbCommentEvents[0].fromId === "fbuser_501" && fbCommentEvents[0].text.includes("fluoride"));
  const igCommentEvents = parseMetaWebhook(igCommentPayload);
  check("IG comment parses with media id as thread", igCommentEvents.length === 1 && igCommentEvents[0].platformThreadId === "igmedia_555" && igCommentEvents[0].fromName === "wellness.mom");
  const fbDmEvents = parseMetaWebhook(fbDmPayload);
  check("FB DM parses to a dm event keyed by sender", fbDmEvents.length === 1 && fbDmEvents[0].kind === "dm" && fbDmEvents[0].platformThreadId === "facebook-dm-psid_777");
  check("IG DM parses on the instagram object", parseMetaWebhook(igDmPayload)[0]?.platform === "instagram");

  // 3. Full pipeline, dial OFF (the launch state).
  section("Ingest → draft with autoSendMode=off (launch state)");
  const off = makeStubDb(makeInbox());
  const offGraph = makeStubGraph();
  let counter = 100;
  const offDeps: IngestDeps = {
    db: off.db,
    nextTicketNumber: async () => ++counter,
    draft: draftWith(GOOD_DRAFT),
    graphClient: offGraph.client,
  };

  const allEvents = [
    ...fbCommentEvents,
    ...fbDmEvents,
    ...igCommentEvents,
    ...parseMetaWebhook(igDmPayload),
  ];
  const results = await ingestSocialEvents(allEvents, offDeps);

  check("four events ingested, none skipped", results.every((r) => !r.skipped) && results.length === 4);
  check(
    "channel mapping is correct for all four",
    results.map((r) => r.channel).join(",") === "facebook_comment,facebook_dm,instagram_comment,instagram_dm"
  );
  check("each conversation created its own ticket", off.tickets.length === 4 && results.every((r) => r.created));
  const fbTicket = off.tickets.find((t) => t.channel === "facebook_comment");
  check(
    "ticket shape: inbox/board/column/status/number/subject/customerName",
    !!fbTicket &&
      fbTicket.inboxId === "inbox_lw" &&
      fbTicket.boardId === "board_lw" &&
      fbTicket.columnId === "col_new" &&
      fbTicket.status === "new" &&
      typeof fbTicket.number === "number" &&
      String(fbTicket.subject).startsWith("FB comment from Sarah Miller") &&
      fbTicket.customerName === "Sarah Miller"
  );
  const inboundMsgs = off.messages.filter((m) => m.direction === "inbound");
  check(
    "message shape: provider=meta + platform ids + from/to addrs",
    inboundMsgs.length === 4 &&
      inboundMsgs.every((m) => m.provider === "meta" && m.platformMessageId && m.platformThreadId) &&
      inboundMsgs[0].fromAddr === "facebook:fbuser_501" &&
      inboundMsgs[0].toAddr === "facebook:PAGE_1001"
  );
  const dmMsgs = inboundMsgs.filter((m) => String(m.fromAddr).includes("psid_777") || String(m.fromAddr).includes("igsid_888"));
  check(
    "DMs get windowExpiresAt = inbound + 24h; comments get none",
    dmMsgs.length === 2 &&
      dmMsgs.every(
        (m) => Math.abs((m.windowExpiresAt as Date).getTime() - (NOW_MS + DM_WINDOW_MS)) < 5000
      ) &&
      inboundMsgs.filter((m) => !String(m.fromAddr).match(/psid|igsid/)).every((m) => m.windowExpiresAt === null)
  );
  check(
    "KB-grounded draft stored on every inbound message",
    inboundMsgs.every(
      (m) => m.aiDraft === GOOD_DRAFT.reply && m.aiConfidence === 0.92 && m.aiIntent === "product_question" && m.aiFlagReason === null
    )
  );
  check("draft step searched the KB with the inbox id + message text", kbCalls.length >= 4 && kbCalls.every((c) => c.inboxId === "inbox_lw") && kbCalls[0].query.includes("fluoride"));
  check("system prompt injected the retrieved KB content", capturedSystemPrompt.includes("hydroxyapatite, the mineral your teeth are made of"));
  check("system prompt carries the FTC/FDA guardrails", capturedSystemPrompt.includes("NEVER use drug claims") && capturedSystemPrompt.includes("structure-function"));
  check(
    "dial OFF: nothing sent — every reply stays a draft",
    results.every((r) => r.autoSend && !r.autoSend.attempted && !r.autoSend.sent && r.autoSend.reason.includes("off")) &&
      offGraph.calls.length === 0 &&
      off.messages.every((m) => m.direction === "inbound")
  );

  // 4. Idempotency, threading, echo/self skips.
  section("Dedupe, threading, and skip rules");
  const redelivery = await ingestSocialEvents(parseMetaWebhook(fbCommentPayload), offDeps);
  check("webhook retry is a no-op (platformMessageId dedupe)", redelivery[0].skipped === "duplicate delivery" && off.tickets.length === 4);

  const secondComment: MetaWebhookPayload = JSON.parse(JSON.stringify(fbCommentPayload));
  secondComment.entry![0].changes![0].value!.comment_id = "PAGE_1001_98766";
  secondComment.entry![0].changes![0].value!.message = "Also, does it ship to Canada?";
  const second = await ingestSocialEvents(parseMetaWebhook(secondComment), offDeps);
  check("second comment on the same post threads onto the same ticket", !second[0].created && second[0].ticketId === results[0].ticketId && off.tickets.length === 4);

  const echoPayload: MetaWebhookPayload = JSON.parse(JSON.stringify(igDmPayload));
  echoPayload.entry![0].messaging![0].message!.is_echo = true;
  echoPayload.entry![0].messaging![0].message!.mid = "mid.ig.echo";
  const echoRes = await ingestSocialEvents(parseMetaWebhook(echoPayload), offDeps);
  check("our own echoed DM is skipped", echoRes[0].skipped === "echo of our own message");

  const selfComment: MetaWebhookPayload = JSON.parse(JSON.stringify(fbCommentPayload));
  selfComment.entry![0].changes![0].value!.from = { id: "PAGE_1001", name: "Living Well" };
  selfComment.entry![0].changes![0].value!.comment_id = "PAGE_1001_self";
  const selfRes = await ingestSocialEvents(parseMetaWebhook(selfComment), offDeps);
  check("a comment authored by our own Page is skipped", selfRes[0].skipped === "authored by our own account");

  const unknownAccount: MetaWebhookPayload = JSON.parse(JSON.stringify(fbCommentPayload));
  unknownAccount.entry![0].id = "PAGE_UNKNOWN";
  const unknownRes = await ingestSocialEvents(parseMetaWebhook(unknownAccount), offDeps);
  check("an unmapped Page/IG account is skipped", !!unknownRes[0].skipped?.includes("no inbox mapped"));

  // 4b. Social board routing: with inbox.socialBoard set, tickets land on the
  // dedicated Social board (its columns + its Channel field) while keeping
  // inboxId = the same inbox. With it null (all sections above), they fell
  // back to the primary board.
  section("Social board routing (Inbox.socialBoard)");
  check(
    "socialBoard null: every ticket fell back to the PRIMARY board",
    off.tickets.length > 0 && off.tickets.every((t) => t.boardId === "board_lw" && String(t.columnId).startsWith("col_"))
  );

  const soc = makeStubDb(makeInbox({ socialBoard: makeSocialBoard() }));
  const socDeps: IngestDeps = {
    db: soc.db,
    nextTicketNumber: async () => ++counter,
    draft: draftWith(GOOD_DRAFT),
    graphClient: makeStubGraph().client,
  };
  const socResults = await ingestSocialEvents(
    [...parseMetaWebhook(fbCommentPayload), ...parseMetaWebhook(igCommentPayload), ...parseMetaWebhook(fbDmPayload)],
    socDeps
  );
  check("socialBoard set: all events ingest cleanly", socResults.length === 3 && socResults.every((r) => !r.skipped && r.created));
  check(
    "new social tickets get boardId = the SOCIAL board, not the primary",
    soc.tickets.length === 3 && soc.tickets.every((t) => t.boardId === "board_social")
  );
  check(
    "social tickets use the social board's own columns (New)",
    soc.tickets.every((t) => t.columnId === "col_s_new" && t.status === "new")
  );
  check(
    "social tickets KEEP inboxId = living-well (replies/token/KB unchanged)",
    soc.tickets.every((t) => t.inboxId === "inbox_lw") && socResults.every((r) => r.inboxId === "inbox_lw")
  );
  const socChips = soc.fieldValues as { create?: { fieldId?: string; optionId?: string } }[];
  check(
    "Channel chip uses the social board's field: FB + IG options both populate",
    socChips.length === 3 &&
      socChips.every((c) => c.create?.fieldId === "fld_s_channel") &&
      socChips.filter((c) => c.create?.optionId === "opt_s_fb").length === 2 &&
      socChips.filter((c) => c.create?.optionId === "opt_s_ig").length === 1
  );

  // Threading still works on the social board: a reply on the same FB post
  // reopens the SAME ticket (scoped by inboxId, not boardId).
  const socFollowUp: MetaWebhookPayload = JSON.parse(JSON.stringify(fbCommentPayload));
  socFollowUp.entry![0].changes![0].value!.comment_id = "PAGE_1001_soc_2";
  socFollowUp.entry![0].changes![0].value!.message = "Following up on my question!";
  const socSecond = await ingestSocialEvents(parseMetaWebhook(socFollowUp), socDeps);
  check(
    "threading on the social board: same post = same ticket, no new ticket",
    !socSecond[0].created && socSecond[0].ticketId === socResults[0].ticketId && soc.tickets.length === 3
  );

  // 5. Moderation dial ON — the would-send path (still zero network: stub client).
  section("Moderation dial: high_confidence would-send");
  const on = makeStubDb(makeInbox({ autoSendMode: "high_confidence" }));
  const onGraph = makeStubGraph();
  const onDeps: IngestDeps = {
    db: on.db,
    nextTicketNumber: async () => ++counter,
    draft: draftWith(GOOD_DRAFT),
    graphClient: onGraph.client,
  };
  const onResults = await ingestSocialEvents(
    [...parseMetaWebhook(fbCommentPayload), ...parseMetaWebhook(fbDmPayload), ...parseMetaWebhook(igCommentPayload)],
    onDeps
  );
  check("high-confidence FAQ replies auto-send when the dial is on", onResults.every((r) => r.autoSend?.sent));
  check(
    "FB comment reply hits POST /{comment-id}/comments with message + token",
    onGraph.calls[0]?.url.endsWith("/PAGE_1001_98765/comments") &&
      onGraph.calls[0].body.message === GOOD_DRAFT.reply &&
      onGraph.calls[0].body.access_token === "FAKE_TEST_TOKEN_NOT_REAL"
  );
  check(
    "FB DM send hits POST /me/messages as messaging_type=RESPONSE (never HUMAN_AGENT)",
    onGraph.calls[1]?.url.endsWith("/me/messages") &&
      (onGraph.calls[1].body.recipient as { id: string }).id === "psid_777" &&
      onGraph.calls[1].body.messaging_type === "RESPONSE" &&
      onGraph.calls[1].body.tag === undefined
  );
  check(
    "IG comment reply hits POST /{ig-comment-id}/replies",
    onGraph.calls[2]?.url.endsWith("/igc_31337/replies") && onGraph.calls[2].body.message === GOOD_DRAFT.reply
  );
  check(
    "auto-sends are audited as system-authored outbound Messages",
    on.messages.filter((m) => m.direction === "outbound").length === 3 &&
      on.messages.filter((m) => m.direction === "outbound").every((m) => m.authorId === null && m.provider === "meta")
  );

  // 6. Dial gates: window, confidence, flags, intent.
  section("Moderation dial: gates that BLOCK auto-send");
  const gated = makeStubDb(makeInbox({ autoSendMode: "high_confidence" }));
  const gatedGraph = makeStubGraph();
  const lateNow = new Date(NOW_MS + DM_WINDOW_MS + 60 * 60 * 1000); // 25h later
  const gatedDeps: IngestDeps = {
    db: gated.db,
    nextTicketNumber: async () => ++counter,
    draft: draftWith(GOOD_DRAFT),
    graphClient: gatedGraph.client,
    now: () => lateNow,
  };
  const lateDm = await ingestSocialEvents(parseMetaWebhook(fbDmPayload), gatedDeps);
  check(
    "a DM past the 24h window is NEVER auto-sent (human only)",
    !lateDm[0].autoSend?.sent && !!lateDm[0].autoSend?.reason.includes("24h") && gatedGraph.calls.length === 0
  );

  const lowConf = await ingestSocialEvents(parseMetaWebhook(igCommentPayload), {
    ...gatedDeps,
    now: undefined,
    draft: draftWith({ ...GOOD_DRAFT, confidence: 0.5 }),
  });
  check(
    `confidence below ${AUTO_SEND_CONFIDENCE_THRESHOLD} stays a draft`,
    !lowConf[0].autoSend?.sent && !!lowConf[0].autoSend?.reason.includes("below threshold")
  );

  const offIntent = await ingestSocialEvents(
    parseMetaWebhook(secondComment).map((e) => ({ ...e, platformMessageId: "fresh_1", platformThreadId: "fresh_post" })),
    { ...gatedDeps, now: undefined, draft: draftWith({ ...GOOD_DRAFT, intent: "complaint" }) }
  );
  check(
    "non-FAQ intents (complaint) are not auto-send eligible in high_confidence",
    !offIntent[0].autoSend?.sent && !!offIntent[0].autoSend?.reason.includes("not auto-send eligible")
  );
  check("no Graph calls leaked through any blocked gate", gatedGraph.calls.length === 0);

  // 7. Compliance layer inside the draft step.
  section("Compliance guardrails in the draft step");
  const flagged = await draftSocialReply(
    { platform: "instagram", kind: "comment", fromName: "user", text: "Will this cure my gum disease?", inbox: { id: "inbox_lw", name: "Living Well Support" } },
    { searchKb: stubSearchKb, complete: stubComplete({ respond: true, confidence: 0.9, intent: "health_sensitive", reply: "This powder cures gum disease fast!", flag: "" }) }
  );
  check(
    "a drug-claim draft is flagged server-side and confidence-clamped",
    !!flagged.flagReason?.includes("drug-claim") && flagged.confidence <= 0.3
  );
  const flaggedGate = makeStubDb(makeInbox({ autoSendMode: "all" }));
  const flaggedGraph = makeStubGraph();
  const flaggedRes = await ingestSocialEvents(parseMetaWebhook(igCommentPayload), {
    db: flaggedGate.db,
    nextTicketNumber: async () => ++counter,
    draft: async () => flagged,
    graphClient: flaggedGraph.client,
  });
  check(
    "even with the dial at 'all', a compliance-flagged draft never auto-sends",
    !flaggedRes[0].autoSend?.sent && !!flaggedRes[0].autoSend?.reason.includes("compliance-flagged") && flaggedGraph.calls.length === 0
  );
  const noise = await draftSocialReply(
    { platform: "facebook", kind: "comment", fromName: "u", text: "🔥🔥🔥", inbox: { id: "inbox_lw", name: "LW" } },
    { searchKb: stubSearchKb, complete: stubComplete(GOOD_DRAFT) }
  );
  check("emoji-only comments are pre-filtered (no model call needed)", !noise.respond && noise.reason.includes("pre-filter"));

  // 8. Human send past the window: the HUMAN_AGENT tag.
  section("Human send past the 24h window (HUMAN_AGENT)");
  const humanGraph = makeStubGraph();
  const humanSend = await sendFacebookDm(
    { recipientId: "psid_777", text: "Hi Sarah, following up on your order!", token: "FAKE_TEST_TOKEN_NOT_REAL", humanAgentTag: true },
    humanGraph.client
  );
  check(
    "human send attaches messaging_type=MESSAGE_TAG + tag=HUMAN_AGENT",
    humanSend.ok &&
      humanGraph.calls[0].body.messaging_type === "MESSAGE_TAG" &&
      humanGraph.calls[0].body.tag === "HUMAN_AGENT" &&
      humanGraph.calls[0].url.endsWith("/me/messages")
  );

  // 9. Hide comment (agent action) — /api/tickets/{id}/hide-comment core logic.
  section("Hide comment (agent moderation action)");
  const AGENT = { id: "user_agent_1", name: "Test Agent" };
  function makeHideDb() {
    const comments: AnyRow[] = [];
    const updates: { where: AnyRow; data: AnyRow }[] = [];
    const db: HideDb = {
      comment: {
        async create(args: { data: AnyRow }) {
          comments.push(args.data);
          return args.data;
        },
      },
      ticket: {
        async update(args: { where: AnyRow; data: AnyRow }) {
          updates.push(args);
          return args;
        },
      },
    };
    return { db, comments, updates };
  }
  function makeHideTicket(overrides: Partial<HideTicketRow> = {}): HideTicketRow {
    return {
      id: "tkt_hide_1",
      channel: "facebook_comment",
      status: "open",
      inbox: { metaPageTokenRef: "env:LW_META_PAGE_TOKEN" },
      board: {
        columns: [
          { id: "col_h_new", name: "New", position: 0 },
          { id: "col_h_open", name: "Open", position: 1 },
          { id: "col_h_solved", name: "Solved", position: 2 },
        ],
      },
      messages: [{ direction: "inbound", platformMessageId: "PAGE_1001_98765" }],
      ...overrides,
    };
  }

  // FB comment: POST /{comment-id} with is_hidden=true (never IG's `hide`).
  const fbHide = makeHideDb();
  const fbHideGraph = makeStubGraph();
  const fbHideRes = await hideTicketComment({
    ticket: makeHideTicket(),
    agent: AGENT,
    db: fbHide.db,
    graphClient: fbHideGraph.client,
  });
  check(
    "FB hide hits POST /{comment-id} with is_hidden=true + token",
    fbHideRes.ok &&
      fbHideGraph.calls.length === 1 &&
      fbHideGraph.calls[0].url.endsWith("/PAGE_1001_98765") &&
      fbHideGraph.calls[0].body.is_hidden === true &&
      fbHideGraph.calls[0].body.hide === undefined &&
      fbHideGraph.calls[0].body.access_token === "FAKE_TEST_TOKEN_NOT_REAL"
  );
  check(
    "FB hide records an internal Comment attributed to the agent",
    fbHide.comments.length === 1 &&
      fbHide.comments[0].authorId === AGENT.id &&
      fbHide.comments[0].ticketId === "tkt_hide_1" &&
      fbHide.comments[0].body === "Comment hidden on Facebook by Test Agent."
  );
  check(
    "FB hide moves the ticket to the Solved column + status",
    fbHide.updates.length === 1 &&
      fbHide.updates[0].data.columnId === "col_h_solved" &&
      fbHide.updates[0].data.status === "solved" &&
      fbHideRes.ok &&
      fbHideRes.columnId === "col_h_solved" &&
      fbHideRes.ticketStatus === "solved"
  );

  // IG comment: POST /{ig-comment-id} with hide=true (never FB's `is_hidden`).
  const igHide = makeHideDb();
  const igHideGraph = makeStubGraph();
  const igHideRes = await hideTicketComment({
    ticket: makeHideTicket({
      id: "tkt_hide_2",
      channel: "instagram_comment",
      messages: [{ direction: "inbound", platformMessageId: "igc_31337" }],
    }),
    agent: AGENT,
    db: igHide.db,
    graphClient: igHideGraph.client,
  });
  check(
    "IG hide hits POST /{ig-comment-id} with hide=true (not is_hidden)",
    igHideRes.ok &&
      igHideGraph.calls.length === 1 &&
      igHideGraph.calls[0].url.endsWith("/igc_31337") &&
      igHideGraph.calls[0].body.hide === true &&
      igHideGraph.calls[0].body.is_hidden === undefined
  );
  check(
    "IG hide note names the right platform",
    igHide.comments[0]?.body === "Comment hidden on Instagram by Test Agent."
  );

  // No Solved column → falls back to Closed.
  const closedHide = makeHideDb();
  const closedRes = await hideTicketComment({
    ticket: makeHideTicket({
      board: {
        columns: [
          { id: "col_c_new", name: "New", position: 0 },
          { id: "col_c_closed", name: "Closed", position: 1 },
        ],
      },
    }),
    agent: AGENT,
    db: closedHide.db,
    graphClient: makeStubGraph().client,
  });
  check(
    "without a Solved column the ticket falls back to Closed",
    closedRes.ok && closedRes.columnId === "col_c_closed" && closedRes.ticketStatus === "closed"
  );

  // Non-comment channels are rejected before any Graph call or DB write.
  for (const channel of ["facebook_dm", "instagram_dm", "email"]) {
    const rej = makeHideDb();
    const rejGraph = makeStubGraph();
    const rejRes = await hideTicketComment({
      ticket: makeHideTicket({ channel }),
      agent: AGENT,
      db: rej.db,
      graphClient: rejGraph.client,
    });
    check(
      `channel "${channel}" is REJECTED (400) with no Graph call and no DB write`,
      !rejRes.ok &&
        rejRes.httpStatus === 400 &&
        rejGraph.calls.length === 0 &&
        rej.comments.length === 0 &&
        rej.updates.length === 0
    );
  }

  // A Graph failure surfaces as a 502 and leaves the ticket untouched.
  const failHide = makeHideDb();
  const failClient: GraphHttpClient = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "Unsupported post request." } }),
  });
  const failRes = await hideTicketComment({
    ticket: makeHideTicket(),
    agent: AGENT,
    db: failHide.db,
    graphClient: failClient,
  });
  check(
    "a Graph error returns 502 and writes neither note nor status change",
    !failRes.ok &&
      failRes.httpStatus === 502 &&
      failRes.error === "Unsupported post request." &&
      failHide.comments.length === 0 &&
      failHide.updates.length === 0
  );

  // ---- Summary --------------------------------------------------------------------
  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log(`ALL ${passed} CHECKS PASSED — zero DB access, zero network calls.`);
  } else {
    console.log(`${failures.length} FAILED (${passed} passed):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
