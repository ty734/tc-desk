/** Find (and optionally remove) chat sessions + tickets created by guardrail testing.
 *  Usage: npx tsx scripts/cleanup-test-sessions.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
// prefix your test session ids so they are findable, e.g. "guardrail-test-", "dirtest-"
const PREFIX = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) ?? "guardrail-test-";

async function main() {
  const sessions = await prisma.chatSession.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true, status: true, waitingSince: true, ticketId: true, createdAt: true },
  });
  console.log(`chat sessions from this test: ${sessions.length}`);
  for (const s of sessions) console.log(`  ${s.id}  status=${s.status}  waiting=${s.waitingSince ? "YES" : "no"}  ticket=${s.ticketId ?? "-"}`);

  const since = new Date(Date.now() - 30 * 60 * 1000);
  const tickets = await prisma.ticket.findMany({
    where: { createdAt: { gte: since }, channel: "chat" },
    select: { id: true, number: true, subject: true, createdAt: true, archived: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\nchat tickets created in the last 30 min: ${tickets.length}`);
  for (const t of tickets) console.log(`  #${t.number}  ${t.subject?.slice(0, 70)}  archived=${t.archived}`);

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to archive the test sessions)");
    return;
  }
  for (const s of sessions) {
    await prisma.chatSession.update({ where: { id: s.id }, data: { status: "ended", waitingSince: null } });
    console.log(`ended ${s.id}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
