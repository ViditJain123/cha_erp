import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import OpenAI from 'openai';
import { indexDir, listDocs, readDocPdf, updateDocMeta, type LibraryDocMeta } from './store.js';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

export interface Chunk {
  docId: string;
  page: number;
  text: string;
}

let _client: OpenAI | undefined;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    _client = new OpenAI();
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

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  const BATCH = 128;
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await client().embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.slice(i, i + BATCH),
    });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
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
  const pages = await pdfPageTexts(readDocPdf(meta.id));
  const chunks = chunkPages(meta.id, pages);
  if (!chunks.length) return { docId: meta.id, status: 'no-text' };
  const vectors = await embed(chunks.map((c) => c.text));
  appendToIndex(chunks, vectors);
  updateDocMeta({ ...meta, pages: pages.length, indexedAt: new Date().toISOString() });
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
  score: number;
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
  opts?: { topK?: number; docIdPrefix?: string },
): Promise<SearchHit[]> {
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
      score,
    };
  });
}
