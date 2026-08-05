/**
 * Extraction eval: run the full pipeline on the raw docs of the two reference
 * jobs (the checklist PDFs themselves are excluded — they are the answer key)
 * and diff key outcomes against expectations transcribed from those checklists.
 *
 * Usage: OPENAI_API_KEY=... pnpm eval [jobDir ...]
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runPipeline } from '../src/index.js';
import type { ChecklistDraft } from '../src/index.js';

const ERP_ROOT = path.resolve(import.meta.dirname, '../../../..');

interface Expectation {
  transportMode: string;
  importerGstin: string;
  invoiceNumber: string;
  toi: string;
  ritc: string;
  totalAssessableValue: number | null;
  dutyPayable: number | null;
  dutyComputed?: boolean;
  ftaScheme?: string;
  note?: string;
}

const EXPECTATIONS: Record<string, Expectation> = {
  ex_job1: {
    transportMode: 'Air',
    importerGstin: '27AABCB0983D1ZY',
    invoiceNumber: 'INV00000208940',
    toi: 'C&F',
    ritc: '34039900',
    // Insurance now auto-applies from the importer's marine open-policy rate
    // (0.0118% of C&F) — AV lands within a paisa, duty payable exactly.
    totalAssessableValue: null,
    dutyPayable: 419_638,
    dutyComputed: true,
  },
  ex_job2: {
    transportMode: 'Sea',
    importerGstin: '07AAFCF4316C1Z3',
    invoiceNumber: 'BFL/2026-27/038',
    toi: 'CIF',
    ritc: '17021110',
    totalAssessableValue: 2_859_000,
    dutyPayable: 142_950,
    ftaScheme: 'DFTP',
  },
};

function check(label: string, actual: unknown, expected: unknown): boolean {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  return ok;
}

async function evalJob(jobDir: string): Promise<{ passed: number; failed: number }> {
  const name = path.basename(jobDir);
  const expected = EXPECTATIONS[name];
  const fileNames = (await readdir(jobDir)).filter(
    (f) => f.toLowerCase().endsWith('.pdf') && !f.toLowerCase().includes('checklist'),
  );
  console.log(`\n━━━ ${name}: ${fileNames.join(', ')}`);

  const files = await Promise.all(
    fileNames.map(async (fileName) => ({ fileName, pdf: await readFile(path.join(jobDir, fileName)) })),
  );
  const t0 = Date.now();
  const { draft, docs } = await runPipeline(files, {
    today: '2026-08-05',
    onProgress: (e) => console.log(`  … ${e.stage} ${e.fileName ?? ''} ${e.detail ?? ''}`),
  });
  console.log(`  (pipeline ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  for (const d of docs) console.log(`  📄 ${d.fileName} → ${d.docType} [${d.model}]`);

  let passed = 0;
  let failed = 0;
  const tally = (ok: boolean) => (ok ? passed++ : failed++);

  if (expected) {
    tally(check('transport mode', draft.transportMode, expected.transportMode));
    tally(check('importer GSTIN (masters match)', draft.importer.gstin, expected.importerGstin));
    tally(check('invoice number', draft.invoice.invoiceNumber, expected.invoiceNumber));
    tally(check('terms of invoice', draft.invoice.termsOfInvoice, expected.toi));
    tally(check('item RITC', draft.items[0]?.ritc, expected.ritc));
    if (expected.dutyComputed)
      tally(check('duty computed (payable > 0)', (draft.duty?.dutyPayable ?? 0) > 0, true));
    if (expected.totalAssessableValue != null)
      tally(check('total assessable value', draft.duty?.totalAssessableValue, expected.totalAssessableValue));
    if (expected.dutyPayable != null) tally(check('duty payable', draft.duty?.dutyPayable, expected.dutyPayable));
    if (expected.ftaScheme) tally(check('FTA scheme', draft.ftaClaim?.scheme, expected.ftaScheme));
    if (expected.note) console.log(`  ℹ️  ${expected.note}`);
  }

  console.log(`  items: ${draft.items.map((i) => `${i.ritc} ${i.description.slice(0, 40)}… qty ${i.quantity} ${i.unit}`).join(' | ')}`);
  console.log(`  duty: AV ${draft.duty?.totalAssessableValue} payable ${draft.duty?.dutyPayable} (${draft.duty?.dutyPayableInWords ?? 'n/a'})`);
  console.log(`  flags:`);
  for (const f of draft.flags) console.log(`    [${f.severity}] ${f.path ?? ''} ${f.message}`);

  return { passed, failed };
}

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ERP_ROOT, 'ex_job1'), path.join(ERP_ROOT, 'ex_job2')];

let totalPassed = 0;
let totalFailed = 0;
for (const dir of dirs) {
  const { passed, failed } = await evalJob(dir);
  totalPassed += passed;
  totalFailed += failed;
}
console.log(`\n═══ eval: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed ? 1 : 0);
