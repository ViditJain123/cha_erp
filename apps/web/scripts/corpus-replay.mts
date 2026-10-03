/**
 * Replay the stored drafts through the mappers, with no model calls.
 *
 * The nightly corpus run reads real PDFs and pays for one model call per
 * document, so it is not something to run after every edit. But most of what
 * the run measures does not depend on extraction at all: the draft is already
 * on the job, and the resolution steps and the workbook mappers are pure
 * functions over it plus the masters.
 *
 * So this re-resolves each stored draft and rebuilds its workbook, and diffs
 * the warnings against the ones the last full run recorded in `report.json`.
 * It cannot catch an extraction regression — nothing here re-reads a document —
 * and it is exactly the right tool for a mapper change.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --conditions react-server scripts/corpus-replay.mts [--only ex_job26]
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildLogisysWorkbook } from '@checklist/exporter';
import type { ChecklistDraft } from '@checklist/extraction';
import { applyContainerResolution } from '@/lib/containers';
import { applyItemResolution } from '@/lib/items';
import { applyPartyResolution } from '@/lib/parties';
import { serviceClient } from '@/lib/supabase/admin';

const ERP_ROOT = path.resolve(import.meta.dirname, '../../..', '..');
const OUT_ROOT = path.join(ERP_ROOT, 'corpus-exports');
const COMPANY_ID = process.env.CORPUS_COMPANY_ID ?? '39ec24f0-2254-4e08-abbd-4fe19c09f878';

const argv = process.argv.slice(2);
const at = argv.indexOf('--only');
const ONLY = at >= 0 ? (argv[at + 1] ?? '').split(',').filter(Boolean) : undefined;

interface StateEntry {
  folder: string;
  jobId: string;
}

const state: Record<string, StateEntry> = JSON.parse(
  await readFile(path.join(OUT_ROOT, 'state.json'), 'utf8'),
);

const db = serviceClient();
// `ITEMS[0].End_Use` and `ITEMS[45].End_Use` are the same question asked of two
// lines, so the tally collapses the index — otherwise a sheet with seventy
// lines buries a real regression under seventy rows of one.
const prefix = (w: string) => (w.split(':')[0] ?? w).replace(/\[\d+\]/g, '[]');

let totalBefore = 0;
let totalAfter = 0;
const movedByPrefix = new Map<string, { before: number; after: number }>();
const blocked: string[] = [];

for (const folder of Object.keys(state).sort()) {
  if (ONLY && !ONLY.includes(folder)) continue;
  const entry = state[folder]!;

  const reportPath = path.join(OUT_ROOT, folder, 'report.json');
  if (!existsSync(reportPath)) continue;
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as { warnings?: string[] };
  const before: string[] = report.warnings ?? [];

  const { data: draftRow } = await db
    .from('job_drafts')
    .select('draft')
    .eq('job_id', entry.jobId)
    .eq('company_id', COMPANY_ID)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draftRow?.draft) {
    console.log(`${folder.padEnd(10)} no stored draft`);
    continue;
  }

  let draft = draftRow.draft as unknown as ChecklistDraft;
  // The resolution steps this replay can run without a network call or a model
  // call. The rest of applyJobResolution reaches ICEGATE or re-reads the mail
  // thread. Parties are re-bound because the repository is a database the
  // stored draft was resolved against at some earlier state of it, and a
  // repository import is exactly the kind of change this replay should see.
  draft = await applyPartyResolution(draft, COMPANY_ID);
  draft = await applyContainerResolution(draft, COMPANY_ID, entry.jobId);
  draft = await applyItemResolution(draft, COMPANY_ID, entry.jobId);

  let after: string[];
  try {
    const result = await buildLogisysWorkbook({
      draft,
      job: { id: entry.jobId, reference: folder },
    });
    after = result.warnings;
  } catch (error) {
    blocked.push(`${folder}: ${(error as Error).message.split('\n')[0]}`);
    continue;
  }

  totalBefore += before.length;
  totalAfter += after.length;
  for (const w of before) {
    const p = prefix(w);
    const cell = movedByPrefix.get(p) ?? { before: 0, after: 0 };
    cell.before += 1;
    movedByPrefix.set(p, cell);
  }
  for (const w of after) {
    const p = prefix(w);
    const cell = movedByPrefix.get(p) ?? { before: 0, after: 0 };
    cell.after += 1;
    movedByPrefix.set(p, cell);
  }

  const delta = after.length - before.length;
  console.log(
    `${folder.padEnd(10)} warnings ${String(before.length).padStart(3)} -> ` +
      `${String(after.length).padStart(3)}${delta === 0 ? '' : `  (${delta > 0 ? '+' : ''}${delta})`}`,
  );
}

console.log(`\ntotal warnings ${totalBefore} -> ${totalAfter}`);
if (argv.includes('--remaining')) {
  console.log('\nwhat is left, by warning path:');
  for (const [p, { after }] of [...movedByPrefix].sort((a, b) => b[1].after - a[1].after)) {
    if (after > 0) console.log(`  ${p.padEnd(34)} ${String(after).padStart(3)}`);
  }
}
console.log('\nby warning path (only those that moved):');
for (const [p, { before, after }] of [...movedByPrefix].sort((a, b) =>
  Math.abs(b[1].before - b[1].after) - Math.abs(a[1].before - a[1].after),
)) {
  if (before === after) continue;
  console.log(`  ${p.padEnd(34)} ${String(before).padStart(3)} -> ${String(after).padStart(3)}`);
}
if (blocked.length) {
  console.log(`\nblocked (${blocked.length}):`);
  for (const b of blocked) console.log(`  ${b}`);
}
