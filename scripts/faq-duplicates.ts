/**
 * Near-duplicate detection over the live Shopify FAQ library.
 *
 *   npx tsx scripts/faq-duplicates.ts                 # report duplicate clusters
 *   npx tsx scripts/faq-duplicates.ts --assign-check  # verify the held ASSIGN_NEW decisions
 *
 * WHY THIS EXISTS. The first pass matched questions by exact normalized text and
 * silently missed real duplicates: orphan 187196604694 "Is tooth powder safe to
 * swallow?" vs live 133497618710 "Is the Tooth Powder safe to swallow?" differ only
 * by the word "the". The review agents caught it and correctly refused to trust
 * "no live FAQ covers this" — which is exactly the signal an ASSIGN_NEW decision
 * rests on. Assigning on a bad signal creates duplicate FAQs on a PDP, which is the
 * very thing this whole cleanup is trying to undo.
 *
 * Fix: compare content-word SETS (stopwords stripped, light stemming) with Jaccard
 * similarity, not string equality.
 */
import { readFileSync } from "fs";

const SHOP = "livingwellwithdrmichelle.myshopify.com";
const API = `https://${SHOP}/admin/api/2025-07/graphql.json`;

function token(): string {
  const env = readFileSync("C:/Users/tycol/Desktop/tc-desk/.env", "utf8");
  const l = env.split(/\r?\n/).find((x) => x.startsWith("SHOPIFY_TOKEN_LIVING_WELL_CONTENT="));
  if (!l) throw new Error("SHOPIFY_TOKEN_LIVING_WELL_CONTENT missing");
  return l.split("=")[1].trim().replace(/^["']|["']$/g, "");
}
const TOK = token();

async function gql<T = any>(query: string, variables: any = {}): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOK, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const d = await r.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 300));
  return d.data;
}

// TRUE function words only. Do NOT strip interrogatives (what/how/who/when/why) or
// action verbs (use/take/long/safe) — those ARE the question's meaning. Stripping them
// made "What is the Gut Reset Protocol?" and "How do I use the Gut Reset Protocol?"
// both collapse to {gut,reset,protocol} and match at 1.00, which manufactured fake
// conflicts on every product whose name dominates its short questions.
const STOP = new Set([
  "a","an","the","is","it","do","does","did","i","in","of","to","for","and","or","my","your","our",
  "this","that","these","those","are","be","been","can","could","will","would","should","with","if",
  "on","at","by","from","as","you","we","they","me","am","was","were","has","have","had","there",
]);

/** crude but effective stemmer for FAQ-speak: plurals + -ing/-ed */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

export function tokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w))
      .map(stem),
  );
}

/**
 * One-word modifiers that CHANGE the question, not decorate it.
 * "How do I use it?" (method) vs "How often should I use it?" (frequency) are different
 * questions with different correct answers — but they differ by a single token out of
 * five, so plain Jaccard scores them 0.80 and calls them duplicates. That single false
 * pattern accounted for ALL 11 apparent same-product conflicts in the library.
 * If one side has a modifier and the other doesn't, they are not the same question.
 */
const MODIFIERS = new Set([
  "often", "long", "much", "many", "frequently", "soon", "old", "first", "before", "after",
]);

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  // A modifier on exactly one side flips the question's meaning.
  for (const m of MODIFIERS) if (a.has(m) !== b.has(m)) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function flat(rt: string | null | undefined): string {
  if (!rt) return "";
  let d: any;
  try { d = JSON.parse(rt); } catch { return rt; }
  const out: string[] = [];
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (n.type === "text" && typeof n.value === "string") out.push(n.value);
      (n.children ?? []).forEach(walk);
    }
  };
  walk(d);
  return out.join(" ").split(/\s+/).join(" ").trim();
}

type Node = { id: string; handle: string; q: string; a: string };

