-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "visitorEmail" TEXT,
    "ticketId" TEXT,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_inboxId_idx" ON "ChatSession"("inboxId");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search index for KB retrieval (v1 retrieval is Postgres FTS;
-- the pgvector embedding column stays reserved for a later semantic upgrade).
CREATE INDEX "KbChunk_fts_idx" ON "KbChunk" USING GIN (
  to_tsvector('english', coalesce("title", '') || ' ' || "content")
);
