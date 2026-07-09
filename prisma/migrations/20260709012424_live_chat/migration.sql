-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'bot',
ADD COLUMN     "visitorName" TEXT,
ADD COLUMN     "waitingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentPresence" (
    "userId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "ChatSession_status_idx" ON "ChatSession"("status");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPresence" ADD CONSTRAINT "AgentPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
