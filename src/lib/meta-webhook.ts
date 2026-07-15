// Meta webhook plumbing — PURE functions (no DB, no network) so the mock
// harness can exercise them directly. The Next route at /api/webhooks/meta is
// a thin wrapper around these.
//
// Spec §5: GET handles the hub.challenge verification handshake with
// META_WEBHOOK_VERIFY_TOKEN; POST payloads are authenticated by
// X-Hub-Signature-256 (HMAC-SHA256 of the RAW body with the app secret).

import { createHmac, timingSafeEqual } from "crypto";

// ---- Verification --------------------------------------------------------------

/** GET handshake: returns the challenge string to echo back, or null to 403. */
export function verifyChallenge(
  params: URLSearchParams,
  verifyToken: string | undefined
): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}

/** POST auth: constant-time check of X-Hub-Signature-256 against the raw body. */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Payload parsing ------------------------------------------------------------
// Normalizes the four webhook shapes we ingest (spec §5) into one event type:
//   FB Page  `feed`     → value.item="comment", value.verb="add"
//   FB Page  `messages` → entry.messaging[] (Messenger)
//   IG       `comments` → entry.changes[].field="comments"
//   IG       `messages` → entry.messaging[] (object="instagram")

export type SocialEvent = {
  platform: "facebook" | "instagram";
  kind: "comment" | "dm";
  /** Page id (FB) or IG account id — matches Inbox.metaPageId / metaIgId. */
  accountId: string;
  /** Comment id or message mid — Message.platformMessageId (dedupe). */
  platformMessageId: string;
  /** Post id / media id (comments) or sender id (DMs) — thread key. */
  platformThreadId: string;
  /** Platform user id of the author (PSID/IGSID/scoped user id). */
  fromId: string;
  fromName: string | null;
  text: string;
  /** Present on comments: the comment id to reply to / hide. */
  commentId?: string;
  /** Present on comments: the parent post/media id. */
  postId?: string;
  /** True for message echoes (our own outbound reflected back) — skip. */
  isEcho: boolean;
  timestamp: Date;
};

type FeedChangeValue = {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  from?: { id?: string; name?: string; username?: string };
  message?: string;
  text?: string;
  created_time?: number;
  // IG comments payload
  id?: string;
  media?: { id?: string };
};

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

type WebhookEntry = {
  id?: string;
  time?: number;
  changes?: { field?: string; value?: FeedChangeValue }[];
  messaging?: MessagingEvent[];
};

export type MetaWebhookPayload = {
  object?: string; // "page" | "instagram"
  entry?: WebhookEntry[];
};

function toDate(secondsOrMs: number | undefined): Date {
  if (!secondsOrMs) return new Date();
  // Meta sends seconds on feed changes, milliseconds on messaging events.
  return new Date(secondsOrMs > 1e12 ? secondsOrMs : secondsOrMs * 1000);
}

/** Flatten a webhook payload into normalized events. Unknown/irrelevant items
 *  (likes, edits, deletes, attachments-only messages) are silently dropped. */
export function parseMetaWebhook(payload: MetaWebhookPayload): SocialEvent[] {
  const events: SocialEvent[] = [];
  const object = payload.object;
  if (object !== "page" && object !== "instagram") return events;
  const platform = object === "page" ? "facebook" : "instagram";

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id ?? "";
    if (!accountId) continue;

    // Comments: FB Page `feed` field / IG `comments` field.
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      if (platform === "facebook") {
        if (change.field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
        if (!v.comment_id || !v.from?.id) continue;
        events.push({
          platform,
          kind: "comment",
          accountId,
          platformMessageId: v.comment_id,
          platformThreadId: v.post_id ?? v.comment_id,
          fromId: v.from.id,
          fromName: v.from.name ?? null,
          text: v.message ?? "",
          commentId: v.comment_id,
          postId: v.post_id,
          isEcho: false,
          timestamp: toDate(v.created_time ?? entry.time),
        });
      } else {
        if (change.field !== "comments") continue;
        const commentId = v.id ?? v.comment_id;
        if (!commentId || !v.from?.id) continue;
        events.push({
          platform,
          kind: "comment",
          accountId,
          platformMessageId: commentId,
          platformThreadId: v.media?.id ?? commentId,
          fromId: v.from.id,
          fromName: v.from.username ?? v.from.name ?? null,
          text: v.text ?? v.message ?? "",
          commentId,
          postId: v.media?.id,
          isEcho: false,
          timestamp: toDate(entry.time),
        });
      }
    }

    // DMs: entry.messaging[] on both platforms.
    for (const m of entry.messaging ?? []) {
      if (!m.message?.mid || !m.sender?.id) continue;
      if (typeof m.message.text !== "string" || !m.message.text.trim()) continue;
      events.push({
        platform,
        kind: "dm",
        accountId,
        platformMessageId: m.message.mid,
        platformThreadId: `${platform}-dm-${m.message.is_echo ? m.recipient?.id : m.sender.id}`,
        fromId: m.sender.id,
        fromName: null, // DM webhooks carry no profile name; a Graph lookup is a Phase 1b nicety
        text: m.message.text,
        isEcho: !!m.message.is_echo,
        timestamp: toDate(m.timestamp),
      });
    }
  }
  return events;
}
