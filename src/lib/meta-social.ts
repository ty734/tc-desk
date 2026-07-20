// Meta (Facebook Page + Instagram) Graph API connector — the OUTBOUND half of
// the social engagement layer (spec §5). Reply to comments, hide comments, and
// send DMs for both platforms.
//
// Written against the Graph API spec with an injectable HTTP client so the
// whole module can be exercised by scripts/mock-social-harness.ts with zero
// network calls. No live call has been made through this module yet — the real
// round trip is the supervised Phase 1b token test.
//
// Tokens are env-refs on the Inbox (metaPageTokenRef = "env:VAR"), resolved
// here the same way shopify.ts resolves shopifyToken. Raw tokens never live in
// the database or in code.

const GRAPH_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// IG DM automation guidance: stay under ~200 messages/hour/account (spec §5).
// The throttle exists now, even though auto-send launches gated off.
const SEND_LIMIT_PER_HOUR = 180;

export type GraphResult =
  | { ok: true; id: string | null; raw: unknown }
  | { ok: false; error: string; status?: number };

/** Injectable HTTP layer — the mock harness stubs this; production uses fetch. */
export type GraphHttpClient = (
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const fetchClient: GraphHttpClient = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(15000) });

/** Resolve an Inbox.metaPageTokenRef ("env:VAR") to the actual token. */
export function resolveMetaToken(ref: string | null | undefined): string | null {
  if (!ref || ref === "PENDING") return null;
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] ?? null;
  return ref; // raw token stored directly (discouraged, but supported)
}

// ---- In-memory send throttle (per token, sliding hour) -----------------------
// Good enough for a single serverless instance; a durable queue is the Phase 2
// (auto-send in anger) upgrade. Human-clicked sends also pass through it, which
// is fine — a human never hits 180/hr.
const sendLog = new Map<string, number[]>();

export function throttleCheck(tokenKey: string, now = Date.now()): boolean {
  const hourAgo = now - 60 * 60 * 1000;
  const recent = (sendLog.get(tokenKey) ?? []).filter((t) => t > hourAgo);
  sendLog.set(tokenKey, recent);
  return recent.length < SEND_LIMIT_PER_HOUR;
}

function throttleRecord(tokenKey: string, now = Date.now()) {
  const arr = sendLog.get(tokenKey) ?? [];
  arr.push(now);
  sendLog.set(tokenKey, arr);
}

// ---- Core request helper ------------------------------------------------------

