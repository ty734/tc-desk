-- Voice channel (Twilio) — Phase 1: inbound voicemail. ADDITIVE ONLY.
-- Hand-authored 2026-07-21 during the unattended build. NOT applied yet:
-- apply in a supervised step with Tyler (the dev .env DATABASE_URL is the
-- shared PROD Neon DB). All changes are new nullable columns + indexes —
-- safe on live data, no table rewrites.
--
-- Ticket.channel is a String (not a PG enum), so the new "voice" value needs
-- no DDL — it is documented in schema.prisma.

-- Inbox: per-brand Twilio number (inbound routing is by the dialed number).
ALTER TABLE "Inbox" ADD COLUMN "twilioNumber" TEXT;
CREATE UNIQUE INDEX "Inbox_twilioNumber_key" ON "Inbox"("twilioNumber");

-- Customer: caller ID (callers usually have no email to key on).
ALTER TABLE "Customer" ADD COLUMN "phone" TEXT;
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- Ticket: caller ID kept on the ticket (mirrors customerEmail for the email channel).
ALTER TABLE "Ticket" ADD COLUMN "customerPhone" TEXT;
CREATE INDEX "Ticket_customerPhone_idx" ON "Ticket"("customerPhone");