async function load() {
  const nodes = new Map<string, Node>();
  let cur: string | null = null;
  for (;;) {
    const d: any = await gql(
      `query P($c:String){ metaobjects(type:"faqs", first:250, after:$c){
         pageInfo{hasNextPage endCursor} edges{node{id handle fields{key value}}} } }`,
      { c: cur },
    );
    for (const e of d.metaobjects.edges) {
      const f = Object.fromEntries(e.node.fields.map((x: any) => [x.key, x.value]));
      const id = e.node.id.split("/").pop()!;
      nodes.set(id, { id, handle: e.node.handle, q: (f.question ?? "").trim(), a: flat(f.answer) });
    }
    if (!d.metaobjects.pageInfo.hasNextPage) break;
    cur = d.metaobjects.pageInfo.endCursor;
  }

  const products = new Map<string, { title: string; ids: string[] }>();
  cur = null;
  for (;;) {
    const d: any = await gql(
      `query P($c:String){ products(first:250, after:$c){
         pageInfo{hasNextPage endCursor}
         edges{node{title status metafield(namespace:"custom", key:"product_faq"){value}}} } }`,
      { c: cur },
    );
    for (const e of d.products.edges) {
      const n = e.node;
      if (n.status !== "ACTIVE" && n.status !== "UNLISTED") continue;
      const v = n.metafield?.value;
      if (!v) continue;
      products.set(n.title, { title: n.title, ids: (JSON.parse(v) as string[]).map((g) => g.split("/").pop()!) });
    }
    if (!d.products.pageInfo.hasNextPage) break;
    cur = d.products.pageInfo.endCursor;
  }
  return { nodes, products };
}

// The 5 ASSIGN_NEW decisions the agent review confirmed but I held back pending this check.
const HELD: { orphan: string; products: string[] }[] = [
  { orphan: "183338434838", products: ["Professional Strength Gum Health Remineralizing Tooth Powder"] },
  { orphan: "187196375318", products: ["Remineralizing Tooth Powder", "Remineralizing Tooth Powder – 1 Year Supply", "Whitening & Remineralizing Tooth Powder (Cool Mint)", "Whitening & Remineralizing Tooth Powder - 1 Year Supply", "Sensitive Remineralizing Tooth Powder", "Sensitive Remineralizing Tooth Powder - 1 Year Supply", "Kids Tooth Powder (Fresh Citrus)", "Kids Tooth Powder - 1 Year Supply", "Professional Strength Gum Health Remineralizing Tooth Powder"] },
  { orphan: "187196473622", products: ["Remineralizing Tooth Powder", "Remineralizing Tooth Powder – 1 Year Supply", "Whitening & Remineralizing Tooth Powder (Cool Mint)", "Whitening & Remineralizing Tooth Powder - 1 Year Supply", "Sensitive Remineralizing Tooth Powder", "Sensitive Remineralizing Tooth Powder - 1 Year Supply", "Kids Tooth Powder (Fresh Citrus)", "Kids Tooth Powder - 1 Year Supply", "Professional Strength Gum Health Remineralizing Tooth Powder"] },
  { orphan: "187196571926", products: ["Kids Tooth Powder (Fresh Citrus)", "Kids Tooth Powder - 1 Year Supply"] },
  { orphan: "185219744022", products: ["Remineralizing Toothpaste – Hydroxyapatite + PROtektin™", "Remineralizing Toothpaste – 1 Year Supply"] },
];

const DUP = 0.75; // question token-set similarity above this = already answered

