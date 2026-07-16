import { db } from "@/lib/db";

// Knowledge-base retrieval for the chat bot. v1 uses Postgres full-text
// search (websearch syntax + rank); the KbChunk.embedding pgvector column is
// reserved for a semantic upgrade without a schema change.
//
// SCOPE: the KB is a merge of e-commerce support AND Dr. Michelle's dental-practice
// FAQ (root canals, implants, cavitations, ozone, cone beam CT...). Chunks are tagged
// at ingest by src/lib/clinical.ts. The storefront bot must NEVER retrieve the clinical
// half. A prompt rule alone was not enough: the grounding rule ("answer only from
// search_kb results") meant that whenever the KB returned a clinical answer, retrieval
// effectively read as permission to give it.
//
// Clinical content is EXCLUDED BY DEFAULT — a caller must opt in explicitly. That way a
// future caller that never thinks about scope is safe rather than leaky. As of now the
// ONLY legitimate opt-in is the internal agent copilot (/api/agent-assist).

export type KbHit = { id: string; source: string; title: string | null; content: string; rank: number };

export type SearchOpts = {
  limit?: number;
  /** Include clinical chunks. Internal agent copilot ONLY — never the customer widget. */
  includeClinical?: boolean;
};

async function ftsQuery(
  inboxId: string,
  tsquery: string,
  limit: number,
  includeClinical: boolean,
): Promise<KbHit[]> {
  return db.$queryRaw<KbHit[]>`
    SELECT id, source, title, content,
           ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || content),
                   websearch_to_tsquery('english', ${tsquery})) AS rank
    FROM "KbChunk"
    WHERE "inboxId" = ${inboxId}
      AND (${includeClinical}::boolean OR "scope" = 'public')
      AND to_tsvector('english', coalesce(title,'') || ' ' || content)
          @@ websearch_to_tsquery('english', ${tsquery})
    ORDER BY rank DESC
    LIMIT ${limit}
  `;
}

export async function searchKb(
  inboxId: string,
  query: string,
  opts: SearchOpts = {},
): Promise<KbHit[]> {
  const limit = opts.limit ?? 6;
  const includeClinical = opts.includeClinical === true; // default-deny
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  // websearch syntax ANDs terms — great precision, but zero results on long
  // queries. Fall back to OR-of-terms so the bot always has something to rank.
  let rows = await ftsQuery(inboxId, q, limit, includeClinical);
  if (rows.length === 0) {
    const orQuery = q
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8)
      .join(" OR ");
    if (orQuery) rows = await ftsQuery(inboxId, orQuery, limit, includeClinical);
  }
  return rows;
}
