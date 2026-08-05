/** Semantic search over the library: pnpm search "lactose tariff rate" */
import { searchLibrary } from '../src/indexer.js';

const query = process.argv.slice(2).join(' ');
if (!query) {
  console.error('usage: pnpm search <query>');
  process.exit(1);
}
const hits = await searchLibrary(query, { topK: 5 });
for (const h of hits) {
  console.log(`\n— ${h.title} · p.${h.page} · score ${h.score.toFixed(3)}\n  ${h.text.slice(0, 300)}…\n  ${h.sourceUrl}`);
}
