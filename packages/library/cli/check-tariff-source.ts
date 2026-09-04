/**
 * Assert that CBIC still publishes the working tariff where we look for it.
 *
 * CBIC rebuilt cbic.gov.in as a single-page app and every static CONTENTREPO
 * URL 404'd overnight; the tariff fetcher went on "working" by falling through
 * to Wayback, so the masters would have quietly aged instead of failing. This
 * is the check that turns the next such move into a loud error.
 *
 *     pnpm --filter @checklist/library exec tsx cli/check-tariff-source.ts
 *
 * Exit 1 on anything wrong. Safe to run on a schedule.
 */
import { tariffChapterPaths } from '../src/fetch.js';

// 1..98. Chapter 77 is reserved in the Harmonized System and carries no
// headings, but CBIC still publishes a placeholder page for it, so it is
// expected here like any other.
const EXPECTED = Array.from({ length: 98 }, (_, i) => i + 1);

const paths = await tariffChapterPaths();
const missing = EXPECTED.filter((c) => !paths.has(c));

const editions = new Map<string, number>();
for (const p of paths.values()) {
  const edition = p.match(/Tariff\(ason([\d.]+)\)/)?.[1] ?? 'unknown';
  editions.set(edition, (editions.get(edition) ?? 0) + 1);
}

console.log(`resolved ${paths.size}/${EXPECTED.length} chapters`);
for (const [edition, n] of [...editions].sort()) console.log(`  ${edition}: ${n} chapters`);

if (missing.length) {
  // Several chapters at once means the tree moved; one means that chapter did.
  console.error(`\n❌ ${missing.length} chapter(s) unresolved: ${missing.join(', ')}`);
  console.error(
    'Either CBIC moved the content tree again, or the root content id changed.\n' +
      'Start at https://www.cbic.gov.in/entities/cbic-content-mst/<base64 id> and\n' +
      'find the current "Tariff (as on …)" node; see TARIFF_ROOT_CONTENT_ID.',
  );
  process.exit(1);
}

// Chapters legitimately sit on different editions — CBIC republishes one only
// when it changes — so a single edition across all 98 is the suspicious case:
// it usually means the walk found one folder and stopped.
if (editions.size === 1 && !editions.has('unknown')) {
  console.warn('\n⚠️  every chapter reports the same edition; verify the walk is not truncated');
}

console.log('\n✅ tariff source intact');
