// INTERNAL notifications to agents (assignments, notes, invites, password
// resets) via Resend's HTTP API. When RESEND_API_KEY is not set (local dev),
// emails are logged to the server console instead of sent.
//
// NOTE: customer-facing email (ticket replies) does NOT go through this file's
// notification helpers. Phase B/C extends sendEmail() with provider abstraction
// (Postmark), custom headers, replyTo and attachments for the customer channel.

type Mail = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: Mail) {
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
        from: process.env.EMAIL_FROM ?? "TC Desk <onboarding@resend.dev>",
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
    <p style="color:#9ca3af;font-size:12px;margin-top:32px">Sent by TC Desk</p>
  </div>`;
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600">${label}</a>`;
}

export function sendInviteEmail(opts: {
  to: string;
  inviterName: string;
  boardName: string | null;
  token: string;
}) {
  const link = `${appUrl()}/register?token=${opts.token}`;
  const where = opts.boardName ? `the inbox <b>${opts.boardName}</b>` : "the team's TC Desk";
  return sendEmail({
    to: opts.to,
    subject: `${opts.inviterName} invited you to ${opts.boardName ?? "TC Desk"}`,
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
    subject: "Reset your TC Desk password",
    html: layout(
      `<h2>Password reset</h2>
       <p>Click the button below to choose a new password. This link works once and expires in 1 hour.</p>
       <p>${button(link, "Reset password")}</p>
       <p style="font-size:13px;color:#6b7280">If you didn't request this, you can ignore this email.</p>`
    ),
  });
}
