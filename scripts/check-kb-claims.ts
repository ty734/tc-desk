/**
 * Read-only audit: scan the live KbChunk table for non-compliant claim language.
 * Usage: npx tsx scripts/check-kb-claims.ts [brand] [pattern]
 *   With a pattern, prints wide context for each hit.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PATTERNS: [string, string][] = [
  ["100% safe", "absolute safety claim"],
  ["as effective in treating gum disease", "Rx comparative + treat-disease"],
  ["Better than fluoride", "comparative drug claim"],
  ["cavity-resistant", "prevention claim"],
  ["decay free", "absolute prevention claim"],
  ["boosts your immune system", "overreach"],
  ["15% hydroxyapatite", "wrong dose (confirmed 10%)"],
  ["prevent tooth decay", "prevention claim"],
  ["preventing mouth sores", "drug claim"],
  ["eliminate any deficiencies", "absolute + prohibited verb"],
  // added 2026-07-16 after the agent review found live claims these rules had missed
  ["protect against cavities", "prevention claim"],
  ["studies show", "unsubstantiated efficacy claim (no citation)"],
  ["clinically proven", "unsubstantiated efficacy claim"],
  ["rebuild weakened enamel", "overreach vs 'supports remineralization'"],
  ["as effective as", "comparative efficacy vs a drug/Rx"],
  // "reduce sensitivity" deliberately NOT flagged — Tyler reviewed and accepted it 2026-07-16
  // as an established position for the category. Revisit only if counsel says otherwise.
  ["gold standard", "Rx comparison framing"],
  ["antimicrobial", "drug-class claim"],
  ["chlorhexidine", "Rx comparison"],
];

async function main() {
  const brand = process.argv[2] || "living-well";
  const only = process.argv[3];
  const inbox = await prisma.inbox.findFirst({ where: { brand } });
  if (!inbox) throw new Error(`no inbox for brand ${brand}`);

  const total = await prisma.kbChunk.count({ where: { inboxId: inbox.id } });
  console.log(`\nKbChunk rows for ${brand}: ${total}\n`);

  const all = await prisma.kbChunk.findMany({
    where: { inboxId: inbox.id },
    select: { source: true, content: true, scope: true },
  });
  // Clinical-scoped chunks are unreachable by the customer bot (see src/lib/kb.ts —
  // searchKb excludes them by default). A claim in there is not a live customer risk,
  // so report it as INFO, not FAIL. Flagging it would train people to ignore this.
  const pub = all.filter((c) => c.scope !== "clinical");
  const clin = all.filter((c) => c.scope === "clinical");
  console.log(`  ${pub.length} public (bot-reachable) / ${clin.length} clinical (agents only)\n`);

  const pats = only ? PATTERNS.filter(([p]) => p === only) : PATTERNS;
  let bad = 0;
  let info = 0;
  for (const [pat, why] of pats) {
    // NB: Prisma `contains` compiles to SQL LIKE, where a literal % in the needle
    // becomes a wildcard ("100% safe" matches "$100.97 ... safe"). Filter in JS instead.
    const match = (c: { content: string }) => c.content.toLowerCase().includes(pat.toLowerCase());
    const hits = pub.filter(match);
    const clinHits = clin.filter(match);
    const tag = hits.length ? "FAIL" : clinHits.length ? "info" : "ok  ";
    const extra = clinHits.length ? `  (+${clinHits.length} in clinical scope, bot cannot reach)` : "";
    console.log(`[${tag}] ${hits.length}  "${pat}"  (${why})${extra}`);
    bad += hits.length;
    info += clinHits.length;
    const pad = only ? 320 : 90;
    for (const h of hits) {
      const i = h.content.toLowerCase().indexOf(pat.toLowerCase());
      console.log(`        --- ${h.source}`);
      console.log(`        ...${h.content.slice(Math.max(0, i - pad), i + pad).replace(/\s+/g, " ")}...\n`);
    }
  }
  console.log(
    `\n${bad === 0 ? "CLEAN — no flagged language reachable by the customer bot." : `${bad} bot-reachable chunk(s) carry flagged language.`}` +
      (info ? `\n(${info} hit(s) sit in clinical-scoped chunks — agents only, not customer-facing.)` : ""),
  );
  await prisma.$disconnect();
  if (bad > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
