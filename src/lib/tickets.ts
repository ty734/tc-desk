import { db } from "@/lib/db";

// Atomically allocate the next human-readable ticket number for an inbox.
// The UPDATE ... RETURNING is a single statement, so concurrent creates never
// collide (each gets a distinct value).
export async function nextTicketNumber(inboxId: string): Promise<number> {
  const rows = await db.$queryRaw<{ ticketCounter: number }[]>`
    UPDATE "Inbox" SET "ticketCounter" = "ticketCounter" + 1
    WHERE id = ${inboxId}
    RETURNING "ticketCounter"
  `;
  return rows[0].ticketCounter;
}
