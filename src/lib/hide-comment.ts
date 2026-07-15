// Hide a nasty/negative FB/IG comment on the platform instead of replying —
// the "moderate" half of the agent's social toolkit (reply lives in
// /api/tickets/{id}/social-reply). The comment stays visible to its author
// and their friends but is hidden from everyone else; it can be unhidden
// from the platform's native tools.
//
// Same injectable-deps pattern as meta-ingest: Prisma and the Graph client
// are passed in, so scripts/mock-social-harness.ts exercises this end to end
// with zero DB writes and zero network. The route wires the real ones.

import {
  hideFacebookComment,
  hideInstagramComment,
  resolveMetaToken,
  type GraphHttpClient,
} from "@/lib/meta-social";

/** Only platform comments can be hidden — a DM or an email has nothing to hide. */
export const HIDEABLE_CHANNELS = ["facebook_comment", "instagram_comment"] as const;

// Structural subset of the Prisma ticket the route loads (include: inbox,
// board.columns, messages). Extra properties are fine.
export type HideTicketRow = {
  id: string;
  channel: string;
  status: string;
  inbox: { metaPageTokenRef: string | null };
  board: { columns: { id: string; name: string; position: number }[] };
  messages: { direction: string; platformMessageId: string | null }[];
};

/* eslint-disable @typescript-eslint/no-explicit-any -- structural bridge to PrismaClient */
export type HideDb = {
  comment: { create(args: any): Promise<unknown> };
  ticket: { update(args: any): Promise<unknown> };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type HideResult =
  | { ok: true; platformLabel: string; ticketStatus: string; columnId: string | null }
  | { ok: false; error: string; httpStatus: number };

export async function hideTicketComment(opts: {
  ticket: HideTicketRow;
  agent: { id: string; name: string };
  db: HideDb;
  /** Stubbed in the harness; production omits it and gets fetch. */
  graphClient?: GraphHttpClient;
}): Promise<HideResult> {
  const { ticket, agent, db } = opts;

  if (!(HIDEABLE_CHANNELS as readonly string[]).includes(ticket.channel)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Only Facebook and Instagram comment tickets can be hidden — DMs and emails have no public comment to hide.",
    };
  }
  const platform = ticket.channel.startsWith("facebook") ? "facebook" : "instagram";
  const platformLabel = platform === "facebook" ? "Facebook" : "Instagram";

  const token = resolveMetaToken(ticket.inbox.metaPageTokenRef);
  if (!token) {
    return {
      ok: false,
      httpStatus: 400,
      error: "No Meta access token is configured for this inbox yet.",
    };
  }

  // The latest inbound platform message is the comment to hide — the same
  // anchor the social-reply route replies under.
  const lastInbound = [...ticket.messages]
    .reverse()
    .find((m) => m.direction === "inbound" && m.platformMessageId);
  if (!lastInbound?.platformMessageId) {
    return { ok: false, httpStatus: 400, error: "No platform comment to hide on this ticket." };
  }

  // FB: POST /{comment-id} is_hidden=true. IG: POST /{ig-comment-id} hide=true.
  // Meta treats re-hiding an already-hidden comment as a success, so this is
  // idempotent-ish by nature — a hard error here is a real failure.
  const hideOpts = { commentId: lastInbound.platformMessageId, token };
  const hidden =
    platform === "facebook"
      ? await hideFacebookComment(hideOpts, opts.graphClient)
      : await hideInstagramComment(hideOpts, opts.graphClient);
  if (!hidden.ok) {
    return { ok: false, httpStatus: 502, error: hidden.error };
  }

  // Audit trail: an INTERNAL note (Comment, never a customer Message) so the
  // team sees who hid it and why the ticket closed without a reply.
  await db.comment.create({
    data: {
      ticketId: ticket.id,
      authorId: agent.id,
      body: `Comment hidden on ${platformLabel} by ${agent.name}.`,
    },
  });

  // Hidden = handled: move the ticket to the board's resolved column.
  // Prefer Solved, fall back to Closed; on a board with neither, leave the
  // ticket where it is (the hide + note still stand).
  const columns = [...ticket.board.columns].sort((a, b) => a.position - b.position);
  const colByStatus = (s: string) => columns.find((c) => c.name.trim().toLowerCase() === s);
  const doneCol = colByStatus("solved") ?? colByStatus("closed");
  const ticketStatus = doneCol ? doneCol.name.trim().toLowerCase() : ticket.status;
  if (doneCol) {
    await db.ticket.update({
      where: { id: ticket.id },
      data: { columnId: doneCol.id, status: ticketStatus },
    });
  }

  return { ok: true, platformLabel, ticketStatus, columnId: doneCol?.id ?? null };
}
