/**
 * Mirror the duty masters into the database as one dated release.
 *
 * The code is the source of truth; this copies what it holds — every tariff
 * line and every notification entry, each with the dates it is in force — into
 * the tables of supabase/migrations/20261003000001_masters_mirror.sql. Run it
 * after a masters rebuild (build-masters.py, build-tariff-book.py, ...).
 *
 * A release is loaded whole while invisible, then switched on in one
 * transaction, then the release it replaced is pruned in batches. A failed run
 * leaves a 'loading' release nobody can see; the next run clears it.
 *
 * Usage (from apps/web):
 *   set -a; . ../../.env.local; set +a
 *   ./node_modules/.bin/tsx --conditions react-server scripts/masters-sync.mts --dry-run
 *   ./node_modules/.bin/tsx --conditions react-server scripts/masters-sync.mts --emit-sql /tmp/masters.sql
 *   ./node_modules/.bin/tsx --conditions react-server scripts/masters-sync.mts
 *
 * --dry-run   build and check the rows, print the report, write nothing
 * --emit-sql  write the release as SQL to a file (for a scratch Postgres)
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  checkMasterRows,
  notificationConditionRows,
  notificationEntryRows,
  tariffBookInForceFrom,
  tariffEdition,
  tariffLineRows,
} from '@checklist/core';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const sqlAt = argv.indexOf('--emit-sql');
const sqlFile = sqlAt >= 0 ? argv[sqlAt + 1] : undefined;
if (sqlAt >= 0 && !sqlFile) {
  console.error('--emit-sql needs a file path.');
  process.exit(1);
}

/** Rows per insert. Notification entries average ~700 bytes as JSON. */
const BATCH = 500;

const tariff = tariffLineRows();
const entries = notificationEntryRows();
const conditions = notificationConditionRows();
const report = checkMasterRows(tariff, entries, conditions);

console.log(
  `${report.tariffLines} tariff lines, ${report.notificationEntries} notification entries, ` +
    `${report.conditions} conditions`,
);
console.log('by duty type:', report.byDutyType);
console.log(`${report.datedByNotification} entries dated by their notification's in-force date`);
if (report.problems.length) {
  console.error(`\n${report.problems.length} problems — nothing written:`);
  for (const p of report.problems.slice(0, 30)) console.error(`  - ${p}`);
  process.exit(1);
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const source = {
  tariffEdition: tariffEdition(),
  tariffInForceFrom: tariffBookInForceFrom() ?? null,
  commit: git('rev-parse', 'HEAD'),
  // Uncommitted changes under the masters mean the release is not
  // reproducible from the commit alone; say so on the release.
  mastersDirty: Boolean(git('status', '--porcelain', '--', 'packages/core/src/masters', 'packages/core/scripts')),
  builtAt: new Date().toISOString(),
};
const counts = {
  tariffLines: report.tariffLines,
  notificationEntries: report.notificationEntries,
  conditions: report.conditions,
  byDutyType: report.byDutyType,
  datedByNotification: report.datedByNotification,
};

if (dryRun) {
  console.log('\n--dry-run: checks passed, nothing written.');
  process.exit(0);
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

if (sqlFile) {
  // json_populate_recordset reads each batch as the table's own row type, so
  // the SQL exercises exactly the constraints a real sync would.
  const release = randomUUID();
  const quote = (value: unknown) => {
    const json = JSON.stringify(value);
    if (json.includes('$mm$')) throw new Error('row text contains the dollar-quote tag');
    return `$mm$${json}$mm$`;
  };
  const insert = (table: string, rows: object[]) =>
    chunks(rows, 2000)
      .map((batch) => `insert into public.${table} select * from json_populate_recordset(null::public.${table}, ${quote(batch.map((r) => ({ release_id: release, ...r })))});`)
      .join('\n');
  const sql = [
    'begin;',
    `insert into public.master_releases (id, source, counts) values ('${release}', ${quote(source)}::jsonb, ${quote(counts)}::jsonb);`,
    insert('tariff_lines', tariff),
    insert('notification_entries', entries),
    insert('notification_conditions', conditions),
    `select public.activate_master_release('${release}');`,
    'commit;',
  ].join('\n');
  writeFileSync(sqlFile, sql);
  console.log(`\nwrote release ${release} to ${sqlFile}`);
  process.exit(0);
}

/* ---------- push to Supabase with the service role ---------- */

const { serviceClient } = await import('@checklist/db/service');
// These tables are newer than the generated Database types, and this script
// is their only writer; an untyped handle keeps it from depending on a type
// regeneration against the hosted project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = serviceClient() as any;

async function must<T>(what: string, call: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function prune(release: string) {
  let total = 0;
  for (;;) {
    const n = await must<number>('prune', db.rpc('prune_master_release', { p_release: release, p_limit: 5000 }));
    total += n;
    if (!n) return total;
  }
}

// A run that died part-way left a loading release behind. Nobody can see it;
// clear it before loading another.
const leftovers = await must<{ id: string }[]>(
  'list leftover releases',
  db.from('master_releases').select('id').eq('status', 'loading'),
);
for (const { id } of leftovers) {
  console.log(`clearing unfinished release ${id}: ${await prune(id)} rows`);
}

const { id: release } = await must<{ id: string }>(
  'create release',
  db.from('master_releases').insert({ source, counts }).select('id').single(),
);
console.log(`\nloading release ${release}`);

const load = async (table: string, rows: object[]) => {
  const batches = chunks(rows, BATCH);
  for (const [i, batch] of batches.entries()) {
    await must(`${table} batch ${i + 1}/${batches.length}`, db.from(table).insert(batch.map((r) => ({ release_id: release, ...r }))));
    if ((i + 1) % 20 === 0 || i + 1 === batches.length) console.log(`  ${table}: ${Math.min((i + 1) * BATCH, rows.length)}/${rows.length}`);
  }
};
await load('tariff_lines', tariff);
await load('notification_entries', entries);
await load('notification_conditions', conditions);

const previous = await must<{ id: string }[]>(
  'find current release',
  db.from('master_releases').select('id').eq('status', 'current'),
);
await must('activate', db.rpc('activate_master_release', { p_release: release }));
console.log(`release ${release} is current`);

for (const { id } of previous) {
  console.log(`pruning superseded release ${id}: ${await prune(id)} rows`);
}
