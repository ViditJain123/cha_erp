import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberKey, type CorpusType } from './corpus.js';
import { embed } from './indexer.js';

/**
 * The pgvector backend: public.reference_chunks in the hosted Supabase project
 * (migration 20260914000001). Talks to PostgREST with plain fetch so the
 * library needs no Supabase client; the service-role key is required for
 * writes and is what the CLIs use for reads too.
 */

export interface ReferenceChunkRow {
  source_type: CorpusType;
  source_id: number;
  number: string | null;
  number_key: string | null;
  doc_date: string | null;
  category: string | null;
  title: string;
  source_url: string | null;
  page: number;
  chunk_no: number;
  text: string;
  text_hash: string;
  is_current: boolean;
  is_amended: boolean;
  /** pgvector text form, "[0.1,0.2,...]". */
  embedding: string;
}

export interface ReferenceHit {
  sourceType: string;
  sourceId: number;
  number: string | null;
  date: string | null;
  category: string | null;
  title: string;
  page: number;
  snippet: string;
  text: string;
  sourceUrl: string;
  isCurrent: boolean;
  /** 'number' for an exact number match, else cosine similarity from pgvector. */
  match: 'number' | 'vector';
  score: number;
}

/** Loads the repo's .env.local for CLI runs (real env vars win), like @checklist/config/load-env. */
export function loadRepoEnv(): void {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(dir, '.env.local');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function restEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return { url: url.replace(/\/$/, ''), key };
}

export function referenceBackendConfigured(): boolean {
  return Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function rest<T>(pathAndQuery: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const { url, key } = restEnv();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.prefer && { Prefer: init.prefer }),
        ...init.headers,
      },
    });
    if (res.ok) {
      const body = await res.text();
      return (body ? JSON.parse(body) : null) as T;
    }
    const detail = await res.text();
    // 5xx and 429 are worth a bounded retry; a 4xx is our mistake.
    if ((res.status >= 500 || res.status === 429) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`PostgREST ${res.status} on ${pathAndQuery.split('?')[0]}: ${detail.slice(0, 500)}`);
  }
}

export function textHash(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toPrecision(6) : '0')).join(',')}]`;
}

export async function upsertReferenceChunks(rows: ReferenceChunkRow[]): Promise<void> {
  if (!rows.length) return;
  await rest('reference_chunks?on_conflict=source_type,source_id,page,chunk_no', {
    method: 'POST',
    body: JSON.stringify(rows),
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/** Removes every chunk of one document, before it is re-indexed with a different shape. */
export async function deleteReferenceDoc(type: CorpusType, sourceId: number): Promise<void> {
  await rest(`reference_chunks?source_type=eq.${type}&source_id=eq.${sourceId}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
}

/** source_id -> "page:chunk" -> text_hash, for one type. Keyset-paged. */
export async function existingChunkHashes(type: CorpusType): Promise<Map<number, Map<string, string>>> {
  const out = new Map<number, Map<string, string>>();
  let after = 0;
  for (;;) {
    const rows = await rest<{ id: number; source_id: number; page: number; chunk_no: number; text_hash: string }[]>(
      `reference_chunks?select=id,source_id,page,chunk_no,text_hash&source_type=eq.${type}&id=gt.${after}&order=id&limit=1000`,
    );
    for (const r of rows) {
      if (!out.has(r.source_id)) out.set(r.source_id, new Map());
      out.get(r.source_id)!.set(`${r.page}:${r.chunk_no}`, r.text_hash);
    }
    if (rows.length < 1000) return out;
    after = rows[rows.length - 1]!.id;
  }
}

export interface ReferenceStats {
  source_type: string;
  chunks: number;
  documents: number;
  database_bytes: number;
}

export async function referenceStats(): Promise<ReferenceStats[]> {
  return rest<ReferenceStats[]>('rpc/reference_chunks_stats', { method: 'POST', body: '{}' });
}

/* ---------------- search ---------------- */

interface ChunkSelect {
  source_type: string;
  source_id: number;
  number: string | null;
  doc_date: string | null;
  category: string | null;
  title: string;
  source_url: string | null;
  page: number;
  chunk_no: number;
  text: string;
  is_current: boolean;
  similarity?: number;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'under', 'into', 'what', 'which', 'notification']);

/** A window of the text around the first query term it contains. */
export function snippetFor(text: string, query: string, width = 320): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9/.]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .sort((a, b) => b.length - a.length);
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t);
    if (at >= 0) break;
  }
  if (at < 0) return flat.slice(0, width) + (flat.length > width ? '…' : '');
  const start = Math.max(0, at - Math.floor(width / 3));
  return (start > 0 ? '…' : '') + flat.slice(start, start + width) + (start + width < flat.length ? '…' : '');
}

function toHit(c: ChunkSelect, query: string, match: 'number' | 'vector', score: number): ReferenceHit {
  return {
    sourceType: c.source_type,
    sourceId: c.source_id,
    number: c.number,
    date: c.doc_date,
    category: c.category,
    title: c.title,
    page: c.page,
    snippet: snippetFor(c.text, query),
    text: c.text,
    sourceUrl: c.source_url ?? '',
    isCurrent: c.is_current,
    match,
    score,
  };
}

/**
 * How well a document's printed number fits the way the query wrote it:
 * "72/2026-Customs (N.T.)" should beat "72/2026-Central Tax" for a query that
 * says N.T., and Customs should beat other levies when the query says nothing.
 */
