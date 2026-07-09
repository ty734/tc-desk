-- Human-readable per-inbox ticket numbers
ALTER TABLE "Inbox" ADD COLUMN "ticketCounter" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN "number" INTEGER;
CREATE UNIQUE INDEX "Ticket_inboxId_number_key" ON "Ticket"("inboxId", "number");
