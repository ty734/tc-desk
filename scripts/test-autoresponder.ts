// Dry-run the AI autoresponder against recent REAL inbound emails. Prints the
// respond/skip decision and the drafted acknowledgment for each. Sends nothing.
// Usage: npx tsx scripts/test-autoresponder.ts [count]
import { readFileSync } from "fs";
for (const file of [".env", ".env.local"]) {
  try {
    const env = readFileSync(`${__dirname}/../${file}`, "utf8");
    for (const k of ["DATABASE_URL", "DIRECT_URL", "ANTHROPIC_API_KEY"]) {
      const m = env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"));
      if (m && !process.env[k]) process.env[k] = m[1];
    }
  } catch {
    /* file may not exist */
  }
}

import { db } from "../src/lib/db";
import { evaluateAndDraft } from "../src/lib/autoresponder";

async function main() {
  const count = Number(process.argv[2] ?? 25);
  // Recent FIRST-contact messages (the message that created its ticket).
  const msgs = await db.message.findMany({
    where: { direction: "inbound", bodyText: { not: null } },
    orderBy: { createdAt: "desc" },
    take: count,
    include: { ticket: { select: { subject: true, customerEmail: true, customerName: true } } },
  });

  let respond = 0,
    skip = 0;
  for (const m of msgs) {
    const from = m.ticket.customerEmail ?? m.fromAddr;
    const d = await evaluateAndDraft({
      fromName: m.ticket.customerName,
      fromEmail: from,
      subject: m.subject ?? m.ticket.subject ?? "",
      bodyText: m.bodyText ?? "",
    });
    if (d.respond) respond++;
    else skip++;
    console.log("=".repeat(72));
    console.log(`FROM: ${from}`);
    console.log(`SUBJ: ${(m.subject ?? "").slice(0, 66)}`);
    console.log(`>>> ${d.respond ? "RESPOND" : "SKIP"}  (${d.reason})`);
    if (d.reply) console.log(`\n${d.reply}\n`);
  }
  console.log("=".repeat(72));
  console.log(`TOTAL: ${msgs.length}  |  respond: ${respond}  |  skip: ${skip}`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
