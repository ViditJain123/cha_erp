/** Extract + chunk + embed all fetched-but-unindexed documents. */
import { indexAllPending } from '../src/indexer.js';

const results = await indexAllPending((r) => {
  if (r.status === 'indexed') console.log(`✅ ${r.docId}: ${r.chunks} chunks over ${r.pages} pages`);
  else if (r.status === 'no-text') console.log(`⚠️  ${r.docId}: no extractable text (scanned?)`);
});
const indexed = results.filter((r) => r.status === 'indexed').length;
const skipped = results.filter((r) => r.status === 'already-indexed').length;
console.log(`\ndone: ${indexed} indexed, ${skipped} already indexed`);
