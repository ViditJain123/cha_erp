/**
 * Fails when the corpus run got worse.
 *
 * The exporter's golden tests all run off **hand-transcribed drafts**. They pin
 * the mappers and they can never catch an extraction regression, because no
 * model runs. Only the corpus dry run reads real PDFs, so a green test suite is
 * not the same thing as a working pipeline — and without this gate, "the corpus
 * still exports" was something somebody had to remember to check.
 *
 * Compares the last run against a committed baseline and exits non-zero on:
 *
 *   - a job that used to export and now blocks or fails,
 *   - agreement against Logi-Sys' own workbook dropping on any job,
 *   - a workbook drawing an ICES rejection it did not draw before.
 *
 * Improvements are never failures, so the baseline is only ever refreshed
 * deliberately:
 *
 *     ./node_modules/.bin/tsx --conditions react-server scripts/corpus-gate.mts
 *     ./node_modules/.bin/tsx --conditions react-server scripts/corpus-gate.mts --update
 *
 * Run it after `corpus-export.mts`, `corpus-compare.py` and `ices-report.mts`.
 *
 * ## Where this can run
 *
 * Not on a GitHub-hosted runner. The corpus is 32 folders of a real customer's
 * shipping documents that sit **beside** the repo and are deliberately not in
 * it, and the run makes real OpenAI calls. So this is a nightly job on a
 * machine that holds the corpus, and the workflow that calls it wants a
 * self-hosted runner. See .github/workflows/corpus-nightly.yml.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ERP_ROOT = path.resolve(import.meta.dirname, '../../../..');
const OUT_ROOT = path.join(ERP_ROOT, 'corpus-exports');
const BASELINE = path.join(import.meta.dirname, 'corpus-baseline.json');

interface Baseline {
  /** When the baseline was taken, so a stale one is obvious in a failure. */
  takenAt: string;
  /** Folder -> the status the run ended in. */
  status: Record<string, string>;
  /** Folder -> agreement percentage, for the jobs we hold a vendor workbook for. */
  agreement: Record<string, number>;
  /** Folder -> the ICES error codes its workbook draws. */
  icesCodes: Record<string, string[]>;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function currentState(): Promise<Baseline> {
  // state.json is keyed by folder directly — the same file corpus-export.mts
  // resumes from.
  const state = await readJson<Record<string, { status: string }>>(
    path.join(OUT_ROOT, 'state.json'),
  );
  const scorecard = await readJson<{ jobs: { folder: string; agreement: number }[] }>(
    path.join(OUT_ROOT, 'comparison', 'scorecard.json'),
  );
  const ices = await readJson<{ byJob?: Record<string, string[]> }>(
    path.join(OUT_ROOT, 'comparison', 'ices.json'),
  );

  const status: Record<string, string> = {};
  for (const [folder, s] of Object.entries(state ?? {}))
    if (s && typeof s.status === 'string') status[folder] = s.status;

  const agreement: Record<string, number> = {};
  for (const j of scorecard?.jobs ?? []) agreement[j.folder] = j.agreement;

  return {
    takenAt: new Date().toISOString().slice(0, 10),
    status,
    agreement,
    icesCodes: ices?.byJob ?? {},
  };
}

function compare(base: Baseline, now: Baseline): string[] {
  const failures: string[] = [];

  for (const [folder, was] of Object.entries(base.status)) {
    const is = now.status[folder];
    if (is === undefined) {
      failures.push(`${folder}: was "${was}" and is absent from this run`);
      continue;
    }
    if (was === 'ok' && is !== 'ok')
      failures.push(`${folder}: exported before and is now "${is}"`);
  }

  for (const [folder, was] of Object.entries(base.agreement)) {
    const is = now.agreement[folder];
    if (is === undefined) {
      failures.push(`${folder}: had ${was}% agreement and was not compared in this run`);
      continue;
    }
    // A tenth of a point is rounding in the compare script, not a regression.
    if (is < was - 0.1) failures.push(`${folder}: agreement fell ${was}% -> ${is}%`);
  }

  for (const [folder, was] of Object.entries(base.icesCodes)) {
    const is = now.icesCodes[folder] ?? [];
    const added = is.filter((c) => !was.includes(c));
    if (added.length) failures.push(`${folder}: draws new ICES rejection(s) ${added.join(', ')}`);
  }
  for (const [folder, is] of Object.entries(now.icesCodes)) {
    if (base.icesCodes[folder] === undefined && is.length)
      failures.push(`${folder}: is new and already draws ICES rejection(s) ${is.join(', ')}`);
  }

  return failures;
}

async function main(): Promise<void> {
  const now = await currentState();
  if (!Object.keys(now.status).length) {
    console.error(
      `No corpus run found under ${OUT_ROOT}. Run scripts/corpus-export.mts first — this ` +
        'gate reads its output, it does not produce it.',
    );
    process.exit(1);
  }

  if (process.argv.includes('--update')) {
    await writeFile(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
    const exported = Object.values(now.status).filter((s) => s === 'ok').length;
    console.log(
      `Baseline updated: ${exported}/${Object.keys(now.status).length} exporting, ` +
        `${Object.keys(now.agreement).length} scored.`,
    );
    return;
  }

  const base = await readJson<Baseline>(BASELINE);
  if (!base) {
    console.error(`No baseline at ${BASELINE}. Take one with --update after a run you trust.`);
    process.exit(1);
  }

  const failures = compare(base, now);
  const exported = Object.values(now.status).filter((s) => s === 'ok').length;
  console.log(
    `Against the baseline of ${base.takenAt}: ${exported}/${Object.keys(now.status).length} ` +
      'folders exporting.',
  );

  if (!failures.length) {
    console.log('No regression.');
    return;
  }
  console.error(`\n${failures.length} regression(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nIf these are intended, re-run with --update and commit the new baseline with a ' +
      'reason. Do not update it to make a red build green.',
  );
  process.exit(1);
}

void main();