function numberFit(number: string | null, query: string): number {
  const n = (number ?? '').toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  const nt = /n\.?\s?t\.?\b/;
  if (nt.test(q)) score += nt.test(n) ? 4 : -2;
  else if (nt.test(n)) score -= 1;
  if (/\badd\b|anti.?dumping/.test(q)) score += /add/.test(n) ? 3 : -1;
  if (/\bcus|customs/.test(n)) score += 2;
  if (!/central tax|integrated tax|ut tax|cess|service tax/.test(q) && /central tax|ut tax|-st\b/.test(n)) score -= 2;
  return score;
}

const LEXICAL_BONUS = 0.1;

/** All-caps tokens of 3+ characters ("IGCR", "EPCG", "IGST"), the words worth matching literally. */
function identifierTerms(query: string): string[] {
  const found = query.match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? [];
  return [...new Set(found)].filter((t) => !/^\d+$/.test(t)).slice(0, 3);
}

function parseVector(literal: string): number[] {
  return JSON.parse(literal) as number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    na += a[i]! * a[i]!;
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const SELECT = 'source_type,source_id,number,doc_date,category,title,source_url,page,chunk_no,text,is_current';

/**
 * Exact number lookup first, then vector search. A query that names a number
 * ("72/2026", "notification 50/2017 serial 404") gets that document's opening
 * chunk as the first hits; the remaining slots are filled by similarity.
 */
export async function searchReference(
  query: string,
  opts?: { topK?: number; types?: CorpusType[] | undefined; onlyCurrent?: boolean },
): Promise<ReferenceHit[]> {
  const topK = opts?.topK ?? 8;
  const hits: ReferenceHit[] = [];
  const seen = new Set<string>();
  const typeFilter = opts?.types?.length ? `&source_type=in.(${opts.types.join(',')})` : '';

  const key = numberKey(query);
  if (key) {
    const rows = await rest<ChunkSelect[]>(
      `reference_chunks?select=${SELECT}&number_key=eq.${encodeURIComponent(key)}${typeFilter}` +
        `${opts?.onlyCurrent ? '&is_current=is.true' : ''}&chunk_no=eq.0&order=source_id,page&limit=500`,
    );
    // The first chunk of each matching document stands for it.
    const firsts = new Map<string, ChunkSelect>();
    for (const r of rows) if (!firsts.has(`${r.source_type}:${r.source_id}`)) firsts.set(`${r.source_type}:${r.source_id}`, r);
    [...firsts.values()]
      .map((r) => ({ r, fit: numberFit(r.number, query) + (r.is_current ? 1 : 0) }))
      .sort((a, b) => b.fit - a.fit || (b.r.doc_date ?? '').localeCompare(a.r.doc_date ?? ''))
      .slice(0, Math.max(1, Math.ceil(topK / 2)))
      .forEach(({ r }) => {
        seen.add(`${r.source_type}:${r.source_id}:${r.page}:${r.chunk_no}`);
        hits.push(toHit(r, query, 'number', 1));
      });
  }

  const [qv] = await embed([query]);
  if (!qv) return hits.slice(0, topK);
  const vectorRows = rest<ChunkSelect[]>('rpc/match_reference_chunks', {
    method: 'POST',
    body: JSON.stringify({
      query_embedding: toVectorLiteral(qv),
      match_count: Math.min(100, topK * 4),
      source_types: opts?.types?.length ? opts.types : null,
      only_current: opts?.onlyCurrent ?? false,
    }),
  });

  // Similarity alone is weak on short identifier queries: "IGCR condition 3"
  // embeds close to every exemption condition in the archive, and the IGCR
  // Rules lose to them. Terms that look like identifiers (IGCR, EPCG, SVB,
  // CAROTAR) are also matched literally, scored by the same cosine computed
  // here, and given a bonus for containing the term.
  const terms = identifierTerms(query);
  const lexicalRows = terms.length
    ? rest<(ChunkSelect & { embedding: string })[]>(
        `reference_chunks?select=${SELECT},embedding${typeFilter}` +
          `${opts?.onlyCurrent ? '&is_current=is.true' : ''}` +
          terms.map((t) => `&text=match.${encodeURIComponent(`\\y${t}\\y`)}`).join('') +
          '&limit=200',
      ).catch(() => [])
    : Promise.resolve([]);

  const candidates = new Map<string, { row: ChunkSelect; score: number }>();
  for (const r of await vectorRows) {
    candidates.set(`${r.source_type}:${r.source_id}:${r.page}:${r.chunk_no}`, { row: r, score: r.similarity ?? 0 });
  }
  for (const r of await lexicalRows) {
    const id = `${r.source_type}:${r.source_id}:${r.page}:${r.chunk_no}`;
    const sim = candidates.get(id)?.score ?? cosine(qv, parseVector(r.embedding));
    candidates.set(id, { row: r, score: sim + LEXICAL_BONUS });
  }

  // At most two chunks per document, so one long notification cannot fill the page.
  const perDoc = new Map<string, number>();
  for (const { row, score } of [...candidates.values()].sort((a, b) => b.score - a.score)) {
    const id = `${row.source_type}:${row.source_id}:${row.page}:${row.chunk_no}`;
    const doc = `${row.source_type}:${row.source_id}`;
    if (seen.has(id) || (perDoc.get(doc) ?? 0) >= 2) continue;
    seen.add(id);
    perDoc.set(doc, (perDoc.get(doc) ?? 0) + 1);
    hits.push(toHit(row, query, 'vector', score));
    if (hits.length >= topK) break;
  }
  return hits.slice(0, topK);
}
