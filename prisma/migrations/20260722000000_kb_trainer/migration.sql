-- KB Trainer — let CS managers (Tyler + Derrick) correct the social bot's
-- knowledge in plain English. ADDITIVE ONLY. Hand-authored 2026-07-22.
--
-- NOT applied yet: apply in a supervised step with Tyler (the dev .env
-- DATABASE_URL is the shared PROD Neon DB). All changes are new columns with
-- safe defaults + one index — no table rewrites, safe on live data.
--
-- Existing KbChunk rows are all machine-ingested, so origin defaults to
-- 'ingest' for them (correct). Only chunks written via the Trainer get
-- 'trainer', which the ingest script preserves on re-load.

-- origin: 'ingest' (default, wiped/reloaded by scripts/ingest-kb.ts) vs
-- 'trainer' (permanent human correction).
ALTER TABLE "KbChunk" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'ingest';

-- createdBy: email of the CS manager who authored/last edited a trainer chunk.
ALTER TABLE "KbChunk" ADD COLUMN "createdBy" TEXT;

-- updatedAt: track when a chunk was last corrected. Existing rows get "now".
ALTER TABLE "KbChunk" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Fast lookup of a brand's trainer-authored chunks (the Trainer's "what have we
-- taught the bot" listing and the re-ingest preserve filter).
CREATE INDEX "KbChunk_inboxId_origin_idx" ON "KbChunk"("inboxId", "origin");
