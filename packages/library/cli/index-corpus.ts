/**
 * Page text -> embeddings -> Supabase reference_chunks.
 *
 *   pnpm --filter @checklist/library index-corpus [type ...] [--yes] [--max-db-mb=N]
 *
 * Reads data/customs-corpus/text/<type>.jsonl (extract-corpus), chunks each page
 * with the library's chunkPages, embeds with text-embedding-3-small and upserts
 * on (source_type, source_id, page, chunk_no).
 *
 * Resumable and re-runnable: a chunk whose hash is already in the table is not
 * embedded again, so a re-run after a corpus top-up pays only for what changed.
 * Without --yes it prints the token, dollar and storage estimate and stops.
 */
import { existsSync, readFileSync } from 'node:fs';
import { CORPUS_TYPES, numberKey, sourceUrl, textPath, type CorpusPage, type CorpusType } from '../src/corpus.js';
import { chunkPages, embedWithUsage, EMBEDDING_MODEL } from '../src/indexer.js';
import {
  deleteReferenceDoc,
  existingChunkHashes,
  loadRepoEnv,
  referenceStats,
  textHash,
  toVectorLiteral,
  upsertReferenceChunks,
  type ReferenceChunkRow,
} from '../src/reference.js';

loadRepoEnv();

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const maxDbMb = Number(args.find((a) => a.startsWith('--max-db-mb='))?.split('=')[1] ?? 6000);
const requested = args.filter((a) => !a.startsWith('--')) as CorpusType[];
for (const t of requested) {
  if (!CORPUS_TYPES.includes(t)) {
    console.error(`unknown type ${t}; one of ${CORPUS_TYPES.join(', ')}`);
    process.exit(1);
  }
}
// Small, high-value types first, so a stopped run has indexed the most per dollar.
const ORDER: CorpusType[] = ['form', 'rule', 'regulation', 'instruction', 'order', 'circular', 'notification'];
const types = requested.length ? ORDER.filter((t) => requested.includes(t)) : ORDER;

/** text-embedding-3-small, USD per million tokens. */
const USD_PER_M_TOKENS = 0.02;
/** English legal text runs ~4 characters a token; tables and numbers run fewer. */
const CHARS_PER_TOKEN = 4;
/** Rough on-disk cost of a chunk: halfvec + TOASTed text + row + HNSW + btrees. */
const BYTES_PER_CHUNK_BASE = 10_000;

/**
 * Pages that are mostly not Latin text -- the Hindi half of a bilingual gazette
 * notification, whose font often extracts as mojibake -- are not worth a vector:
 * every question here is asked in English.
 */
function usable(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 40) return false;
  const latin = compact.match(/[A-Za-z0-9]/g)?.length ?? 0;
  return latin / compact.length >= 0.5;
}

interface PlannedChunk {
  row: Omit<ReferenceChunkRow, 'embedding'>;
  input: string;
}

function readPages(type: CorpusType): Map<number, CorpusPage[]> {
  const docs = new Map<number, CorpusPage[]>();
  const p = textPath(type);
  if (!existsSync(p)) return docs;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line) as CorpusPage;
    docs.set(r.id, [...(docs.get(r.id) ?? []), r]);
  }
  return docs;
}

function planDoc(type: CorpusType, pages: CorpusPage[]): { chunks: PlannedChunk[]; skippedPages: number } {
  const chunks: PlannedChunk[] = [];
  let skippedPages = 0;
  for (const p of pages) {
    if (!usable(p.text)) {
      skippedPages++;
      continue;
    }
    const pieces = chunkPages(`${type}:${p.id}`, [p.text]);
    pieces.forEach((c, chunkNo) => {
      // The header travels with the text into the embedding, so a chunk from
      // page 7 still "knows" which notification it belongs to.
      const header = [p.number, p.title].filter(Boolean).join(' — ');
      const input = `${header}${p.date ? ` (${p.date})` : ''}\n${c.text}`;
      chunks.push({
        input,
        row: {
          source_type: type,
          source_id: p.id,
          number: p.number,
          number_key: numberKey(p.number),
          doc_date: p.date,
          category: p.category,
          title: p.title || p.number || `${type} ${p.id}`,
          source_url: p.sourceUrl ?? sourceUrl(type, p.id),
          page: p.page,
          chunk_no: chunkNo,
          text: c.text,
          text_hash: textHash(input),
          is_current: !p.isOmitted && !p.isHistory,
          is_amended: p.isAmended,
        },
      });
    });
  }
  return { chunks, skippedPages };
}

interface TypePlan {
  type: CorpusType;
  docs: number;
  chunks: number;
  skippedPages: number;
  todo: PlannedChunk[];
  replaceDocs: Set<number>;
}

async function planType(type: CorpusType): Promise<TypePlan> {
  const docs = readPages(type);
  const existing = await existingChunkHashes(type);
  const plan: TypePlan = { type, docs: docs.size, chunks: 0, skippedPages: 0, todo: [], replaceDocs: new Set() };
  for (const [id, pages] of docs) {
    const { chunks, skippedPages } = planDoc(type, pages);
    plan.chunks += chunks.length;
    plan.skippedPages += skippedPages;
    const have = existing.get(id);
    const want = new Map(chunks.map((c) => [`${c.row.page}:${c.row.chunk_no}`, c.row.text_hash]));
    const stale = have ? [...have.keys()].some((k) => !want.has(k)) : false;
    if (stale) {
      // The document changed shape: replace it whole rather than leave orphans.
      plan.replaceDocs.add(id);
      plan.todo.push(...chunks);
    } else {
      plan.todo.push(...chunks.filter((c) => have?.get(`${c.row.page}:${c.row.chunk_no}`) !== c.row.text_hash));
    }
  }
  return plan;
}

