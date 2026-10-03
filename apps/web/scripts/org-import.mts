/**
 * Load an Organization Repository export from the command line.
 *
 * The same `applyOrganizationImport` the upload route calls — this only
 * supplies the bytes and the company, because the browser route needs a signed
 * in company manager and a repair does not have one.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --conditions react-server scripts/org-import.mts \
 *     ../../OrganizationRepository_78_20260811_194754.xlsx [--company <uuid>]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyOrganizationImport, importFailed } from '@/lib/org-import';
import { serviceClient } from '@/lib/supabase/admin';

/** Kuber — the company that holds the organization repository. */
const COMPANY_ID = process.env.CORPUS_COMPANY_ID ?? '39ec24f0-2254-4e08-abbd-4fe19c09f878';
/** pre-alert.import@kuberrgroup.com, the company admin these uploads belong to. */
const IMPORTED_BY = process.env.CORPUS_PROFILE_ID ?? 'd8017e21-3216-4e38-824b-fe915fa971be';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Give the path to the exported .xlsx file.');
  process.exit(1);
}
const at = argv.indexOf('--company');
const companyId = at >= 0 ? (argv[at + 1] ?? COMPANY_ID) : COMPANY_ID;

const data = await readFile(file);
const db = serviceClient();

const activeCount = async () => {
  const { count } = await db
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true);
  return count ?? 0;
};

const before = await activeCount();
console.log(`${before} active organizations before.`);

const outcome = await applyOrganizationImport({
  companyId,
  userId: IMPORTED_BY,
  fileName: path.basename(file),
  data,
});

if (importFailed(outcome)) {
  console.error(`Refused (${outcome.status}): ${outcome.error}`);
  process.exit(1);
}

console.log(
  `rows ${outcome.rowCount}, inserted ${outcome.inserted}, updated ${outcome.updated}, ` +
    `retired ${outcome.retired}`,
);
for (const w of outcome.warnings.slice(0, 5)) console.log(`  warning: ${w}`);
if (outcome.warnings.length > 5) console.log(`  … and ${outcome.warnings.length - 5} more`);
console.log(`${await activeCount()} active organizations after.`);
