// Ingests knowledge-base markdown into KbChunk rows for one inbox.
// Re-runnable: wipes and reloads all chunks for the brand each run, so the KB
// always mirrors the source folder (stale KB = wrong bot answers).
//
// Usage: npx tsx scripts/ingest-kb.ts <brand> <folder> [...more folders]
// e.g.:  npx tsx scripts/ingest-kb.ts living-well "C:/.../kb-source"
import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { classifyScope } from "../src/lib/clinical";

const env = readFileSync(`${__dirname}/../.env`, "utf8");
for (const k of ["DATABASE_URL", "DIRECT_URL"]) {
  const m = env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"));
  if (m) process.env[k] = m[1];
}

const MAX_CHUNK = 3500; // chars — comfortably a few paragraphs
const MIN_CHUNK = 80; // skip crumbs

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(md|txt)$/i.test(name)) yield p;
  }
}

/** Split markdown into heading-bounded chunks, merging small ones. */
function chunk(md: string): { title: string | null; content: string }[] {
  const lines = md.split(/\r?\n/);
  const sections: { title: string | null; body: string[] }[] = [{ title: null, body: [] }];
  for (const line of lines) {
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) sections.push({ title: h[1].trim(), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  const out: { title: string | null; content: string }[] = [];
  for (const s of sections) {
    let text = s.body.join("\n").trim();
    if (!text && !s.title) continue;
    // Large sections get split on blank lines.
    while (text.length > MAX_CHUNK) {
      let cut = text.lastIndexOf("\n\n", MAX_CHUNK);
      if (cut < MAX_CHUNK / 2) cut = MAX_CHUNK;
      out.push({ title: s.title, content: text.slice(0, cut).trim() });
      text = text.slice(cut).trim();
    }
    if (text.length >= MIN_CHUNK) out.push({ title: s.title, content: text });
    else if (text && out.length && out[out.length - 1].title === s.title) {
      out[out.length - 1].content += "\n" + text;
    }
  }
  return out;
}

async function main() {
  const [brand, ...folders] = process.argv.slice(2);
  if (!brand || folders.length === 0) {
    console.error("usage: tsx scripts/ingest-kb.ts <brand> <folder> [...folders]");
    process.exit(1);
  }
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const inbox = await db.inbox.findUnique({ where: { brand } });
  if (!inbox) throw new Error(`inbox '${brand}' not found`);

  const rows: { source: string; title: string | null; content: string; scope: string }[] = [];
  for (const folder of folders) {
    for (const file of walk(folder)) {
      const md = readFileSync(file, "utf8");
      const source = basename(file);
      for (const c of chunk(md)) {
        // Clinical scoping is Living Well ONLY — that KB merges Dr. Michelle's
        // dental-PRACTICE FAQ (root canals, implants, ozone...) which the
        // storefront bot must not speak. Other brands (e.g. Longer Together, a
        // pet dental-supplement store) have no practice half, and their normal
        // product vocabulary ("gum health", "plaque", "extraction") would be
        // wrongly hidden by the classifier. Everything non-LW is public.
        const scope = brand === "living-well" ? classifyScope(c.title, c.content) : "public";
        rows.push({ source, ...c, scope });
      }
    }
  }

  // Wipe ONLY machine-ingested chunks. Human corrections authored via the KB
  // Trainer (origin = 'trainer') are permanent and survive every re-ingest —
  // otherwise the team's training would be blown away on the next reload.
  const del = await db.kbChunk.deleteMany({ where: { inboxId: inbox.id, origin: "ingest" } });
  await db.kbChunk.createMany({
    data: rows.map((r) => ({
      inboxId: inbox.id, source: r.source, title: r.title, content: r.content, scope: r.scope,
      origin: "ingest",
    })),
  });
  const kept = await db.kbChunk.count({ where: { inboxId: inbox.id, origin: "trainer" } });
  const clinical = rows.filter((r) => r.scope === "clinical").length;
  console.log(`[ingest] ${brand}: replaced ${del.count} ingested chunks with ${rows.length} from ${folders.length} folder(s)`);
  console.log(`[ingest] scope: ${rows.length - clinical} public / ${clinical} clinical (clinical is hidden from the customer bot)`);
  console.log(`[ingest] preserved ${kept} trainer-authored correction(s) (never wiped)`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
