# BUILD-NOTES — Social Engagement Phase 1a (Facebook + Instagram)

Branch: `feat/social-fb-ig` · Built unattended overnight 2026-07-14 per
`workflows/social-engagement-system/BUILD-SPEC.md` (§3–§8, §10). No prod-DB
writes, no network calls, no deploy, nothing on `main`.

## What was built

| Piece | File(s) |
|---|---|
| Schema (additive) | `prisma/schema.prisma` — Inbox: `metaPageId`, `metaIgId`, `metaPageTokenRef` (env-ref), `autoSendMode` (default `"off"`); Message: `platformMessageId`, `platformThreadId`, `windowExpiresAt`, `aiDraft`, `aiConfidence`, `aiIntent`, `aiFlagReason`. New channel strings: `facebook_comment`, `facebook_dm`, `instagram_comment`, `instagram_dm` (Ticket.channel is a String — no enum DDL needed). |
| Migration (NOT applied) | `prisma/migrations/20260714000000_social_fb_ig/migration.sql` — hand-authored, additive only. **Left unapplied on purpose** (the dev `.env` DATABASE_URL is the shared PROD Neon DB). `npx prisma generate` was run (local client only, no DB contact). |
| Webhook receiver | `src/app/api/webhooks/meta/route.ts` — GET `hub.challenge` handshake (`META_WEBHOOK_VERIFY_TOKEN`); POST with `X-Hub-Signature-256` HMAC verification (`META_APP_SECRET`) over the raw body, then ingest. |
| Webhook plumbing (pure) | `src/lib/meta-webhook.ts` — challenge + constant-time signature verification, and the payload normalizer for FB `feed`/`messages` and IG `comments`/`messages` shapes. |
| Ingest | `src/lib/meta-ingest.ts` — maps events onto Ticket/Message on the right Inbox (matched by `metaPageId`/`metaIgId`), mirrors the Postmark route's idempotency (platformMessageId dedupe), threading (one comment thread / one DM conversation = one Ticket via `platformThreadId`), ticket numbering, chips, and status transitions. DMs stamp `windowExpiresAt = inbound + 24h`. Skips echoes, our own Page/IG authored comments, and unmapped accounts. Every dependency (db, draft, Graph client, ticket counter, clock) is injected. |
| AI draft | `src/lib/social-draft.ts` — `draftSocialReply()` adapted from `evaluateAndDraft()`: KB-grounded (same `searchKb`), same FTC/FDA guardrails plus public-comment rules, returns `{respond, confidence, intent, reply, flagReason}`. Belt-and-braces server-side drug-claim regex flags any non-compliant draft and clamps its confidence ≤ 0.3. Draft is stored on the inbound Message (`aiDraft*` columns), never sent. |
| Connector | `src/lib/meta-social.ts` — reply-to-comment (FB `POST /{comment-id}/comments`, IG `POST /{ig-comment-id}/replies`), hide-comment (FB `is_hidden`, IG `hide`), send-DM (FB + IG via `POST /me/messages`, `messaging_type=RESPONSE`, or `MESSAGE_TAG`+`HUMAN_AGENT` for human sends past the window). Injectable HTTP client; token env-ref resolver mirroring `resolveShopifyToken`; in-memory ~180/hr send throttle (spec §5). **No live Graph call has ever been made through it.** |
| Moderation dial | Per-Inbox `autoSendMode` (`off` default). The auto-send path in `meta-ingest.ts` is complete but unreachable while off: gated on mode + confidence ≥ 0.85 + known-FAQ intent (in `high_confidence`) + inside the 24h window (DMs) + not compliance-flagged. Auto-sends are audited as system-authored Messages (authorId null), same pattern as the email autoresponder. There is deliberately NO UI to change the dial. |
| Human send | `src/app/api/tickets/[ticketId]/social-reply/route.ts` — mirrors the email `/reply` route: posts the comment reply or DM via the connector, records the outbound Message (authorId = agent), moves the ticket to Pending. DMs past 24h automatically attach `HUMAN_AGENT`; past 7 days the send is refused with a clear error. |
| Inbox UI | `src/components/ui.tsx` (4 new ChannelBadge styles), `src/lib/types.ts`, `src/components/TicketModal.tsx` — social tickets get the AI draft pre-filled in the composer (with confidence/intent/flag banner), platform-aware header + button ("Post public reply" / "Send DM"), 24h-window and 7-day banners, and send through `/social-reply`. BoardView needed no change (ChannelBadge handles the new channels). Brand palette stays on `violet-*` as designed. |
| Mock harness | `scripts/mock-social-harness.ts` — see below. |

