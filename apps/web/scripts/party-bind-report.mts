/**
 * What every party name in the corpus resolves to, without running the corpus.
 *
 * Party binding is the one thing in Phase 2 that can be checked exactly: the
 * name is on the draft, the repository is in the database, and `resolveParty`
 * is a pure function of the two. So this is the acceptance test for the
 * repository import and for the branch pick — no model calls, no workbook.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --conditions react-server scripts/party-bind-report.mts
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChecklistDraft } from '@checklist/extraction';
import { resolveParty } from '@/lib/parties';
import { serviceClient } from '@/lib/supabase/admin';

const ERP_ROOT = path.resolve(import.meta.dirname, '../../..', '..');
const COMPANY_ID = process.env.CORPUS_COMPANY_ID ?? '39ec24f0-2254-4e08-abbd-4fe19c09f878';

const state: Record<string, { jobId: string }> = JSON.parse(
  await readFile(path.join(ERP_ROOT, 'corpus-exports/state.json'), 'utf8'),
);
const db = serviceClient();

const tally = new Map<string, number>();
const rows: string[] = [];
const seen = new Set<string>();

for (const folder of Object.keys(state).sort()) {
  const { data } = await db
    .from('job_drafts')
    .select('draft')
    .eq('job_id', state[folder]!.jobId)
    .eq('company_id', COMPANY_ID)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.draft) continue;
  const draft = data.draft as unknown as ChecklistDraft;

  for (const [role, name] of [
    ['consignee', draft.importer?.name],
    ['shipper', draft.supplier?.name],
  ] as const) {
    if (!name) continue;
    const key = `${role}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const match = await resolveParty(COMPANY_ID, role, name);
    tally.set(match.status, (tally.get(match.status) ?? 0) + 1);
    const detail =
      match.org
        ? `-> ${match.org.name} [${match.org.branch_name}]${match.org.city ? ` ${match.org.city}` : ''}`
        : match.candidates?.length
          ? `(${match.candidates.length} candidates)`
          : '';
    rows.push(`  ${match.status.padEnd(10)} ${role.padEnd(9)} ${name.slice(0, 46).padEnd(46)} ${detail}`);
  }
}

rows.sort();
for (const r of rows) console.log(r);
console.log(`\n${seen.size} distinct party names`);
for (const [status, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status.padEnd(10)} ${n}`);
}
