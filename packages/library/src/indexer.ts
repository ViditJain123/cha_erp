import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import OpenAI from 'openai';
import {
  getDoc,
  indexDir,
  listDocs,
  readDocPdf,
  saveTextDocMeta,
  updateDocMeta,
  type LibraryDocMeta,
} from './store.js';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

export interface Chunk {
  docId: string;
  page: number;
  text: string;
  /**
   * The notification this chunk is text of, e.g. "045/2025", where the source
   * says. It lets a question that already knows its notification — and the
   * printed tariff names one for most tariff lines — read that notification
   * rather than search the whole library for text that merely looks similar.
   */
  notification?: string;
}

let _client: OpenAI | undefined;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    // Long corpus runs meet 429s; the SDK backs off between these retries.
    _client = new OpenAI({ maxRetries: 8 });
  }
  return _client;
}

function chunksPath() {
  return path.join(indexDir(), 'chunks.jsonl');
}
function vectorsPath() {
  return path.join(indexDir(), 'embeddings.f32');
}
function metaPath() {
  return path.join(indexDir(), 'meta.json');
}

/** Page-wise chunks; long pages split at ~3500 chars with a 200-char overlap. */
export function chunkPages(docId: string, pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const MAX = 3500;
  pages.forEach((raw, i) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.length < 40) return;
    for (let start = 0; start < text.length; start += MAX - 200) {
      const piece = text.slice(start, start + MAX);
      chunks.push({ docId, page: i + 1, text: piece });
      if (start + MAX >= text.length) break;
    }
  });
  return chunks;
}

export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  return text;
}

export async function embed(texts: string[]): Promise<number[][]> {
  return (await embedWithUsage(texts)).vectors;
}

/** Embeds in batches of 128 and reports the tokens OpenAI billed. */
export async function embedWithUsage(texts: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  const out: number[][] = [];
  let tokens = 0;
  const BATCH = 128;
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await client().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.slice(i, i + BATCH),
    });
    for (const d of res.data) out.push(d.embedding);
    tokens += res.usage?.total_tokens ?? 0;
  }
  return { vectors: out, tokens };
}

function appendToIndex(chunks: Chunk[], vectors: number[][]): void {
  mkdirSync(indexDir(), { recursive: true });
  const jsonl = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  appendFileSync(chunksPath(), jsonl);
  const f32 = new Float32Array(vectors.length * EMBEDDING_DIMS);
  vectors.forEach((v, i) => f32.set(v, i * EMBEDDING_DIMS));
  appendFileSync(vectorsPath(), Buffer.from(f32.buffer));
  const count = existsSync(metaPath())
    ? (JSON.parse(readFileSync(metaPath(), 'utf8')) as { count: number }).count + chunks.length
    : chunks.length;
  writeFileSync(metaPath(), JSON.stringify({ model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, count }));
}

export interface IndexResult {
  docId: string;
  status: 'indexed' | 'already-indexed' | 'no-text';
  chunks?: number;
  pages?: number;
}

/** Index one document (extract → chunk → embed → append). Idempotent per doc. */
export async function indexDoc(meta: LibraryDocMeta): Promise<IndexResult> {
  if (meta.indexedAt) return { docId: meta.id, status: 'already-indexed' };
  // Text-only documents were indexed from their text when they were added;
  // there is no PDF to extract, and reading one would throw.
  if (meta.textOnly) return { docId: meta.id, status: 'no-text' };
  const pages = await pdfPageTexts(readDocPdf(meta.id));
  const chunks = chunkPages(meta.id, pages);
  if (!chunks.length) return { docId: meta.id, status: 'no-text' };
  const vectors = await embed(chunks.map((c) => c.text));
  appendToIndex(chunks, vectors);
  updateDocMeta({ ...meta, pages: pages.length, indexedAt: new Date().toISOString() });
  return { docId: meta.id, status: 'indexed', chunks: chunks.length, pages: pages.length };
}

/**
 * Index a document from text already extracted, page by page.
 *
 * For sources where reading-order extraction is wrong: the printed tariff is a
 * scan whose text layer comes out in column blocks, so its text is produced by
 * coordinate in build-tariff-book.py and handed over here instead.
 */
