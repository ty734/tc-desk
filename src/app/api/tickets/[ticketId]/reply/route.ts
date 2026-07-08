import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { sendCustomerEmail } from "@/lib/mailer";

// Sends a CUSTOMER-VISIBLE email reply on a ticket (spec §5) and records it as
// a Message. Internal notes are a different route (/notes) and never email
// the customer.
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

  const { bodyText } = await req.json();
  if (!bodyText?.trim()) return NextResponse.json({ error: "Reply cannot be empty." }, { status: 400 });

  // Where the reply goes: Amazon buyers only reachable via their relay address.
  const isAmazon = ticket.channel === "amazon";
  const to = isAmazon ? ticket.amazonRelayAddr : ticket.customerEmail;
  if (!to) {
    return NextResponse.json(
      { error: isAmazon ? "No Amazon relay address on this ticket." : "No customer email on this ticket." },
      { status: 400 }
    );
  }

  // Threading: reply to the last inbound message; References = the whole chain.
  const lastInbound = [...ticket.messages].reverse().find((m) => m.direction === "inbound");
  const chain = ticket.messages
    .map((m) => m.messageIdHeader)
    .filter((id): id is string => !!id);

  // Tokenized Reply-To (email channel only): hash+replyToken@inbound domain —
  // the customer's reply routes straight back to this ticket via MailboxHash.
  let replyTo: string | undefined;
  if (!isAmazon && ticket.inbox.inboundAddress) {
    const [local, domain] = ticket.inbox.inboundAddress.split("@");
    if (local && domain) replyTo = `${local}+${ticket.replyToken}@${domain}`;
  }

  const subject = /^re:/i.test(ticket.subject) ? ticket.subject : `Re: ${ticket.subject}`;
  const text = bodyText.trim();
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#1e1f21;white-space:pre-wrap">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</div>`;

  const sent = await sendCustomerEmail({
    from: `${ticket.inbox.fromName} <${ticket.inbox.supportEmail}>`,
    to,
    replyTo,
    subject,
    textBody: text,
    htmlBody: html,
    inReplyTo: lastInbound?.messageIdHeader ?? null,
    references: chain,
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });

  const message = await db.message.create({
    data: {
      ticketId,
      direction: "outbound",
      authorId: user.id,
      fromAddr: ticket.inbox.supportEmail,
      toAddr: to,
      subject,
      bodyText: text,
      bodyHtml: html,
      messageIdHeader: sent.messageIdHeader,
      inReplyTo: lastInbound?.messageIdHeader ?? null,
      references: chain.map((r) => `<${r}>`).join(" ") || null,
      provider: "postmark",
      providerMessageId: sent.providerMessageId,
    },
    include: { author: { select: { id: true, name: true } }, attachments: true },
  });

  // Replied → Pending (waiting on the customer).
  const pendingCol = ticket.board.columns.find((c) => c.name.trim().toLowerCase() === "pending");
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      lastMessageAt: new Date(),
      ...(pendingCol ? { columnId: pendingCol.id, status: "pending" } : {}),
    },
  });

  return NextResponse.json({ message, status: pendingCol ? "pending" : ticket.status });
}
