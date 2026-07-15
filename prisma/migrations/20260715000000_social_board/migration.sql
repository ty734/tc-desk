-- Social board routing — ADDITIVE ONLY.
-- Hand-authored 2026-07-15 during the unattended build. NOT applied yet:
-- apply in the supervised deploy step with Tyler (the dev .env DATABASE_URL
-- is the shared PROD Neon DB). One new nullable column + unique index + FK —
-- safe on live data, no rewrites.
--
-- Inbox.socialBoardId points FB/IG tickets at a dedicated "Social" board
-- while they keep inboxId = the same inbox (replies, Page token, KB, and
-- threading all unchanged). NULL = fall back to the primary board.

ALTER TABLE "Inbox" ADD COLUMN "socialBoardId" TEXT;

CREATE UNIQUE INDEX "Inbox_socialBoardId_key" ON "Inbox"("socialBoardId");

ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_socialBoardId_fkey" FOREIGN KEY ("socialBoardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
