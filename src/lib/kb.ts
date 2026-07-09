import { db } from "@/lib/db";

// Knowledge-base retrieval for the chat bot. v1 uses Postgres full-text
// search (websearch syntax + rank); the KbChunk.embedding pgvector column is
// reserved for a semantic upgrade without a schema change.

export type KbHit = { id: string; source: string; title: string | null; content: string; rank: number };

async function ftsQuery(inboxId: string, tsquery: string, limit: number): Promise<KbHit[]> {
  return db.$queryRaw<KbHit[]>`
    SELECT id, source, title, content,
           ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || content),
                   websearch_to_tsquery('english', ${tsquery})) AS rank
    FROM "KbChunk"
    WHERE "inboxId" = ${inboxId}
      AND to_tsvector('english', coalesce(title,'') || ' ' || content)
          @@ websearch_to_tsquery('english', ${tsquery})
    ORDER BY rank DESC
    LIMIT ${limit}
  `;
}

export async function searchKb(inboxId: string, query: string, limit = 6): Promise<KbHit[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  // websearch syntax ANDs terms — great precision, but zero results on long
  // queries. Fall back to OR-of-terms so the bot always has something to rank.
  let rows = await ftsQuery(inboxId, q, limit);
  if (rows.length === 0) {
    const orQuery = q
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8)
      .join(" OR ");
    if (orQuery) rows = await ftsQuery(inboxId, orQuery, limit);
  }
  return rows;
}
