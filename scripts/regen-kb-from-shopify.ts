/**
 * Regenerate kb-source/shopify/product-faqs.md from LIVE Shopify.
 *
 *   npx tsx scripts/regen-kb-from-shopify.ts
 *
 * Uses SHOPIFY_TOKEN_LIVING_WELL_CONTENT (read_metaobjects + read_products), minted
 * 2026-07-16 for the "Customer Service FAQ" Dev Dashboard app. The older
 * SHOPIFY_TOKEN_LIVING_WELL has NO read_metaobjects and cannot do this.
 *
 * THE DERIVED FILE IS NEVER HAND-EDITED. Fix the Shopify metaobject, run this, re-ingest.
 * A hand edit here looks fixed, leaves the storefront wrong, and is erased on the next run.
 */
import { readFileSync, writeFileSync } from "fs";

const SHOP = "livingwellwithdrmichelle.myshopify.com";
const API = `https://${SHOP}/admin/api/2025-07/graphql.json`;
const PROJ = "C:/Users/tycol/Desktop/Living Well with Dr. Michelle Claude";
const OUT = `${PROJ}/workflows/customer-service-system/kb-source/shopify/product-faqs.md`;

function token(): string {
  const env = readFileSync("C:/Users/tycol/Desktop/tc-desk/.env", "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("SHOPIFY_TOKEN_LIVING_WELL_CONTENT="));
  if (!line) throw new Error("SHOPIFY_TOKEN_LIVING_WELL_CONTENT missing from .env");
  return line.split("=")[1].trim().replace(/^["']|["']$/g, "");
}
const TOK = token();

async function gql<T = any>(query: string, variables: any = {}): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOK, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const d = await r.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 400));
  return d.data;
}

/** Shopify rich-text JSON -> plain text */
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

async function main() {
  // ---- 1. the whole faqs metaobject library
  const nodes = new Map<string, { handle: string; q: string; a: string }>();
  let cur: string | null = null;
  for (;;) {
    const d: any = await gql(
      `query P($c:String){ metaobjects(type:"faqs", first:250, after:$c){
         pageInfo{hasNextPage endCursor} edges{node{id handle fields{key value}}} } }`,
      { c: cur },
    );
    for (const e of d.metaobjects.edges) {
      const f = Object.fromEntries(e.node.fields.map((x: any) => [x.key, x.value]));
      nodes.set(e.node.id.split("/").pop()!, {
        handle: e.node.handle,
        q: (f.question ?? "").trim(),
        a: flat(f.answer),
      });
    }
    if (!d.metaobjects.pageInfo.hasNextPage) break;
    cur = d.metaobjects.pageInfo.endCursor;
  }

  // ---- 2. products + their FAQ assignments
  // ⚠️ Do NOT filter with query:"status:active" — it returns ACTIVE only (109) and drops the
  // 12 UNLISTED products (HCL Digest, Gut Rebuild, The Living Well Discovery Box...).
  // UNLISTED = hidden from collections/search but STILL BUYABLE VIA DIRECT LINK, so their
  // FAQs render for real customers and belong in the bot KB. ARCHIVED/DRAFT do not.
  const prods: { handle: string; title: string; ids: string[] }[] = [];
  const byStatus: Record<string, number> = {};
  cur = null;
  for (;;) {
    const d: any = await gql(
      `query P($c:String){ products(first:250, after:$c){
         pageInfo{hasNextPage endCursor}
         edges{node{handle title status metafield(namespace:"custom", key:"product_faq"){value}}} } }`,
      { c: cur },
    );
    for (const e of d.products.edges) {
      const n = e.node;
      byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
      if (n.status !== "ACTIVE" && n.status !== "UNLISTED") continue;
      const v = n.metafield?.value;
      if (!v) continue;
      const ids = (JSON.parse(v) as string[]).map((g) => g.split("/").pop()!);
      if (ids.length) prods.push({ handle: n.handle, title: n.title, ids });
    }
    if (!d.products.pageInfo.hasNextPage) break;
    cur = d.products.pageInfo.endCursor;
  }

  // ---- 3. render
  const today = process.env.DETECTOR_DATE || new Date().toISOString().slice(0, 10);
  const L: string[] = [
    "# Product FAQs (Shopify metaobject library)",
    "",
    `> Source: Shopify metaobjects of type \`faqs\` on the Living Well with Dr. Michelle store, ` +
      `pulled via Admin GraphQL API on ${today}. ${nodes.size} FAQ entries total. Product ` +
      `assignments come from each live (ACTIVE or UNLISTED) product's \`custom.product_faq\` ` +
      `metafield, shown in referenced order. Answers are flattened from Shopify rich-text JSON.`,
    "",
    "> DERIVED FILE — DO NOT HAND-EDIT. Regenerate with `npx tsx scripts/regen-kb-from-shopify.ts`. " +
      "Hand edits are erased on the next run and leave the storefront wrong. Fix the Shopify " +
      "metaobject instead, then regenerate and re-ingest.",
    "",
  ];

  const used = new Set<string>();
  let qa = 0, dangling = 0;
  for (const p of prods) {
    L.push(`## ${p.title} (\`${p.handle}\`)`, "");
    for (const id of p.ids) {
      const n = nodes.get(id);
      if (!n) { dangling++; continue; }
      if (!n.q && !n.a) continue;
      L.push(`**Q:** ${n.q}`, "", `**A:** ${n.a}`, "");
      qa++; used.add(id);
    }
  }

  // FAQs in the library attached to no live product. Kept deliberately: several are
  // staged AEO content that is better than what is live. Purging them is a separate call.
  const orphans = [...nodes.keys()].filter((i) => !used.has(i));
  L.push("## Unassigned / library FAQs", "");
  for (const id of orphans) {
    const n = nodes.get(id)!;
    if (!n.q && !n.a) continue;
    L.push(`**Q:** ${n.q}`, "", `**A:** ${n.a}`, "");
    qa++;
  }

  writeFileSync(OUT, L.join("\n").replace(/\s+$/, "") + "\n", "utf8");
  console.log(`products by status: ${JSON.stringify(byStatus)}`);
  console.log(`FAQ library: ${nodes.size}   live products with FAQs: ${prods.length}`);
  console.log(`wrote ${OUT}`);
  console.log(`  product sections: ${prods.length}   orphans kept: ${orphans.length}   Q/A: ${qa}   dangling: ${dangling}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
