/**
 * Download all working-tariff chapter PDFs (1–98).
 *
 * Each chapter's edition is whatever CBIC last republished it under, so the
 * editions printed below will not all agree — that is correct, not a bug.
 */
import { fetchConsolidatedTariff, fetchTariffChapter } from '../src/fetch.js';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 98);

const consolidated = await fetchConsolidatedTariff();
console.log(
  consolidated.status === 'downloaded'
    ? `✅ consolidated tariff (${Math.round((consolidated.bytes ?? 0) / 1024 / 1024)} MB)`
    : `consolidated tariff: ${consolidated.status}`,
);

let downloaded = 0;
let exists = 0;
const missing: number[] = [];

for (let ch = from; ch <= to; ch++) {
  const r = await fetchTariffChapter(ch);
  if (r.status === 'downloaded') {
    downloaded++;
    console.log(`✅ chap-${ch} (${r.edition}, ${Math.round((r.bytes ?? 0) / 1024)} KB)`);
  } else if (r.status === 'exists') {
    exists++;
  } else {
    missing.push(ch);
    console.log(`⚠️  chap-${ch} could not be retrieved`);
  }
}
console.log(`\ndone: ${downloaded} downloaded, ${exists} already present, missing: [${missing.join(', ')}]`);
