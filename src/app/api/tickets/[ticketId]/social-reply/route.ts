import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import {
  replyToFacebookComment,
  replyToInstagramComment,
  sendFacebookDm,
  sendInstagramDm,
  resolveMetaToken,
} from "@/lib/meta-social";
import { HUMAN_AGENT_WINDOW_MS } from "@/lib/meta-ingest";

// Sends a HUMAN-approved reply on a social ticket (spec §3 "human action") and
// records it as an outbound Message — the social mirror of /reply (email).
//
// Comments: posts a public reply under the customer's comment.
// DMs: sends within the 24h window normally; PAST the window this human send
// attaches messaging_type=MESSAGE_TAG + tag=HUMAN_AGENT (allowed for humans
// only, up to 7 days — spec §5). Beyond 7 days Meta offers no compliant path.

const SOCIAL_CHANNELS = ["facebook_comment", "facebook_dm", "instagram_comment", "instagram_dm"];

export async function POST(req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      inbox: true,
      board: { include: { columns: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }
  if (!SOCIAL_CHANNELS.includes(ticket.channel)) {
    return NextResponse.json({ error: "Not a social ticket — use the email reply." }, { status: 400 });
  }

  const { bodyText } = await req.json();
  if (!bodyText?.trim()) return NextResponse.json({ error: "Reply cannot be empty." }, { status: 400 });
  const text = bodyText.trim();

  const platform = ticket.channel.startsWith("facebook") ? "facebook" : "instagram";
  const isDm = ticket.channel.endsWith("_dm");

  const token = resolveMetaToken(ticket.inbox.metaPageTokenRef);
  if (!token) {
    return NextResponse.json(
      { error: "No Meta access token is configured for this inbox yet." },
      { status: 400 }
    );
  }

  // The latest inbound platform message anchors the reply target and the window.
  const lastInbound = [...ticket.messages]
    .reverse()
    .find((m) => m.direction === "inbound" && m.platformMessageId);
  if (!lastInbound?.platformMessageId) {
    return NextResponse.json({ error: "No platform message to reply to on this ticket." }, { status: 400 });
  }

  let sent;
  let humanAgentTag = false;
  if (isDm) {
    const now = Date.now();
    const inboundAt = lastInbound.createdAt.getTime();
    if (now > inboundAt + HUMAN_AGENT_WINDOW_MS) {
      return NextResponse.json(
        { error: "This conversation is past the 7-day HUMAN_AGENT window — Meta does not allow a reply. Ask the customer to message again, or reach them by email." },
        { status: 400 }
      );
    }
    humanAgentTag = !!lastInbound.windowExpiresAt && now > lastInbound.windowExpiresAt.getTime();
    // fromAddr is "facebook:<PSID>" / "instagram:<IGSID>".
    const recipientId = lastInbound.fromAddr.replace(/^(facebook|instagram):/, "");
    const opts = { recipientId, text, token, humanAgentTag };
    sent = platform === "facebook" ? await sendFacebookDm(opts) : await sendInstagramDm(opts);
  } else {
    const opts = { commentId: lastInbound.platformMessageId, message: text, token };
    sent =
      platform === "facebook"
        ? await replyToFacebookComment(opts)
        : await replyToInstagramComment(opts);
  }
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });

  const message = await db.message.create({
    data: {
      ticketId,
      direction: "outbound",
      authorId: user.id,
      fromAddr: `${platform}:${ticket.inbox.metaPageId ?? ticket.inbox.metaIgId ?? "page"}`,
      toAddr: lastInbound.fromAddr,
      subject: null,
      bodyText: text,
      provider: "meta",
      providerMessageId: sent.id,
      platformMessageId: sent.id,
      platformThreadId: lastInbound.platformThreadId,
    },
    include: { author: { select: { id: true, name: true } }, attachments: true },
  });

  // Replied → Pending (waiting on the customer) — same as the email flow.
  const pendingCol = ticket.board.columns.find((c) => c.name.trim().toLowerCase() === "pending");
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      lastMessageAt: new Date(),
      ...(pendingCol ? { columnId: pendingCol.id, status: "pending" } : {}),
    },
  });

  return NextResponse.json({
    message,
    humanAgentTag,
    status: pendingCol ? "pending" : ticket.status,
  });
}
