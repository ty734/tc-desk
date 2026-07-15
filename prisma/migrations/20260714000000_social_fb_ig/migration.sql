-- Social engagement Phase 1a (Facebook + Instagram) — ADDITIVE ONLY.
-- Hand-authored 2026-07-14 during the unattended build. NOT applied yet:
-- apply in the supervised Phase 1b step with Tyler (the dev .env DATABASE_URL
-- is the shared PROD Neon DB). All changes are new nullable columns, new
-- defaulted columns, and new indexes — safe on live data, no rewrites.
--
-- Ticket.channel is a String (not a PG enum), so the new channel values
-- (facebook_comment | facebook_dm | instagram_comment | instagram_dm) need no
-- DDL — they are documented in schema.prisma.

-- Inbox: Meta asset mapping + the social auto-send moderation dial.
ALTER TABLE "Inbox" ADD COLUMN "metaPageId" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "metaIgId" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "metaPageTokenRef" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "autoSendMode" TEXT NOT NULL DEFAULT 'off';

CREATE UNIQUE INDEX "Inbox_metaPageId_key" ON "Inbox"("metaPageId");
CREATE UNIQUE INDEX "Inbox_metaIgId_key" ON "Inbox"("metaIgId");

-- Message: platform ids for dedupe/threading, the 24h DM window, and the
-- AI draft awaiting human approval.
ALTER TABLE "Message" ADD COLUMN "platformMessageId" TEXT;
ALTER TABLE "Message" ADD COLUMN "platformThreadId" TEXT;
ALTER TABLE "Message" ADD COLUMN "windowExpiresAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "aiDraft" TEXT;
ALTER TABLE "Message" ADD COLUMN "aiConfidence" DOUBLE PRECISION;
ALTER TABLE "Message" ADD COLUMN "aiIntent" TEXT;
ALTER TABLE "Message" ADD COLUMN "aiFlagReason" TEXT;

CREATE INDEX "Message_platformMessageId_idx" ON "Message"("platformMessageId");
CREATE INDEX "Message_platformThreadId_idx" ON "Message"("platformThreadId");
