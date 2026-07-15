# Build Notes — Hide Comment (feat/social-hide-comment)

2026-07-15. Unattended build. Gives CS agents a "Hide comment" button on
Facebook/Instagram *comment* tickets so a nasty/negative comment can be hidden
on the platform instead of answered. The hide capability already existed in
the Meta connector (`hideFacebookComment` / `hideInstagramComment` in
`src/lib/meta-social.ts`); this wires it to a route and a button.

## Files changed

| File | Change |
|---|---|
| `src/lib/hide-comment.ts` | NEW. Core logic with injectable Prisma + Graph client (same pattern as `meta-ingest.ts`): channel gate (`facebook_comment` / `instagram_comment` only), token resolve via `resolveMetaToken(inbox.metaPageTokenRef)`, hides the latest inbound `platformMessageId` (FB `is_hidden=true`, IG `hide=true`), writes an internal `Comment` ("Comment hidden on {Facebook\|Instagram} by {agent}."), moves the ticket to the board's Solved column (falls back to Closed; leaves it in place if neither exists). |
| `src/app/api/tickets/[ticketId]/hide-comment/route.ts` | NEW POST route. Mirrors `/social-reply`: auth via `getCurrentUser` + `getBoardMembership`, loads ticket with inbox/board.columns/messages, delegates to `hideTicketComment`, try/catch with JSON errors (400 non-comment channel or missing token/comment, 502 Graph failure, 500 unexpected). Returns `{ ok, platformLabel, status, columnId }`. |
| `src/components/TicketModal.tsx` | "Hide comment" button (secondary violet outline, next to "Post public reply") shown ONLY when the channel is a social *comment* — never DMs, email, chat, or Amazon. Confirm dialog ("stays visible to the person who wrote it… you can unhide it from the platform"), POST to the route, on success shows "Comment hidden ✓", disables itself, and patches local ticket state to the resolved column/status. Inline error line on failure. |
| `scripts/mock-social-harness.ts` | New section "Hide comment (agent moderation action)": asserts FB hits `POST /{comment-id}` with `is_hidden=true` (and no `hide`), IG hits `POST /{ig-comment-id}` with `hide=true` (and no `is_hidden`), the internal note + Solved move happen, Closed fallback works, `facebook_dm` / `instagram_dm` / `email` are rejected 400 with zero Graph calls and zero DB writes, and a Graph error returns 502 without touching the ticket. |

## No migration needed

No schema change. The internal note reuses the existing `Comment` model; the
comment id to hide is the existing `Message.platformMessageId`; the column
move uses existing `Ticket.columnId`/`status`. `prisma migrate` / `db push`
were never run (dev DATABASE_URL is PROD).

## Validation (all green)

- `npx tsx scripts/mock-social-harness.ts` — ALL 56 CHECKS PASSED, zero DB
  access, zero network calls (global fetch is booby-trapped).
- `npx tsc --noEmit` — clean.
- `npm run build` — clean; `/api/tickets/[ticketId]/hide-comment` registered.
- No live Graph call was made; the connector was exercised only through the
  stubbed HTTP client.

## Idempotency note

Meta treats re-hiding an already-hidden comment as a success (`is_hidden` /
`hide` are set-state, not toggle), so double-clicks or retries succeed
gracefully; the UI additionally disables the button after the first success.

## Deploy steps (Claude runs these — NOT done in this build)

1. Merge `feat/social-hide-comment` into `main`.
2. Push `main` — Vercel deploys automatically.

## Possible follow-up (not in v1)

- **Unhide:** the connector already supports it (`hidden: false` on the same
  functions). A v2 could add an "Unhide" action on the internal note or on
  resolved comment tickets; for now agents unhide from the platform's native
  tools, as the confirm dialog says.
