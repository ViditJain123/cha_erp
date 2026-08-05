/** Import a locally downloaded official PDF: pnpm exec tsx cli/import-local.ts <pdf-path> <id> <title> <sourceUrl> [edition] */
import { readFileSync } from 'node:fs';
import { saveDoc } from '../src/store.js';

const [pdfPath, id, title, sourceUrl, edition] = process.argv.slice(2);
if (!pdfPath || !id || !title || !sourceUrl) {
  console.error('usage: tsx cli/import-local.ts <pdf-path> <id> <title> <sourceUrl> [edition]');
  process.exit(1);
}
saveDoc(
  {
    id,
    kind: id.startsWith('notn') ? 'notification' : 'tariff-chapter',
    title,
    sourceUrl,
    ...(edition ? { edition } : {}),
    fetchedAt: new Date().toISOString(),
  },
  readFileSync(pdfPath),
);
console.log(`imported ${id}`);
