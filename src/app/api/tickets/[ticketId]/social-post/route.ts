import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { fetchFacebookPost, fetchInstagramMedia, resolveMetaToken } from "@/lib/meta-social";

// Resolves the parent post/video a social COMMENT ticket is replying to, so the
// agent can see and open what the customer commented on (the "what are they
// responding to?" gap). Read-only: one Graph GET, no state change.
//
// Only meaningful for comment channels — DMs have no parent post, and email/
// chat/amazon tickets have none either. Any failure (no token, deleted post,
// Graph error) returns 200 with { context: null } so the UI degrades quietly
// rather than throwing in the agent's face.

const COMMENT_CHANNELS = ["facebook_comment", "instagram_comment"];

export async function GET(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { inbox: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }
  if (!COMMENT_CHANNELS.includes(ticket.channel)) {
    return NextResponse.json({ context: null });
  }

  // The parent post/media id rides on every inbound comment as platformThreadId.
  const postId = [...ticket.messages]
    .reverse()
    .find((m) => m.direction === "inbound" && m.platformThreadId)?.platformThreadId;
  if (!postId) return NextResponse.json({ context: null });

  const token = resolveMetaToken(ticket.inbox.metaPageTokenRef);
  if (!token) return NextResponse.json({ context: null, reason: "no-token" });

  const platform = ticket.channel.startsWith("facebook") ? "facebook" : "instagram";
  const result =
    platform === "facebook"
      ? await fetchFacebookPost({ postId, token })
      : await fetchInstagramMedia({ mediaId: postId, token });

  if (!result.ok) return NextResponse.json({ context: null, reason: result.error });
  return NextResponse.json({ context: result.context, platform });
}
