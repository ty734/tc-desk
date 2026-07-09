ALTER TABLE "Ticket" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Ticket_archived_idx" ON "Ticket"("archived");
