// Two mail paths live here:
// 1. sendCustomerEmail() — customer-facing ticket replies via Postmark, sent
//    from the ticket's Inbox identity with RFC threading headers.
// 2. sendEmail() + helpers — INTERNAL notifications to agents (assignments,
//    notes, invites, password resets) via Resend. When RESEND_API_KEY is not
//    set (local dev), these log to the server console instead.

type Mail = { to: string; subject: string; html: string };

export type CustomerMail = {
  from: string; // "Living Well Support <support@…>"
  to: string;
  replyTo?: string; // where replies should go (bare support@ address)
  subject: string;
  textBody: string;
  htmlBody?: string;
  messageId?: string; // our own Message-ID (no angle brackets); Postmark preserves it
  inReplyTo?: string | null; // RFC Message-ID (no angle brackets)
  references?: string[]; // RFC Message-IDs, oldest first (no angle brackets)
};

export type CustomerSendResult =
  | { ok: true; messageIdHeader: string; providerMessageId: string }
  | { ok: false; error: string };

// Postmark generates the outbound RFC Message-ID as <uuid@mtasv.net> where
// uuid is the MessageID it returns — we store that so the customer's next
// reply matches back to the ticket via In-Reply-To/References.
export async function sendCustomerEmail(mail: CustomerMail): Promise<CustomerSendResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return { ok: false, error: "POSTMARK_SERVER_TOKEN is not configured." };

  const headers: { Name: string; Value: string }[] = [];
  if (mail.messageId) headers.push({ Name: "Message-ID", Value: `<${mail.messageId}>` });
  if (mail.inReplyTo) headers.push({ Name: "In-Reply-To", Value: `<${mail.inReplyTo}>` });
  if (mail.references?.length) {
    headers.push({ Name: "References", Value: mail.references.map((r) => `<${r}>`).join(" ") });
  }

  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: mail.from,
        To: mail.to,
        ...(mail.replyTo ? { ReplyTo: mail.replyTo } : {}),
        Subject: mail.subject,
        TextBody: mail.textBody,
        ...(mail.htmlBody ? { HtmlBody: mail.htmlBody } : {}),
        ...(headers.length ? { Headers: headers } : {}),
        MessageStream: "outbound",
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ErrorCode) {
      // 412 = account pending approval and recipient off-domain — say so plainly.
      const hint =
        data.ErrorCode === 412
          ? " (Postmark account is in Test mode — click Request approval, or send only to your own domain until approved.)"
          : "";
      return { ok: false, error: `${data.Message ?? `Postmark error ${res.status}`}${hint}` };
    }
    return {
      ok: true,
      // If we set our own Message-ID, that's the header on the wire; else
      // Postmark stamps <MessageID@mtasv.net>.
      messageIdHeader: mail.messageId ?? `${data.MessageID}@mtasv.net`,
      providerMessageId: data.MessageID,
    };
  } catch (err) {
    return { ok: false, error: `Postmark request failed: ${String(err)}` };
  }
}

// Internal agent notifications: Postmark (verified domain) when configured,
// Resend as fallback, console in bare local dev.
export async function sendEmail({ to, subject, html }: Mail) {
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM ?? "Living Well Desk <support@livingwellwithdrmichelle.com>";

  if (postmarkToken) {
    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": postmarkToken,
        },
        body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html, MessageStream: "outbound" }),
      });
      if (!res.ok) {
        console.error(`[mail] Postmark error ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error("[mail] send failed", err);
    }
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${html}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`[mail] Resend error ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("[mail] send failed", err);
  }
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

function layout(body: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1e1f21">
    ${body}
    <p style="color:#9ca3af;font-size:12px;margin-top:32px">Sent by Living Well Desk</p>
  </div>`;
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:#6E9277;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600">${label}</a>`;
}

export function sendInviteEmail(opts: {
  to: string;
  inviterName: string;
  boardName: string | null;
  token: string;
}) {
  const link = `${appUrl()}/register?token=${opts.token}`;
  const where = opts.boardName ? `the inbox <b>${opts.boardName}</b>` : "the team's Living Well Desk";
  return sendEmail({
    to: opts.to,
    subject: `${opts.inviterName} invited you to ${opts.boardName ?? "Living Well Desk"}`,
    html: layout(
      `<h2>You're invited</h2>
       <p><b>${opts.inviterName}</b> invited you to join ${where}.</p>
       <p>${button(link, "Accept invite")}</p>
       <p style="font-size:13px;color:#6b7280">Or open this link: ${link}</p>`
    ),
  });
}

export function sendAssignedEmail(opts: {
  to: string;
  assignerName: string;
  ticketSubject: string;
  boardName: string;
  boardId: string;
  ticketId: string;
}) {
  const link = `${appUrl()}/boards/${opts.boardId}?ticket=${opts.ticketId}`;
  return sendEmail({
    to: opts.to,
    subject: `${opts.assignerName} assigned you: ${opts.ticketSubject}`,
    html: layout(
      `<h2>Ticket assigned to you</h2>
       <p><b>${opts.assignerName}</b> assigned you a ticket on <b>${opts.boardName}</b>:</p>
       <p style="font-size:16px;font-weight:600">${opts.ticketSubject}</p>
       <p>${button(link, "Open ticket")}</p>`
    ),
  });
}

export function sendNoteEmail(opts: {
  to: string;
  authorName: string;
  ticketSubject: string;
  boardName: string;
  boardId: string;
  ticketId: string;
  body: string;
}) {
  const link = `${appUrl()}/boards/${opts.boardId}?ticket=${opts.ticketId}`;
  return sendEmail({
    to: opts.to,
    subject: `${opts.authorName} added an internal note on: ${opts.ticketSubject}`,
    html: layout(
      `<h2>New internal note</h2>
       <p><b>${opts.authorName}</b> added an internal note on <b>${opts.ticketSubject}</b> (${opts.boardName}):</p>
       <blockquote style="border-left:3px solid #e5e7eb;margin:12px 0;padding:4px 12px;color:#4b5563">${opts.body}</blockquote>
       <p>${button(link, "Open ticket")}</p>`
    ),
  });
}

export function sendMentionEmail(opts: {
  to: string;
  mentionerName: string;
  ticketSubject: string;
  boardName: string;
  boardId: string;
  ticketId: string;
  body: string;
}) {
  const link = `${appUrl()}/boards/${opts.boardId}?ticket=${opts.ticketId}`;
  return sendEmail({
    to: opts.to,
    subject: `${opts.mentionerName} mentioned you on: ${opts.ticketSubject}`,
    html: layout(
      `<h2>You were mentioned</h2>
       <p><b>${opts.mentionerName}</b> mentioned you in an internal note on <b>${opts.ticketSubject}</b> (${opts.boardName}):</p>
       <blockquote style="border-left:3px solid #e5e7eb;margin:12px 0;padding:4px 12px;color:#4b5563">${opts.body}</blockquote>
       <p>${button(link, "Open ticket")}</p>`
    ),
  });
}

export function sendPasswordResetEmail(opts: { to: string; token: string }) {
  const link = `${appUrl()}/reset?token=${opts.token}`;
  return sendEmail({
    to: opts.to,
    subject: "Reset your Living Well Desk password",
    html: layout(
      `<h2>Password reset</h2>
       <p>Click the button below to choose a new password. This link works once and expires in 1 hour.</p>
       <p>${button(link, "Reset password")}</p>
       <p style="font-size:13px;color:#6b7280">If you didn't request this, you can ignore this email.</p>`
    ),
  });
}
