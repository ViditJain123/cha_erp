/**
 * Search the library.
 *
 *   pnpm --filter @checklist/library search "IGCR condition 3 exemption"
 *   pnpm --filter @checklist/library search --type=circular "EMI scheme"
 *
 * With LIBRARY_DIR set (the root `pnpm library:search` sets it) this searches
 * the flat-file library behind /legacy/library. Otherwise it searches the CBIC
 * reference corpus in Supabase (reference_chunks): exact number first, then
 * similarity. --files / --pg force one or the other.
 */
import { searchLibrary } from '../src/indexer.js';
import { loadRepoEnv } from '../src/reference.js';
import type { CorpusType } from '../src/corpus.js';

const args = process.argv.slice(2);
const query = args.filter((a) => !a.startsWith('--')).join(' ');
if (!query) {
  console.error('usage: pnpm search [--files|--pg] [--type=circular,notification] [--k=8] <query>');
  process.exit(1);
}
const backend = args.includes('--files')
  ? 'files'
  : args.includes('--pg') || !process.env.LIBRARY_DIR
    ? 'pgvector'
    : 'files';
if (backend === 'pgvector') loadRepoEnv();
const types = args.find((a) => a.startsWith('--type='))?.split('=')[1]?.split(',') as CorpusType[] | undefined;
const topK = Number(args.find((a) => a.startsWith('--k='))?.split('=')[1] ?? 6);

const hits = await searchLibrary(query, { topK, backend, types });
for (const h of hits) {
  if (backend === 'pgvector') {
    const score = h.match === 'number' ? 'exact number' : `score ${h.score.toFixed(3)}`;
    console.log(
      `\n— [${h.sourceType}] ${h.number ?? ''}${h.date ? ` (${h.date})` : ''} · p.${h.page} · ${score}\n` +
        `  ${h.title}\n  ${h.snippet}\n  ${h.sourceUrl}`,
    );
  } else {
    console.log(`\n— ${h.title} · p.${h.page} · score ${h.score.toFixed(3)}\n  ${h.text.slice(0, 300)}…\n  ${h.sourceUrl}`);
  }
}
if (!hits.length) console.log('no hits');