export async function indexTextDoc(
  meta: LibraryDocMeta,
  pages: { page: number; text: string }[],
): Promise<IndexResult> {
  const existing = getDoc(meta.id);
  if (existing?.indexedAt) return { docId: meta.id, status: 'already-indexed' };
  const chunks = pages.flatMap(({ page, text }) =>
    chunkPages(meta.id, [text]).map((c) => ({
      ...c,
      page,
      ...(meta.notification && { notification: meta.notification }),
    })),
  );
  if (!chunks.length) return { docId: meta.id, status: 'no-text' };
  const vectors = await embed(chunks.map((c) => c.text));
  appendToIndex(chunks, vectors);
  saveTextDocMeta({ ...meta, pages: pages.length, indexedAt: new Date().toISOString() });
  return { docId: meta.id, status: 'indexed', chunks: chunks.length, pages: pages.length };
}

/** Index every fetched-but-unindexed document. */
export async function indexAllPending(onProgress?: (r: IndexResult) => void): Promise<IndexResult[]> {
  const results: IndexResult[] = [];
  for (const meta of listDocs()) {
    const r = await indexDoc(meta);
    results.push(r);
    onProgress?.(r);
  }
  return results;
}

/* ---------------- search ---------------- */

export interface SearchHit {
  docId: string;
  title: string;
  sourceUrl: string;
  page: number;
  text: string;
  notification?: string;
  score: number;
  /** Set by the pgvector backend: the document's printed number, date and a query-centred snippet. */
  number?: string | null;
  date?: string | null;
  snippet?: string;
  sourceType?: string;
  match?: 'number' | 'vector';
}

let cache: { chunks: Chunk[]; vectors: Float32Array; loadedCount: number } | undefined;

function loadIndex(): { chunks: Chunk[]; vectors: Float32Array } | null {
  if (!existsSync(chunksPath()) || !existsSync(vectorsPath())) return null;
  const metaCount = existsSync(metaPath())
    ? (JSON.parse(readFileSync(metaPath(), 'utf8')) as { count: number }).count
    : -1;
  if (cache && cache.loadedCount === metaCount) return cache;
  const chunks = readFileSync(chunksPath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Chunk);
  const buf = readFileSync(vectorsPath());
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  cache = { chunks, vectors, loadedCount: metaCount };
  return cache;
}

export async function searchLibrary(
  query: string,
  opts?: {
    topK?: number;
    docIdPrefix?: string;
    /** Only chunks of these notifications ("045/2025"). */
    notifications?: string[];
    /**
     * 'files' (default) is the flat-file library behind /legacy/library.
     * 'pgvector' searches the CBIC reference corpus in Supabase
     * (reference_chunks): exact number lookup first, then similarity.
     */
    backend?: 'files' | 'pgvector';
    /** pgvector only: restrict to these CBIC document types. */
    types?: import('./corpus.js').CorpusType[] | undefined;
  },
): Promise<SearchHit[]> {
  if (opts?.backend === 'pgvector') {
    // Imported lazily: reference.ts imports embed() from this module.
    const { searchReference } = await import('./reference.js');
    const hits = await searchReference(query, { topK: opts.topK ?? 6, types: opts.types });
    return hits.map((h) => ({
      docId: `${h.sourceType}:${h.sourceId}`,
      title: h.title,
      sourceUrl: h.sourceUrl,
      page: h.page,
      text: h.text,
      score: h.score,
      number: h.number,
      date: h.date,
      snippet: h.snippet,
      sourceType: h.sourceType,
      match: h.match,
      ...(h.sourceType === 'notification' && h.number && { notification: h.number }),
    }));
  }
  const index = loadIndex();
  if (!index) return [];
  const [qv] = await embed([query]);
  if (!qv) return [];

  const docs = new Map(listDocs().map((d) => [d.id, d]));
  const scored: { i: number; score: number }[] = [];
  const q = new Float32Array(qv);
  for (let i = 0; i < index.chunks.length; i++) {
    const chunk = index.chunks[i]!;
    if (opts?.docIdPrefix && !chunk.docId.startsWith(opts.docIdPrefix)) continue;
    if (opts?.notifications && !(chunk.notification && opts.notifications.includes(chunk.notification)))
      continue;
    let dot = 0;
    const base = i * EMBEDDING_DIMS;
    for (let j = 0; j < EMBEDDING_DIMS; j++) dot += q[j]! * index.vectors[base + j]!;
    scored.push({ i, score: dot }); // vectors are unit-normalised by OpenAI → dot = cosine
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts?.topK ?? 6).map(({ i, score }) => {
    const c = index.chunks[i]!;
    const d = docs.get(c.docId);
    return {
      docId: c.docId,
      title: d?.title ?? c.docId,
      sourceUrl: d?.sourceUrl ?? '',
      page: c.page,
      text: c.text,
      ...(c.notification && { notification: c.notification }),
      score,
    };
  });
}
