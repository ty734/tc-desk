-- Voice channel Phase 4 — separate phone-availability presence. ADDITIVE ONLY.
-- Hand-authored 2026-07-21. Apply supervised (prisma migrate deploy) — the dev
-- .env DATABASE_URL is the shared PROD Neon DB. New table + FK only; no changes
-- to existing tables, safe on live data.

CREATE TABLE "VoicePresence" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoicePresence_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "VoicePresence"
    ADD CONSTRAINT "VoicePresence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