const t0 = Date.now();
const plans: TypePlan[] = [];
for (const type of types) plans.push(await planType(type));

const stats = await referenceStats().catch((err: Error) => {
  console.error(`cannot read reference_chunks_stats (is migration 20260914000001 pushed?): ${err.message}`);
  process.exit(1);
});
const dbBytes = stats[0]?.database_bytes ?? 0;

let totalTodo = 0;
let totalChars = 0;
console.log(`model ${EMBEDDING_MODEL}; database is ${(dbBytes / 1e6).toFixed(0)} MB now`);
for (const p of plans) {
  const chars = p.todo.reduce((s, c) => s + c.input.length, 0);
  totalTodo += p.todo.length;
  totalChars += chars;
  console.log(
    `  ${p.type.padEnd(12)} ${String(p.docs).padStart(6)} docs  ${String(p.chunks).padStart(7)} chunks` +
      `  ${String(p.todo.length).padStart(7)} to embed  ~${((chars / CHARS_PER_TOKEN) / 1e6).toFixed(2)}M tokens` +
      `  (${p.skippedPages} pages skipped as empty/non-Latin${p.replaceDocs.size ? `, ${p.replaceDocs.size} docs replaced` : ''})`,
  );
}
const tokens = totalChars / CHARS_PER_TOKEN;
const usd = (tokens / 1e6) * USD_PER_M_TOKENS;
const projectedMb = (dbBytes + totalTodo * BYTES_PER_CHUNK_BASE) / 1e6;
console.log(
  `total: ${totalTodo} chunks, ~${(tokens / 1e6).toFixed(2)}M tokens, ~US$${usd.toFixed(2)}; ` +
    `database projected at ~${projectedMb.toFixed(0)} MB (limit --max-db-mb=${maxDbMb})`,
);
if (projectedMb > maxDbMb) {
  console.error(`refusing: projected size exceeds --max-db-mb=${maxDbMb}`);
  process.exit(1);
}
if (!yes) {
  console.log('dry run: pass --yes to embed and upsert.');
  process.exit(0);
}
if (!totalTodo) {
  console.log('nothing to do.');
  process.exit(0);
}

// The org's text-embedding-3-small limit is 1M tokens a minute; three workers
// unpaced ran at ~1.35M and exhausted the SDK's retries. Keep a sliding window
// under TPM_BUDGET, and treat a 429 that still gets through as a pause.
const TPM_BUDGET = Number(process.env.EMBED_TPM_BUDGET ?? 700_000);
const spent: { at: number; tokens: number }[] = [];
async function tokenBudget(next: number): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0]!.at > 60_000) spent.shift();
    const used = spent.reduce((n, s) => n + s.tokens, 0);
    if (used + next <= TPM_BUDGET || !spent.length) {
      // Reserve before the request, so concurrent workers see each other's spend.
      spent.push({ at: now, tokens: next });
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(500, 60_000 - (now - spent[0]!.at))));
  }
}
async function embedAfter429(inputs: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await embedWithUsage(inputs);
    } catch (err) {
      if ((err as { status?: number }).status !== 429 || attempt >= 6) throw err;
      console.log(`  rate limited; pausing 30 s (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

const EMBED_BATCH = 128;
const UPSERT_BATCH = 64;
const WORKERS = 3;
let billed = 0;
let done = 0;

for (const plan of plans) {
  if (!plan.todo.length) continue;
  for (const id of plan.replaceDocs) await deleteReferenceDoc(plan.type, id);
  const batches: PlannedChunk[][] = [];
  for (let i = 0; i < plan.todo.length; i += EMBED_BATCH) batches.push(plan.todo.slice(i, i + EMBED_BATCH));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const batch = batches[next++];
      if (!batch) return;
      const inputs = batch.map((c) => c.input);
      const estimate = inputs.reduce((n, t) => n + t.length, 0) / 3; // generous: never undershoot the budget
      await tokenBudget(estimate);
      const { vectors, tokens: used } = await embedAfter429(inputs);
      billed += used;
      const rows: ReferenceChunkRow[] = batch.map((c, i) => ({ ...c.row, embedding: toVectorLiteral(vectors[i]!) }));
      for (let i = 0; i < rows.length; i += UPSERT_BATCH) await upsertReferenceChunks(rows.slice(i, i + UPSERT_BATCH));
      done += batch.length;
      if (Math.floor(done / 2000) !== Math.floor((done - batch.length) / 2000) || done === totalTodo) {
        const mins = (Date.now() - t0) / 60000;
        console.log(
          `  ${plan.type}: ${done}/${totalTodo} chunks, ${(billed / 1e6).toFixed(2)}M tokens ` +
            `(US$${((billed / 1e6) * USD_PER_M_TOKENS).toFixed(2)}), ${mins.toFixed(1)} min`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
}

const after = await referenceStats();
console.log(`\nbilled ${billed} tokens = US$${((billed / 1e6) * USD_PER_M_TOKENS).toFixed(4)}`);
for (const s of after) console.log(`  ${s.source_type.padEnd(12)} ${s.documents} docs, ${s.chunks} chunks`);
console.log(`database ${(after[0]!.database_bytes / 1e6).toFixed(0)} MB`);