async function graphPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
  client: GraphHttpClient
): Promise<GraphResult> {
  try {
    const res = await client(`${GRAPH_BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, access_token: token }),
    });
    const data = (await res.json().catch(() => null)) as
      | { id?: string; message_id?: string; success?: boolean; error?: { message?: string } }
      | null;
    if (!res.ok || data?.error) {
      return {
        ok: false,
        status: res.status,
        error: data?.error?.message ?? `Graph API error ${res.status}`,
      };
    }
    return { ok: true, id: data?.id ?? data?.message_id ?? null, raw: data };
  } catch (err) {
    return { ok: false, error: `Graph request failed: ${String(err)}` };
  }
}

// ---- Read: parent post/media context (the "what are they replying to?" card) ---
// A social comment ticket stores the parent post/media id as Message.platform-
// ThreadId, but that id alone is opaque to an agent. These helpers resolve it to
// a human-usable preview — permalink + caption + thumbnail — via a single Graph
// GET, so the ticket can show which post/video the comment sits under.

export type PostContext = {
  permalink: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
};
export type PostContextResult =
  | { ok: true; context: PostContext }
  | { ok: false; error: string; status?: number };

async function graphGet(
  path: string,
  token: string,
  fields: string,
  client: GraphHttpClient
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const url = `${GRAPH_BASE}/${path}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await client(url, { method: "GET" });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok && !(data && "error" in data), status: res.status, data };
}

/** Resolve a Facebook post id ("{pageId}_{postId}") to its permalink, message,
 *  and preview image: GET /{post-id}?fields=permalink_url,message,full_picture. */
export async function fetchFacebookPost(
  opts: { postId: string; token: string },
  client: GraphHttpClient = fetchClient
): Promise<PostContextResult> {
  try {
    const { ok, status, data } = await graphGet(
      opts.postId,
      opts.token,
      "permalink_url,message,full_picture",
      client
    );
    if (!ok || !data) {
      const err = (data?.error as { message?: string } | undefined)?.message;
      return { ok: false, status, error: err ?? `Graph API error ${status}` };
    }
    return {
      ok: true,
      context: {
        permalink: (data.permalink_url as string) ?? null,
        caption: (data.message as string) ?? null,
        thumbnailUrl: (data.full_picture as string) ?? null,
        mediaType: null,
      },
    };
  } catch (err) {
    return { ok: false, error: `Graph request failed: ${String(err)}` };
  }
}

/** Resolve an Instagram media id to its permalink, caption, and thumbnail:
 *  GET /{media-id}?fields=permalink,caption,media_type,media_url,thumbnail_url.
 *  Video media expose thumbnail_url; images use media_url. */
export async function fetchInstagramMedia(
  opts: { mediaId: string; token: string },
  client: GraphHttpClient = fetchClient
): Promise<PostContextResult> {
  try {
    const { ok, status, data } = await graphGet(
      opts.mediaId,
      opts.token,
      "permalink,caption,media_type,media_url,thumbnail_url",
      client
    );
    if (!ok || !data) {
      const err = (data?.error as { message?: string } | undefined)?.message;
      return { ok: false, status, error: err ?? `Graph API error ${status}` };
    }
    return {
      ok: true,
      context: {
        permalink: (data.permalink as string) ?? null,
        caption: (data.caption as string) ?? null,
        thumbnailUrl: (data.thumbnail_url as string) ?? (data.media_url as string) ?? null,
        mediaType: (data.media_type as string) ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: `Graph request failed: ${String(err)}` };
  }
}

// ---- Facebook: comments ---------------------------------------------------------

/** Reply to a Facebook Page comment: POST /{comment-id}/comments (spec §5). */
export function replyToFacebookComment(
  opts: { commentId: string; message: string; token: string },
  client: GraphHttpClient = fetchClient
): Promise<GraphResult> {
  return graphPost(`${opts.commentId}/comments`, opts.token, { message: opts.message }, client);
}

/** Hide (or unhide) a Facebook comment: POST /{comment-id} is_hidden=true. */
export function hideFacebookComment(
  opts: { commentId: string; hidden?: boolean; token: string },
  client: GraphHttpClient = fetchClient
): Promise<GraphResult> {
  return graphPost(opts.commentId, opts.token, { is_hidden: opts.hidden ?? true }, client);
}

// ---- Instagram: comments --------------------------------------------------------

/** Reply to an IG comment as a threaded reply: POST /{ig-comment-id}/replies.
 *  (The spec's GET path reads comments off the media; replying UNDER the
 *  user's comment uses the comment's /replies edge.) */
export function replyToInstagramComment(
  opts: { commentId: string; message: string; token: string },
  client: GraphHttpClient = fetchClient
): Promise<GraphResult> {
  return graphPost(`${opts.commentId}/replies`, opts.token, { message: opts.message }, client);
}

/** Hide (or unhide) an IG comment: POST /{ig-comment-id} hide=true (spec §5). */
export function hideInstagramComment(
  opts: { commentId: string; hidden?: boolean; token: string },
  client: GraphHttpClient = fetchClient
): Promise<GraphResult> {
  return graphPost(opts.commentId, opts.token, { hide: opts.hidden ?? true }, client);
}

// ---- DMs (FB Messenger + IG messaging, both via the Page: POST /me/messages) ----

export type DmSendOpts = {
  /** PSID (Facebook) or IGSID (Instagram) of the recipient. */
  recipientId: string;
  text: string;
  token: string;
  /** True when a HUMAN composed and clicked send AND the 24h window has
   *  passed — attaches messaging_type=MESSAGE_TAG + tag=HUMAN_AGENT (extends
   *  the reply window to 7 days; bots are prohibited under it, so the
   *  auto-send path must NEVER set this). */
  humanAgentTag?: boolean;
};

function dmBody(opts: DmSendOpts): Record<string, unknown> {
  return {
    recipient: { id: opts.recipientId },
    message: { text: opts.text },
    ...(opts.humanAgentTag
      ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
      : { messaging_type: "RESPONSE" }),
  };
}

/** Send a Facebook Messenger DM: POST /me/messages with the Page token. */
export function sendFacebookDm(
  opts: DmSendOpts,
  client: GraphHttpClient = fetchClient
): Promise<GraphResult> {
  if (!throttleCheck(opts.token)) {
    return Promise.resolve({ ok: false, error: "Send throttled: hourly DM limit reached." });
  }
  throttleRecord(opts.token);
  return graphPost("me/messages", opts.token, dmBody(opts), client);
}

/** Send an Instagram DM. On the "IG with Facebook Login" path the linked
 *  Page's /me/messages endpoint delivers to the IGSID with the Page token
 *  (spec §5 connection path). Same 24h/HUMAN_AGENT rules as Messenger. */
export function sendInstagramDm(
  opts: DmSendOpts,
  client: GraphHttpClient = fetchClient
): Promise<GraphResult> {
  if (!throttleCheck(opts.token)) {
    return Promise.resolve({ ok: false, error: "Send throttled: hourly DM limit reached." });
  }
  throttleRecord(opts.token);
  return graphPost("me/messages", opts.token, dmBody(opts), client);
}
