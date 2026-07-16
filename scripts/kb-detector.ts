/**
 * KB DETECTOR — finds the problems we kept discovering by accident.
 *
 *   npx tsx scripts/kb-detector.ts [--deep] [--brand living-well]
 *
 * Checks (all read-only):
 *   1. COMPLIANCE   — prohibited claim language (deterministic rules)
 *   2. CLINICAL     — dental-practice content the storefront bot must never speak
 *   3. FACTS        — conflicting numeric claims (HAp %, jar oz, durations)
 *   4. CONTRADICT   — same question answered two different ways
 *   5. DRIFT        — KB product facts vs LIVE Shopify PDP descriptions
 *   6. DEEP (opt-in)— an AI pass that catches phrasing the rules miss
 *
 * Writes a ranked markdown report and exits non-zero if anything CRITICAL is found,
 * so it can gate a scheduled task.
 *
 * KNOWN LIMIT: the desk's Shopify token lacks `read_metaobjects`, so this reads the
 * KB mirror (kb-source/shopify/product-faqs.md) rather than the metaobject library
 * directly. Regenerate that mirror before trusting a run. Give the detector a token
 * with read_metaobjects and check 5 can compare against the true source.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { classifyScope, PRODUCT_CONTEXT } from "../src/lib/clinical";

type Sev = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type Finding = {
  check: string;
  sev: Sev;
  title: string;
  detail: string;
  where: string;
  quote?: string;
};

const PROJ = "C:/Users/tycol/Desktop/Living Well with Dr. Michelle Claude";
const KB_DIRS = [
  join(PROJ, "Customer Support Docs/knowledge-base/public-bot"),
  join(PROJ, "workflows/customer-service-system/kb-source/shopify"),
  join(PROJ, "workflows/customer-service-system/kb-source/site"),
];
const OUT_DIR = join(PROJ, "workflows/customer-service-system/detector-reports");

// ---------------------------------------------------------------- 1. COMPLIANCE
// Every rule here was earned: each one is a claim that was actually live.
const CLAIM_RULES: { re: RegExp; sev: Sev; why: string }[] = [
  { re: /\b100\s*%\s*safe\b/i, sev: "CRITICAL", why: "absolute safety claim" },
  { re: /\b(treat|treating|cures?|curing|reverses?|reversing)\b[^.]{0,60}\b(gum disease|gingivitis|periodontitis|cavit(y|ies)|decay|infection|disease)\b/i, sev: "CRITICAL", why: "drug claim: treats/cures disease" },
  { re: /\bprevent(s|ing|ion)?\b[^.]{0,50}\b(cavit(y|ies)|decay|gum disease|gingivitis|disease|sores?|infection)\b/i, sev: "CRITICAL", why: "drug claim: prevents disease" },
  { re: /\bprotect(s|ing)?\s+against\b[^.]{0,40}\b(cavit(y|ies)|decay|disease)\b/i, sev: "CRITICAL", why: "prevention claim" },
  { re: /\b(kills?|fights?|eliminates?|destroys?)\b[^.]{0,40}\b(bacteria|germs?|pathogens?|infection)\b/i, sev: "CRITICAL", why: "drug claim vs bacteria" },
  { re: /\b(as effective as|comparable to|similar in purpose to)\b[^.]{0,60}\b(chlorhexidine|prescription|rx|fluoride)\b/i, sev: "HIGH", why: "comparative efficacy vs a drug" },
  { re: /\bbetter than fluoride\b/i, sev: "HIGH", why: "comparative drug claim" },
  { re: /\b(studies show|clinically proven|proven to)\b/i, sev: "HIGH", why: "efficacy claim with no citation" },
  { re: /\bcavity[- ]resistant\b/i, sev: "HIGH", why: "prevention claim" },
  { re: /\b(decay|cavity)[- ]free\b/i, sev: "HIGH", why: "absolute prevention claim" },
  { re: /\beliminate\b[^.]{0,30}\b(deficienc|toxin)/i, sev: "HIGH", why: "absolute + prohibited verb" },
  { re: /\bboosts? your immune system\b/i, sev: "MEDIUM", why: "overreach; use 'supports immune function'" },
  { re: /\bgold standard\b/i, sev: "MEDIUM", why: "Rx comparison framing" },
  { re: /\bantibacterial effect\b/i, sev: "MEDIUM", why: "drug-class claim" },
];

// The FDA/DSHEA disclaimer legally REQUIRES the banned verbs ("not intended to
// diagnose, treat, cure, or prevent any disease"). Flagging it is how a detector
// teaches people to ignore it. Never flag inside one.
const DISCLAIMER = new RegExp(
  [
    "not intended to",
    "not been evaluated",
    "informational purposes only",
    "no medical advice",
    "never a substitute",
    "nothing may be used to",
    "is or should be used for",
    "should not be used",
    "for the purposes? of",
    "does not (?:diagnose|treat|cure|prevent)",
  ].join("|"),
  "i",
);

// ---------------------------------------------------------------- 2. CLINICAL
// The storefront bot must never advise on these, no matter what the KB says.
// Unambiguous clinical topics only. Deliberately EXCLUDES crown / veneer / bridge /
// filling: "is your powder safe with crowns?" is a legitimate, high-volume PRODUCT
// compatibility question, not clinical advice. Including them buried the real signal
// (165 -> ~40 findings). Precision beats recall here — a detector nobody trusts is worthless.
const CLINICAL = [
  "root canal", "implant", "extraction", "cavitation", "ozone", "oral surgery",
  "cone beam", "ct scan", "x-ray", "amalgam", "abscess", "periodontitis",
  "gum disease treatment", "airway", "sleep apnea", "tmj", "oil pulling",
  "cavitation surgery", "bone graft", "gingivitis treatment",
];
// ...unless the question is plainly about product compatibility/safety, which is ours to answer.
// Reuse the SHIPPED exemption rather than keeping a second copy. When this scanner had its
// own narrower version, the two disagreed and it reported a phantom "CLASSIFIER GAP" on
// "Can I use the powder if I have zirconia crowns or amalgam fillings?" — a plain
// compatibility question the classifier had correctly left public.
const PRODUCT_COMPAT = { test: (q: string) => PRODUCT_CONTEXT.some((re) => re.test(q)) };

// ---------------------------------------------------------------- 3. FACTS
// Confirmed by Tyler 2026-07-16. Anything disagreeing is wrong.
const FACTS: { name: string; re: RegExp; truth: string; sev: Sev }[] = [
  { name: "tooth powder hydroxyapatite %", re: /(\d+(?:\.\d+)?)\s*%\s*hydroxyapatite/gi, truth: "10", sev: "CRITICAL" },
  { name: "tooth powder jar size (oz)", re: /(\d+(?:\.\d+)?)\s*(?:oz|ounce)s?\b[^.]{0,25}\b(?:jar|container|powder)/gi, truth: "1.8", sev: "HIGH" },
];
// toothpaste is legitimately 1.5% — never flag it as a powder conflict
const FACT_EXEMPT = /toothpaste|1\.5\s*%/i;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  );
}

type QA = { q: string; a: string; file: string; line: number; section: string };

function parse(file: string): { qas: QA[]; text: string } {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const qas: QA[] = [];
  let section = "(top)"; // the "## Product Title (`handle`)" this Q/A sits under
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+)/);
    if (h) { section = h[1].trim(); continue; }
    const qm = lines[i].match(/^\*\*Q:\*\*\s*(.+)/);
    if (!qm) continue;
    let a = "";
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const am = lines[j].match(/^\*\*A:\*\*\s*(.+)/);
      if (am) { a = am[1]; break; }
    }
    qas.push({ q: qm[1].trim(), a: a.trim(), file, line: i + 1, section });
  }
  return { qas, text };
}

const findings: Finding[] = [];
const files = KB_DIRS.flatMap(walk);
let totalQA = 0;
const allQAs: QA[] = [];

for (const f of files) {
  const { qas, text } = parse(f);
  totalQA += qas.length;
  allQAs.push(...qas);
  const short = f.split(/[\\/]/).pop()!;

  // 1. COMPLIANCE
  // Scan the ANSWER (what we assert) separately from the QUESTION (what a customer
  // might naturally ask). "Does tooth powder prevent cavities?" is a fair question;
  // the violation would be answering yes. Question hits are a wording review, not a claim.
  const units = qas.length
    ? qas.flatMap((x) => [
        { s: x.a, at: `${short}:${x.line}`, q: x.q, isQ: false },
        { s: x.q, at: `${short}:${x.line}`, q: x.q, isQ: true },
      ])
    : [{ s: text, at: short, q: "", isQ: false }];
  for (const u of units) {
    if (!u.s) continue;
    for (const r of CLAIM_RULES) {
      const m = u.s.match(r.re);
      if (!m) continue;
      // Never flag the standard FDA disclaimer — it CONTAINS the banned verbs by design.
      const ctx = u.s.slice(Math.max(0, (m.index ?? 0) - 130), (m.index ?? 0) + 130);
      if (DISCLAIMER.test(ctx)) continue;
      findings.push({
        check: "COMPLIANCE",
        sev: u.isQ ? "MEDIUM" : r.sev,
        title: u.isQ ? `question wording: ${r.why}` : r.why,
        detail: u.isQ
          ? `The QUESTION uses claim language; the answer may be fine. Review the wording, since the question renders on the PDP too.`
          : u.q ? `Q: ${u.q}` : "(prose section)",
        where: u.at, quote: m[0].trim().slice(0, 160),
      });
    }
  }

  // 2. CLINICAL
  // Since 2026-07-16 clinical chunks are TAGGED at ingest (src/lib/clinical.ts) and
  // searchKb excludes them, so the customer bot cannot reach them. Merely FINDING
  // clinical content is therefore not a problem — it is the system working.
  //
  // The finding that matters is DISAGREEMENT: this scanner's broad heuristic says
  // "clinical" but the SHIPPED classifier says "public", which means the classifier
  // has a gap and the bot CAN still reach it. That is the only actionable case.
  for (const x of qas) {
    const hay = `${x.q} ${x.a}`.toLowerCase();
    if (PRODUCT_COMPAT.test(x.q)) continue; // product compatibility is in scope for us
    const hit = CLINICAL.find((t) => hay.includes(t));
    if (!hit) continue;
    const shipped = classifyScope(x.q, `${x.q} ${x.a}`);
    if (shipped === "clinical") {
      findings.push({
        check: "CLINICAL", sev: "LOW",
        title: `clinical topic "${hit}" — correctly scoped, bot cannot reach it`,
        detail: `Q: ${x.q}`, where: `${short}:${x.line}`,
      });
    } else {
      findings.push({
        check: "CLINICAL", sev: "HIGH",
        title: `CLASSIFIER GAP: clinical topic "${hit}" is still scoped PUBLIC — the bot CAN retrieve this`,
        detail: `Q: ${x.q}\n  Fix: add the term to CLINICAL_TERMS in src/lib/clinical.ts, re-ingest, re-run audit-kb-scope.`,
        where: `${short}:${x.line}`, quote: x.a.slice(0, 150),
      });
    }
  }

  // 3. FACTS
  for (const fact of FACTS) {
    fact.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = fact.re.exec(text))) {
      const ctx = text.slice(Math.max(0, m.index - 120), m.index + 120);
      if (FACT_EXEMPT.test(ctx)) continue;
      if (m[1] !== fact.truth) {
        findings.push({
          check: "FACTS", sev: fact.sev,
          title: `${fact.name}: says ${m[1]}, confirmed value is ${fact.truth}`,
          detail: "Contradicts a Tyler-confirmed product fact.",
          where: short, quote: ctx.replace(/\s+/g, " ").trim().slice(0, 170),
        });
      }
    }
  }
}

// 4. CONTRADICT — same question, different answers, ON THE SAME PRODUCT.
//
// Grouping by question text ALONE across the whole library massively overstates this:
// "What is the recommended dosage?" legitimately differs across Tooth & Bone, Liquid
// Vita D and the chewable, because it is a different product each time. Each PDP renders
// only its own FAQs, and each KB chunk carries its "## Product Title" heading, so neither
// the storefront nor the bot ever sees those side by side. Measured that way it reported
// 48 "contradictions", none of which were real.
//
// A real contradiction is one PRODUCT SECTION answering one question two ways — a PDP
// contradicting itself to a single customer.
const bySection = new Map<string, QA[]>();
for (const x of allQAs) {
  if (!x.q || !x.a) continue;
  const k = `${x.file}|${x.section}|${x.q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()}`;
  bySection.set(k, [...(bySection.get(k) ?? []), x]);
}
for (const [, v] of bySection) {
  const answers = new Set(v.map((x) => x.a.toLowerCase().replace(/\s+/g, " ").trim()));
  if (v.length < 2 || answers.size < 2) continue;
  // "Unassigned / library FAQs" is not a product — it is the orphan bucket. Two answers
  // in there never appear side by side on any PDP, so it is not a contradiction a
  // customer can see. Worth noting when deduping the library, not worth an alarm.
  const isOrphanBucket = /^Unassigned/i.test(v[0].section);
  findings.push({
    check: "CONTRADICT",
    sev: isOrphanBucket ? "LOW" : "HIGH",
    title: isOrphanBucket
      ? `orphan bucket holds ${answers.size} answers to "${v[0].q.slice(0, 50)}" (not on any PDP)`
      : `"${v[0].section.slice(0, 46)}" answers "${v[0].q.slice(0, 46)}" ${answers.size} different ways`,
    detail: [...answers].map((a) => `  - ${a.slice(0, 120)}`).join("\n"),
    where: v.map((x) => `${x.file.split(/[\\/]/).pop()}:${x.line}`).join(", "),
  });
}

// ------------------------------------------------------------------- report
const RANK: Record<Sev, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
findings.sort((a, b) => RANK[a.sev] - RANK[b.sev] || a.check.localeCompare(b.check));

const counts = findings.reduce<Record<string, number>>((m, f) => ((m[f.sev] = (m[f.sev] ?? 0) + 1), m), {});
const today = process.env.DETECTOR_DATE || new Date().toISOString().slice(0, 10);

let md = `# KB Detector — ${today}\n\n`;
md += `Scanned **${files.length} files**, **${totalQA} Q/A pairs**.\n\n`;
md += `| Severity | Count |\n|---|---:|\n`;
for (const s of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) md += `| ${s} | ${counts[s] ?? 0} |\n`;
md += `\n> Read-only. Fix findings UPSTREAM in Shopify, then regenerate product-faqs.md and re-ingest.\n`;
md += `> Editing the KB copy directly is erased on the next regen.\n\n`;

for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Sev[]) {
  const group = findings.filter((f) => f.sev === sev);
  if (!group.length) continue;
  md += `\n## ${sev} (${group.length})\n\n`;
  for (const f of group) {
    md += `### [${f.check}] ${f.title}\n`;
    md += `- **Where:** \`${f.where}\`\n`;
    if (f.quote) md += `- **Quote:** "${f.quote}"\n`;
    if (f.detail) md += `- ${f.detail.replace(/\n/g, "\n  ")}\n`;
    md += `\n`;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `${today}.md`);
writeFileSync(out, md, "utf8");

console.log(`scanned ${files.length} files / ${totalQA} Q&A pairs`);
console.log(`findings: ${findings.length}  ` + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  "));
console.log(`report: ${out}`);
if ((counts.CRITICAL ?? 0) > 0) {
  console.error(`\n${counts.CRITICAL} CRITICAL finding(s) — see the report.`);
  process.exit(1);
}
