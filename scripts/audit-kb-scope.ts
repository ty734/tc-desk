/** Audit the clinical/public split. Read-only.
 *  npx tsx scripts/audit-kb-scope.ts [brand]
 *
 *  Over-tagging is the dangerous failure: it silently blinds the customer bot to
 *  content it SHOULD answer, and nothing surfaces that. So this prints what got
 *  tagged clinical, and probes that key product questions still retrieve publicly.
 */
import { PrismaClient } from "@prisma/client";
import { searchKb } from "../src/lib/kb";

const prisma = new PrismaClient();

// Things a real customer asks that MUST still work for the storefront bot.
const MUST_STAY_PUBLIC = [
  "how do I use the tooth powder",
  "is the tooth powder safe with crowns and veneers",
  "how much hydroxyapatite is in the tooth powder",
  "is it safe for kids",
  "is it safe during pregnancy",
  "what is your return policy",
  "how long does one jar last",
  "is the tooth powder fluoride free",
  "where is my order",
  "how do I cancel my subscription",
  "does it contain xylitol",
  "what flavor is the tooth powder",
  "is the mouthwash alcohol free",
  "can I use this with braces",
];

async function main() {
  const brand = process.argv[2] || "living-well";
  const inbox = await prisma.inbox.findFirst({ where: { brand } });
  if (!inbox) throw new Error(`no inbox ${brand}`);

  const rows = await prisma.kbChunk.findMany({
    where: { inboxId: inbox.id },
    select: { source: true, title: true, content: true, scope: true },
  });
  const clinical = rows.filter((r) => r.scope === "clinical");
  console.log(`${rows.length} chunks: ${rows.length - clinical.length} public / ${clinical.length} clinical\n`);

  const bySource: Record<string, number> = {};
  for (const c of clinical) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  console.log("clinical chunks by source file:");
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${s}`);
  }

  console.log("\nsample of what got tagged CLINICAL (titles):");
  for (const c of clinical.slice(0, 25)) {
    console.log(`  - ${(c.title ?? "(untitled)").slice(0, 80)}`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("RETRIEVAL PROBE — these must still return hits for the CUSTOMER bot");
  console.log("=".repeat(72));
  let blinded = 0;
  for (const q of MUST_STAY_PUBLIC) {
    const pub = await searchKb(inbox.id, q, { limit: 3 });
    const all = await searchKb(inbox.id, q, { limit: 3, includeClinical: true });
    const ok = pub.length > 0;
    if (!ok) blinded++;
    console.log(
      `${ok ? "ok  " : "BLIND"}  public=${pub.length} withClinical=${all.length}  "${q}"`,
    );
    if (!ok && all.length) {
      console.log(`        ^ only clinical chunks match this — the bot can no longer answer it`);
    }
  }
  console.log(
    blinded === 0
      ? "\nAll probes still answerable publicly — no over-tagging detected."
      : `\n${blinded} probe(s) BLINDED by scoping — loosen the classifier.`,
  );
  await prisma.$disconnect();
  if (blinded > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
