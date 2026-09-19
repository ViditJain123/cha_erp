/**
 * Index Volume II of the printed tariff — the notification text — one library
 * document per notification.
 *
 * build-tariff-book.py reads the scan by coordinate and writes
 * data/tariff-books/vol2-text.jsonl, one line per page, each tagged with the
 * notification it belongs to. This groups those pages into documents
 * (`tariff-book-ntfn-045-2025`) and embeds them, so a question that already
 * knows its notification can be answered from that notification alone.
 *
 * Idempotent: a notification already indexed is skipped, so re-running after a
 * rebuild only embeds what is new.
 *
 *   LIBRARY_DIR=$PWD/apps/web/data/library pnpm --filter @checklist/library index-tariff-book
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { indexTextDoc } from '../src/indexer.js';

interface PageLine {
  notification: string;
  kind: string;
  title: string;
  page: number;
  text: string;
}

const REPO_RELATIVE = 'data/tariff-books/vol2-text.jsonl';

function locate(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(dir, REPO_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `${REPO_RELATIVE} not found. Run python3 packages/core/scripts/build-tariff-book.py first — ` +
      'the text is produced beside the source books and is not committed.',
  );
}

const lines = readFileSync(locate(), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as PageLine);

// One notification can appear in two places (an exemption appendix and a subject
// section both reprint some). Both runs belong to the same document.
const byNotification = new Map<string, PageLine[]>();
for (const line of lines) {
  const list = byNotification.get(line.notification);
  if (list) list.push(line);
  else byNotification.set(line.notification, [line]);
}

let indexed = 0;
let skipped = 0;
let chunks = 0;
for (const [notification, pages] of byNotification) {
  const first = pages[0]!;
  const result = await indexTextDoc(
    {
      id: `tariff-book-ntfn-${notification.replace(/\//g, '-')}`,
      kind: 'tariff-book',
      title: `${first.title || `Notification ${notification}`} (${notification}-${first.kind})`,
      sourceUrl: 'BDP Customs Tariff 2026-27, Volume II',
      edition: '2026-27',
      notification,
      fetchedAt: new Date().toISOString(),
    },
    pages.map((p) => ({ page: p.page, text: p.text })),
  );
  if (result.status === 'indexed') {
    indexed++;
    chunks += result.chunks ?? 0;
  } else {
    skipped++;
  }
}
console.log(
  `${byNotification.size} notifications: ${indexed} indexed (${chunks} chunks), ${skipped} already indexed or empty`,
);
