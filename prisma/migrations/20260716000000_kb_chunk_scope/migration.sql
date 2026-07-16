-- KbChunk.scope: "public" (storefront bot may retrieve) | "clinical" (agents only).
-- The KB merges e-commerce support with Dr. Michelle's dental-practice FAQ. The
-- customer bot must never speak the clinical half; the agent copilot may still read it.
-- Additive + defaulted, so existing rows keep working and a rollback is a column drop.
ALTER TABLE "KbChunk" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'public';

-- Retrieval always filters by (inboxId, scope).
CREATE INDEX IF NOT EXISTS "KbChunk_inboxId_scope_idx" ON "KbChunk" ("inboxId", "scope");
