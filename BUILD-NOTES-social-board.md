# Social Board — Build Notes (feat/social-board)

Built unattended 2026-07-15. FB/IG comments + DMs get their OWN board/section
on the Desk homepage, separate from the email/Amazon queue. Social tickets are
routed to a dedicated **Social** board while keeping `inboxId = living-well`,
so replies, the Page token, the KB, and dedupe/threading are all untouched.

## What changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | `Inbox.socialBoardId` (nullable, unique) + named relation `"InboxSocialBoard"` to `Board.socialForInbox`; the existing 1:1 pair is now named `"InboxPrimaryBoard"`. Additive only. |
| `prisma/migrations/20260715000000_social_board/migration.sql` | Hand-authored, **NOT applied**: ADD COLUMN + unique index + FK (`ON DELETE SET NULL`). |
| `src/lib/meta-ingest.ts` | Inbox fetch now includes `socialBoard`; `const board = inbox.socialBoard ?? inbox.board` picks the ticket's `boardId`, columns, and Channel-chip field. Null `socialBoardId` = exact pre-seed behavior (fallback to primary board). Dedupe/threading still scoped by `inboxId`, unchanged. |
| `src/app/page.tsx` | Board cards are board-aware: social boards get an at-symbol icon and "Facebook & Instagram comments and DMs"; others keep the email/Amazon description. |
| `src/app/api/auth/register/route.ts` | New agents auto-join each inbox's social board too (idempotent upsert, skips null). |
| `scripts/seed-social-board.ts` | New, idempotent, transactional. Creates the "Social" board (mirrors the primary board's columns), a **Channel** field with **Facebook** + **Instagram** options (closes the old ingest-chip TODO), copies all primary-board members with their roles, then sets `inbox.socialBoardId`. Re-run = no-op. |
| `scripts/mock-social-harness.ts` | New "Social board routing" section: with `socialBoard` set → tickets land on the social board with its columns + chips (FB and IG); with it null → fallback to primary; threading on the social board reuses the same ticket. |
| `src/app/api/webhooks/meta/route.ts` | Committed the pre-existing local revert of temporary `[mw-debug]` console.logs. |

## Validation (all on this branch, zero DB/network)

- `npx tsx scripts/mock-social-harness.ts` — **ALL 46 CHECKS PASSED** (Prisma, Graph API, and model all stubbed; global fetch booby-trapped)
- `npx tsc --noEmit` — clean
- `npm run build` — compiled successfully

## Supervised deploy steps (Tyler)

Run from the repo root, in this order:

1. **Apply the migration** (additive; safe on live data):
   ```
   npx.cmd prisma migrate deploy
   ```
2. **Seed the Social board** (idempotent; re-running is a no-op):
   ```
   npx.cmd tsx scripts/seed-social-board.ts
   ```
   Creates the "Social" board with New/Open/Pending/Solved/Closed, the
   Channel field (Facebook/Instagram), adds every current living-well board
   member, and sets `inbox.socialBoardId`.
3. **Merge to main + push** to deploy the code. Order note: the code is safe
   in either order — until the seed runs, ingest falls back to the primary
   board exactly as before; the migration just needs to be applied before the
   seed and before deploying (the homepage/register queries select
   `socialBoardId`, which must exist as a column).
4. **Resume ingestion** — re-subscribe the Meta webhooks. From that point,
   new FB/IG tickets land on the Social board. Existing social tickets stay
   on the old board (no backfill was scoped); move them by drag if wanted, or
   run a one-off `UPDATE "Ticket" SET "boardId" = <socialBoardId> WHERE
   channel LIKE 'facebook%' OR channel LIKE 'instagram%'` — column ids differ
   per board, so a drag or a scripted column remap is safer than raw SQL.

## Deferred / notes

- No backfill of pre-existing social tickets to the new board (see step 4).
- Board deletion UX: if the Social board is ever deleted, the FK sets
  `socialBoardId` back to NULL and ingest silently falls back to the primary
  board — intentional fail-safe.
- The seed targets only `living-well`; Longer Together (or any future brand)
  gets a social board by running the same pattern with its brand slug.
