/**
 * Rolls the per-job ICES findings up into `comparison/ICES-ERRORS.md`.
 *
 * The number this produces is the point of Phase 0.2: **how many of our filings
 * ICES would reject today**, established without uploading anything to anyone.
 * Until now the only way to find out was to hand a workbook to Logi-Sys and
 * read the ErrorList it returned, which is the vendor lock stated precisely —
 * we could not file elsewhere, and we could not measure how wrong we were
 * without asking the vendor we are trying to leave.
 *
 * Reads the `ices` block that `corpus-export.mts` writes into each job's
 * `report.json`, so it costs nothing and needs no model calls. Run it after a
 * corpus dry run:
 *
 *     ./node_modules/.bin/tsx --conditions react-server scripts/ices-report.mts
 *
 * ICES rules and Logi-Sys rules are counted apart throughout. We must satisfy
 * ICES to file at all; Logi-Sys only until the handoff goes away, and their
 * uploader is stricter in places.
 */
import { icesRuleCoverage, validateIces, type Cell, type IcesFinding } from '@checklist/exporter';
import ExcelJS from 'exceljs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The same root corpus-export.mts writes to: the corpus lives beside the repo,
// not inside it.
const ERP_ROOT = path.resolve(import.meta.dirname, '../../../..');
const OUT_ROOT = path.join(ERP_ROOT, 'corpus-exports');
const COMPARISON = path.join(OUT_ROOT, 'comparison');

interface Report {
  folder: string;
  fileName?: string;
  ices?: {
    findings: IcesFinding[];
    unrunnable: { code: string; sheet: string; column: string; missing: string[] }[];
  };
}

/**
 * Validate a workbook that is already on disk.
 *
 * So the number can be had from the last dry run rather than only from the next
 * one — a corpus run costs real model calls, and the whole point of this phase
 * is that finding out how wrong we are should be free. Reading the file back
 * also checks the rules against what was actually written rather than against
 * the mappers' intermediate state.
 */
async function validateWorkbook(file: string): Promise<Report['ices']> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const data: Record<string, Record<string, Cell>[]> = {};
  for (const sheet of wb.worksheets) {
    const raw = sheet.getRow(1).values;
    const headers: string[] = (Array.isArray(raw) ? raw.slice(1) : []).map((v) =>
      v == null ? '' : String(v),
    );
    const rows: Record<string, Cell>[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const record: Record<string, Cell> = {};
      let populated = false;
      headers.forEach((header: string, i: number) => {
        if (!header) return;
        const v = row.getCell(i + 1).value;
        if (v !== null && v !== undefined && v !== '') populated = true;
        const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
        record[header] = s ? { kind: 'text', value: s } : { kind: 'blank' };
      });
      if (populated) rows.push(record);
    }
    data[sheet.name] = rows;
  }
  return validateIces(data);
}

