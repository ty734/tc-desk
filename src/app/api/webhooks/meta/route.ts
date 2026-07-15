import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchKb } from "@/lib/kb";
import { nextTicketNumber } from "@/lib/tickets";
import { verifyChallenge, verifySignature, parseMetaWebhook } from "@/lib/meta-webhook";
import { ingestSocialEvents, type SocialDb } from "@/lib/meta-ingest";
import { draftSocialReply } from "@/lib/social-draft";

// Meta (Facebook Page + Instagram) webhook receiver (spec §3, §5).
//
// GET  — subscription handshake: echoes hub.challenge when hub.verify_token
//        matches META_WEBHOOK_VERIFY_TOKEN.
// POST — event deliveries, authenticated by X-Hub-Signature-256 (HMAC-SHA256
//        of the RAW body with META_APP_SECRET). Events are normalized
//        (meta-webhook.ts) and ingested (meta-ingest.ts) into Ticket/Message
//        with an AI draft attached; the moderation dial decides whether
//        anything is ever auto-sent (default: never — autoSendMode "off").
//
// Meta expects a fast 200 and retries on failure, so ingest errors are logged
// per event rather than failing the whole delivery; the platformMessageId
// dedupe makes retries idempotent.

export const maxDuration = 60;

export async function GET(req: Request) {
  const challenge = verifyChallenge(
    new URL(req.url).searchParams,
    process.env.META_WEBHOOK_VERIFY_TOKEN
  );
  if (challenge === null) return NextResponse.json({ error: "Verification failed." }, { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  // Raw body FIRST — the signature covers the exact bytes on the wire.
  const rawBody = await req.text();
  const ok = verifySignature(rawBody, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET);
  if (!ok) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const events = parseMetaWebhook(payload as Parameters<typeof parseMetaWebhook>[0]);
  console.log("[mw-debug] raw:", rawBody.slice(0, 2000));
  console.log("[mw-debug] parsed:", events.length, JSON.stringify(events));
  if (events.length === 0) return NextResponse.json({ ok: true, events: 0 });

  const results = await ingestSocialEvents(events, {
    db: db as unknown as SocialDb,
    nextTicketNumber,
    draft: (input) => draftSocialReply(input, { searchKb }),
  });

  console.log("[mw-debug] results:", JSON.stringify(results.map((r) => ({ skipped: r.skipped, ingested: !!r.messageId }))));
  return NextResponse.json({
    ok: true,
    events: events.length,
    ingested: results.filter((r) => r.messageId).length,
    skipped: results.filter((r) => r.skipped).length,
  });
}