async function main() {
  const { nodes, products } = await load();
  const mode = process.argv.includes("--assign-check") ? "assign" : "report";

  // sanity: the case that proved the old matcher wrong must now be caught
  const a = nodes.get("187196604694"), b = nodes.get("133497618710");
  if (a && b) {
    const s = jaccard(tokens(a.q), tokens(b.q));
    console.log(`regression probe — the pair the old matcher missed:`);
    console.log(`  "${a.q}"`);
    console.log(`  "${b.q}"`);
    console.log(`  similarity ${s.toFixed(2)} -> ${s >= DUP ? "CAUGHT (fixed)" : "STILL MISSED (bad)"}\n`);
  }

  if (mode === "assign") {
    console.log("=".repeat(74));
    console.log("ASSIGN-CHECK: would these create a duplicate on the target PDP?");
    console.log("=".repeat(74));
    let unsafe = 0;
    for (const h of HELD) {
      const o = nodes.get(h.orphan);
      if (!o) { console.log(`\n${h.orphan}: NOT FOUND`); continue; }
      console.log(`\n${h.orphan}  "${o.q}"`);
      const ot = tokens(o.q);
      for (const title of h.products) {
        const p = products.get(title);
        if (!p) { console.log(`   ?? product not found: ${title}`); unsafe++; continue; }
        // Already assigned? Then this run is a no-op, not a duplicate. Without this the
        // check reports every successful assignment as a 1.00 "duplicate" against itself.
        if (p.ids.includes(h.orphan)) {
          console.log(`   done     ----  ${title.slice(0, 52)}  (already assigned)`);
          continue;
        }
        let best = { id: "", q: "", s: 0 };
        for (const id of p.ids) {
          if (id === h.orphan) continue; // never compare an orphan to itself
          const n = nodes.get(id);
          if (!n) continue;
          const s = jaccard(ot, tokens(n.q));
          if (s > best.s) best = { id, q: n.q, s };
        }
        const dup = best.s >= DUP;
        if (dup) unsafe++;
        console.log(
          `   ${dup ? "DUPLICATE" : "clear    "} ${best.s.toFixed(2)}  ${title.slice(0, 52)}`,
        );
        if (dup) console.log(`             ^ already has ${best.id}: "${best.q}"`);
      }
    }
    console.log(
      `\n${unsafe === 0 ? "All targets clear — assigning would not duplicate." : `${unsafe} target(s) would DUPLICATE an existing FAQ.`}`,
    );
    return;
  }

  // ---- report mode ----
  // Clustering by question text ALONE overstates the problem badly. "What is the
  // recommended dosage?" has 8 versions because it is asked of 8 DIFFERENT products
  // (Tooth & Bone, Liquid Vita D, the chewable, Gut Well...). Those SHOULD differ.
  // A real conflict is: same question, different answers, and BOTH LIVE ON THE SAME
  // PRODUCT — that is a PDP contradicting itself in front of one customer.
  const onProduct = new Map<string, Set<string>>(); // faq id -> product titles
  for (const [title, p] of products) {
    for (const id of p.ids) {
      if (!onProduct.has(id)) onProduct.set(id, new Set());
      onProduct.get(id)!.add(title);
    }
  }

  const ids = [...nodes.keys()].filter((i) => nodes.get(i)!.q);
  const toks = new Map(ids.map((i) => [i, tokens(nodes.get(i)!.q)]));
  const seen = new Set<string>();
  const clusters: string[][] = [];
  for (const i of ids) {
    if (seen.has(i)) continue;
    const group = [i];
    for (const j of ids) {
      if (j === i || seen.has(j)) continue;
      if (jaccard(toks.get(i)!, toks.get(j)!) >= DUP) { group.push(j); seen.add(j); }
    }
    seen.add(i);
    if (group.length > 1) clusters.push(group);
  }

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const divergent = clusters.filter((g) => new Set(g.map((i) => norm(nodes.get(i)!.a))).size > 1);

  // The ones that actually hurt: two divergent answers sharing a live product.
  type Conflict = { product: string; q: string; versions: { id: string; a: string }[] };
  const conflicts: Conflict[] = [];
  for (const g of divergent) {
    const byProduct = new Map<string, string[]>();
    for (const i of g) {
      for (const t of onProduct.get(i) ?? []) {
        byProduct.set(t, [...(byProduct.get(t) ?? []), i]);
      }
    }
    for (const [title, members] of byProduct) {
      if (members.length < 2) continue;
      if (new Set(members.map((i) => norm(nodes.get(i)!.a))).size < 2) continue;
      conflicts.push({
        product: title,
        q: nodes.get(members[0])!.q,
        versions: members.map((i) => ({ id: i, a: nodes.get(i)!.a })),
      });
    }
  }

  console.log(`near-duplicate question clusters:            ${clusters.length}`);
  console.log(`...with diverging answers:                   ${divergent.length}`);
  console.log(`...that a SINGLE PRODUCT shows at once:      ${conflicts.length}  <-- the real problem\n`);
  console.log("A cluster spanning different products is usually legitimate: the same question");
  console.log("asked of different products SHOULD get different answers. Only a product that");
  console.log("carries two conflicting answers to one question is contradicting itself.\n");

  conflicts.sort((a, b) => b.versions.length - a.versions.length);
  for (const c of conflicts) {
    console.log("=".repeat(74));
    console.log(`PRODUCT: ${c.product}`);
    console.log(`Q: ${c.q}`);
    for (const v of c.versions) console.log(`   ${v.id}  ${v.a.slice(0, 150)}`);
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