async function readReports(): Promise<Report[]> {
  const entries = await readdir(OUT_ROOT, { withFileTypes: true });
  const out: Report[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'comparison' || e.name === '_unpacked') continue;
    const dir = path.join(OUT_ROOT, e.name);
    let report: Report;
    try {
      report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
    } catch {
      // A folder that did not export has no report; that is the corpus run's
      // number to report, not this script's.
      continue;
    }
    // Reports written before the validator existed carry no `ices` block, so
    // the workbook beside them is validated now.
    if (!report.ices && report.fileName) {
      try {
        report.ices = await validateWorkbook(path.join(dir, report.fileName));
      } catch (err) {
        console.error(`  ! ${e.name}: ${(err as Error).message}`);
      }
    }
    out.push(report);
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

function table(rows: string[][], head: string[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

async function main(): Promise<void> {
  const reports = await readReports();
  const withIces = reports.filter((r) => r.ices);
  if (!withIces.length) {
    console.error(
      'No report.json carries an `ices` block. Re-run scripts/corpus-export.mts — the ' +
        'reports on disk predate the validator.',
    );
    process.exit(1);
  }

  const all = withIces.flatMap((r) => (r.ices?.findings ?? []).map((f) => ({ ...f, folder: r.folder })));
  const ices = all.filter((f) => f.source === 'ices');
  const vendor = all.filter((f) => f.source === 'logisys');

  const clean = withIces.filter((r) => !(r.ices?.findings ?? []).some((f) => f.source === 'ices'));
  const coverage = icesRuleCoverage();

  const byCode = new Map<string, { description: string; count: number; jobs: Set<string> }>();
  for (const f of ices) {
    const e = byCode.get(f.code) ?? { description: f.description, count: 0, jobs: new Set<string>() };
    e.count += 1;
    e.jobs.add(f.folder);
    byCode.set(f.code, e);
  }

  const unrunnable = new Map<string, Set<string>>();
  for (const r of withIces)
    for (const u of r.ices?.unrunnable ?? [])
      unrunnable.set(
        `${u.code} ${u.sheet}.${u.column || '—'}`,
        (unrunnable.get(`${u.code} ${u.sheet}.${u.column || '—'}`) ?? new Set()).add(
          u.missing.join(', '),
        ),
      );

  const lines: string[] = [
    '# What ICES would reject',
    '',
    `Generated by \`scripts/ices-report.mts\` from the last corpus dry run, ${new Date()
      .toISOString()
      .slice(0, 10)}.`,
    '',
    `**${clean.length} of ${withIces.length} exported workbooks would pass** the rules we can ` +
      'check today. The rest draw ' +
      `**${ices.length} rejections across ${byCode.size} distinct ICES error codes**.`,
    '',
    `Checked by ${coverage.rules} rules covering ${coverage.codes} of the ${coverage.published} ` +
      'codes ICES publishes. The uncovered ones are mostly about state ICES holds and we cannot ' +
      'see — whether an IEC is blacklisted, whether the CHA licence is current, whether the ' +
      'warehouse ledger has a credit entry — or about sheets we do not map.',
    '',
    '## By error code',
    '',
    byCode.size
      ? table(
          [...byCode]
            .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
            .map(([code, e]) => [
              `\`${code}\``,
              e.description,
              String(e.count),
              String(e.jobs.size),
            ]),
          ['ERR_CD', 'ICES description', 'Rows', 'Jobs'],
        )
      : '_Nothing._',
    '',
    '## By job',
    '',
    table(
      withIces.map((r) => {
        const mine = (r.ices?.findings ?? []).filter((f) => f.source === 'ices');
        const codes = [...new Set(mine.map((f) => f.code))].sort();
        return [
          r.folder,
          mine.length ? String(mine.length) : '—',
          codes.length ? codes.map((c) => `\`${c}\``).join(' ') : 'clean',
        ];
      }),
      ['Job', 'Rejections', 'Codes'],
    ),
    '',
    '## Logi-Sys-only rules',
    '',
    'Their uploader is stricter than ICES in places — it makes columns mandatory that ICES ' +
      'treats as optional. These stop mattering the day the handoff does, and are counted ' +
      'apart so they never get chased as if they were filing requirements.',
    '',
    `**${vendor.length}** findings across ${new Set(vendor.map((f) => f.folder)).size} jobs.`,
    '',
  ];

  if (unrunnable.size) {
    lines.push(
      '## Rules that could not run',
      '',
      'The sheet does not carry the column the rule reads, so the rule neither passed nor ' +
        'failed. Listed because a rule that silently no-ops reads exactly like a rule that ' +
        'found nothing.',
      '',
      table(
        [...unrunnable].sort().map(([k, v]) => [`\`${k}\``, [...v].join('; ')]),
        ['Rule', 'Missing columns'],
      ),
      '',
    );
  }

  await mkdir(COMPARISON, { recursive: true });
  await writeFile(path.join(COMPARISON, 'ICES-ERRORS.md'), `${lines.join('\n')}\n`);

  // A machine-readable sidecar for scripts/corpus-gate.mts, which fails the
  // nightly run when a workbook starts drawing a rejection it did not draw
  // before. The markdown is for people; this is for the gate.
  await writeFile(
    path.join(COMPARISON, 'ices.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        clean: clean.length,
        workbooks: withIces.length,
        rejections: ices.length,
        byJob: Object.fromEntries(
          withIces.map((r) => [
            r.folder,
            [
              ...new Set(
                (r.ices?.findings ?? []).filter((f) => f.source === 'ices').map((f) => f.code),
              ),
            ].sort(),
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`${clean.length}/${withIces.length} workbooks clean against the rules we can check`);
  console.log(`${ices.length} ICES rejections, ${byCode.size} distinct codes`);
  console.log(`${vendor.length} Logi-Sys-only findings`);
  console.log(`-> ${path.relative(process.cwd(), path.join(COMPARISON, 'ICES-ERRORS.md'))}`);
}

void main();
