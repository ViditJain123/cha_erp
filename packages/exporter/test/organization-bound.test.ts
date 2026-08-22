import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * What the workbook carries once a party is bound to the organization
 * repository — the party master exported out of Logi-Sys.
 *
 * Logi-Sys resolves the importer and the supplier from that repository on name
 * and branch, so these columns are not descriptions of a party: they are the
 * key that finds it. The values here are the real repository rows for this
 * job's two parties.
 */

/** The repository row for ELITE POLYPLUS, branch "0". */
const boundImporter: ChecklistDraft['importer'] = {
  name: 'ELITE POLYPLUS',
  addressLines: ['707 HUBTOWN SOLARIS', 'NS PHADKE MARG, OPP TELI GALI', 'MUMBAI'],
  iec: 'AAJFE0052B',
  pan: 'AAJFE0052B',
  gstin: '27AAJFE0052B1Z1',
  gstStateCode: '27',
  gstStateName: 'MAHARASHTRA',
  adCode: '0410002',
  branchSno: '0',
  city: 'Mumbai',
  matchedFromMasters: true,
  organizationId: '00000000-0000-4000-8000-00000000000a',
  matchStatus: 'fuzzy',
};

/** The repository row for ASIA SHIGEN INTERNATIONAL CO., LTD, branch "1". */
const boundSupplier: ChecklistDraft['supplier'] = {
  name: 'ASIA SHIGEN INTERNATIONAL CO., LTD',
  addressLines: ['222-25-302, MOTOSHIRO-CHO', 'NAKA-KU, HAMAMATSU-CITY', 'SHIZUOKA'],
  city: 'Shizuoka',
  country: 'Japan',
  branchName: '1',
  organizationId: '00000000-0000-4000-8000-00000000000b',
  matchStatus: 'exact',
};

async function build(draft: ChecklistDraft) {
  return buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
}

describe('parties bound to the organization repository', () => {
  it('writes the importer name Logi-Sys holds, not the one on the bill of lading', async () => {
    const { buffer, warnings } = await build({ ...EP061126_1_DRAFT, importer: boundImporter });
    const [row] = await readSheet(buffer, 'GENERAL');

    // The hand-keyed attempt and the unbound draft both say "M/S. ELITE
    // POLYPLUS"; the repository says "ELITE POLYPLUS", and that is the string
    // Logi-Sys looks up.
    expect(row!['Importer']).toBe('ELITE POLYPLUS');
    expect(row!['AD_Code']).toBe('0410002');
    expect(warnings.some((w) => w.startsWith('GENERAL.Importer'))).toBe(false);
  });

  it('leaves Branch Name empty for a party whose repository branch is "0"', async () => {
    // "0" is how Logi-Sys spells "no branch", and the workbook that imported
    // cleanly for this job left the column empty.
    const { buffer } = await build({
      ...EP061126_1_DRAFT,
      importer: { ...boundImporter, branchName: '0' },
    });
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['Branch Name']).toBeUndefined();
  });

  it('writes a real branch name through', async () => {
    const { buffer } = await build({
      ...EP061126_1_DRAFT,
      importer: { ...boundImporter, branchName: 'Bangalore 2' },
    });
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['Branch Name']).toBe('Bangalore 2');
  });

  it('writes the supplier branch, so a multi-branch seller binds to the right row', async () => {
    const { buffer, warnings } = await build({ ...EP061126_1_DRAFT, supplier: boundSupplier });
    const [row] = await readSheet(buffer, 'INVOICES');

    expect(row!['Supplier_Name']).toBe('ASIA SHIGEN INTERNATIONAL CO., LTD');
    expect(row!['Supplier_Branch']).toBe('1');
    expect(row!['Supplier_City']).toBe('Shizuoka');
    expect(row!['Supplier_Country_Code']).toBe('JP');
    expect(warnings.some((w) => w.startsWith('INVOICES.Supplier_Name'))).toBe(false);
  });

  it('warns about a party it could not bind, and still produces the workbook', async () => {
    const { buffer, warnings } = await build(EP061126_1_DRAFT);

    expect(buffer.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('not bound to a row in the organization repository'))).toBe(
      true,
    );
    // Unbound is not a blocker: an unmatched name is the operator's to fix and
    // withholding the file would not tell them anything the warning does not.
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['Importer']).toBe('M/S. ELITE POLYPLUS');
  });
});