## How to run the harness

```
npx tsx scripts/mock-social-harness.ts
```

39 checks, all passing: challenge + signature verification, §5 payload parsing
(FB comment/DM, IG comment/DM), full ingest→draft pipeline with the dial off
(correct Ticket/Message shape, channel mapping, KB-grounded compliant draft,
`windowExpiresAt`), dedupe/threading/echo/self skips, the would-send path with
the dial on (asserting exact Graph endpoints + payloads on the stubbed
client), every blocking gate (24h window, low confidence, non-FAQ intent,
compliance flag), and the HUMAN_AGENT tag on human sends. Prisma, the Graph
client, and the model call are all stubbed; `globalThis.fetch` is
booby-trapped so any real network attempt fails the run.

Also verified: `npx tsc --noEmit` clean; `npm run build` succeeds (routes
`/api/webhooks/meta` and `/api/tickets/[ticketId]/social-reply` compile).
ESLint: no new problems (TicketModal has 2 pre-existing `set-state-in-effect`
errors + 1 warning that exist identically on `main`).

## Decisions deferred to Tyler

1. **IG comment reply endpoint.** Spec §5 lists `POST /{ig-media-id}/comments`
   (that posts a NEW top-level comment on the media). I implemented
   `POST /{ig-comment-id}/replies`, the Graph edge for a threaded reply under
   the customer's comment, which matches the feature's intent. Confirm on the
   Dev-Mode live test; it's a one-line change in `meta-social.ts` if not.
2. **DM sender names.** Meta DM webhooks carry only the PSID/IGSID, so DM
   tickets show `FB DM from <id>` until we add the optional Graph profile
   lookup (needs a token — Phase 1b nicety).
3. **Connection path** defaults to "Instagram API with Facebook Login for
   Business" per spec §5 (IG DMs send via the Page's `/me/messages`). If we
   switch to IG-Login, the connector isolates the endpoints in one module.
4. **Media/attachment comments** (images, stickers, story mentions,
   attachment-only DMs) are dropped by the parser in Phase 1a — text only.
5. **Board "Channel" field chips**: the chip upsert no-ops until "Facebook" /
   "Instagram" options are added to the board's Channel custom field (a data
   step, not code).
6. **Throttle** is in-memory per serverless instance — fine for
   human-approved volume; a durable queue is the Phase 2 (auto-send) upgrade.

## Phase 1b — supervised steps (with Tyler)

1. **Apply the migration** to the shared Neon DB: review
   `prisma/migrations/20260714000000_social_fb_ig/migration.sql`, then
   `npx prisma migrate deploy` (it is additive: nullable columns, defaulted
   columns, indexes — no rewrites). Verify with `\d "Inbox"` / `\d "Message"`.
2. **Meta app + tokens**: create/confirm the Meta app; set Vercel env vars
   `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (any random string),
   `LW_META_PAGE_TOKEN` (the Page access token). Then map the inbox row:
   `UPDATE "Inbox" SET "metaPageId"='<page-id>', "metaIgId"='<ig-id>',
   "metaPageTokenRef"='env:LW_META_PAGE_TOKEN' WHERE brand='living-well';`
   (leave `autoSendMode` at `'off'`).
3. **Configure webhooks** in the Meta app dashboard: callback
   `https://<desk-domain>/api/webhooks/meta` + the verify token; subscribe the
   Page via `POST /{page-id}/subscribed_apps` with `subscribed_fields=feed,messages`;
   subscribe the app to IG `comments` + `messages` (the IG account must be
   Public for comment webhooks).
4. **Dev-Mode live test** on roled accounts: comment + DM on both platforms,
   confirm tickets/drafts appear, send human replies from the modal (verify
   the IG reply threads correctly — decision #1), test a >24h DM to see the
   HUMAN_AGENT path.
5. **App Review / Business Verification** for Advanced Access
   (`pages_read_engagement`, `pages_manage_engagement`, `pages_messaging`,
   `pages_manage_metadata`, `instagram_manage_comments`,
   `instagram_manage_messages`, `instagram_basic`), then flip the app Live.
6. Optionally add "Facebook" and "Instagram" options to the board's Channel
   field so the chips populate.

Note: `npx prisma generate` was run against the new schema, so the local
client includes the new fields. Switching back to `main` and running the app
locally will regenerate via `postinstall`/`build` — no action needed.
