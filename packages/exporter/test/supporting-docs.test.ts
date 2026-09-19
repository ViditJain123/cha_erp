import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, DraftSupportingDoc } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * SUPPORTING_DOCS — the eSanchit document list.
 *
 * The format is checked against Logi-Sys' own exports, seven of which populate
 * this sheet. The conventions that matter, all from `ex_job31`:
 *
 *   Inv_SrNo / Item_SrNo  '0' / '0' for a shipment-level document
 *   Doc_Upload_DateTime   '14-08-2026 17:22:00' — the one column in the whole
 *                         workbook that is not DD-MMM-YYYY
 *   Doc_Issued_Date       '14-Aug-2026', like every other date
 *   both _Party_Code      blank; ICES does not validate them
 */

const withDocs = (docs: DraftSupportingDoc[]): ChecklistDraft => ({
  ...structuredClone(EP061126_1_DRAFT),
  supportingDocs: docs,
});

const build = (docs: DraftSupportingDoc[]) =>
  buildLogisysWorkbook({ draft: withDocs(docs), job: EP061126_1_JOB });

const BL: DraftSupportingDoc = {
  fileName: '20271 BL_Signed.PDF',
  docType: 'bill_of_lading',
  irn: '2026082400084879',
  uploadedAt: '2026-08-24T14:58:00',
  referenceNo: 'MEDUJ1234567',
  issuedAt: 'United States',
  issueDate: '2026-08-24',
};

describe('a document with no eSanchit IRN', () => {
  it('files no row and warns, naming the file', async () => {
    // The golden job predates the IRN capture, so this is also what it still
    // produces: four documents, no rows, one warning.
    const { buffer, warnings } = await buildLogisysWorkbook({
      draft: EP061126_1_DRAFT,
      job: EP061126_1_JOB,
    });
    expect(await readSheet(buffer, 'SUPPORTING_DOCS')).toHaveLength(0);

    const [warning] = warnings.filter((w) => w.startsWith('SUPPORTING_DOCS'));
    expect(warning).toBeDefined();
    for (const file of [
      'COPY BL EP061126-1.pdf',
      'EPA EP061126-1.pdf',
      'INV EP061126-1.pdf',
      'PL EP061126-1.pdf',
    ]) {
      expect(warning, `names ${file}`).toContain(file);
    }
  });

  it('warns about only the documents that are waiting', async () => {
    const { buffer, warnings } = await build([
      BL,
      { fileName: 'PL.pdf', docType: 'packing_list' },
    ]);
    expect(await readSheet(buffer, 'SUPPORTING_DOCS')).toHaveLength(1);
    const [warning] = warnings.filter((w) => w.startsWith('SUPPORTING_DOCS: 1 supporting'));
    expect(warning).toContain('PL.pdf');
    expect(warning).not.toContain('20271 BL_Signed.PDF');
  });
});

describe('a document that has been uploaded', () => {
  it('writes the row the way the vendor writes it', async () => {
    const { buffer } = await build([BL]);
    const [row] = await readSheet(buffer, 'SUPPORTING_DOCS');
    expect(row).toMatchObject({
      Inv_SrNo: '0',
      Item_SrNo: '0',
      Doc_IRN: '2026082400084879',
      // Numeric, not DD-MMM-YYYY. This one column differs from every other date
      // in the workbook and every vendor row writes it this way.
      Doc_Upload_DateTime: '24-08-2026 14:58:00',
      Doc_Type: '705000',
      File_Type: 'pdf',
      Icegate_File_Name: '20271 BL_Signed.PDF',
      Doc_Issued_At: 'United States',
      Doc_Issued_Date: '24-Aug-2026',
    });
  });

  it('names the importer as the beneficiary and leaves both party codes blank', async () => {
    const { buffer } = await build([BL]);
    const [row] = await readSheet(buffer, 'SUPPORTING_DOCS');
    expect(row!['Doc_Beneficiary_Party_Name']).toBe(EP061126_1_DRAFT.importer.name);
    expect(row!['Doc_Issuing_Party_Code']).toBeUndefined();
    expect(row!['Doc_Beneficiary_Party_Code']).toBeUndefined();
  });

  it('scopes an invoice-level document to its invoice', async () => {
    const { buffer } = await build([{ ...BL, docType: 'invoice', invoiceSrNo: 1 }]);
    const [row] = await readSheet(buffer, 'SUPPORTING_DOCS');
    expect([row!['Inv_SrNo'], row!['Item_SrNo']]).toEqual(['1', '0']);
    expect(row!['Doc_Type']).toBe('380000');
  });

  it('truncates the reference number at seventeen characters', async () => {
    // C(17), and ex_job31 holds a document name truncated to exactly that.
    const { buffer } = await build([
      { ...BL, referenceNo: '20236 FTO-Certificate of Approval' },
    ]);
    const [row] = await readSheet(buffer, 'SUPPORTING_DOCS');
    expect(row!['Reference_No.']).toBe('20236 FTO-Certifi');
  });

  it('warns when the IRN and the upload timestamp disagree on the date', async () => {
    const { warnings } = await build([{ ...BL, uploadedAt: '2026-08-25T14:58:00' }]);
    expect(warnings.join('\n')).toMatch(/belongs to a different document/);
  });

  it('warns when the reference number is missing, which Logi-Sys makes mandatory', async () => {
    const { referenceNo: _dropped, ...noRef } = BL;
    const { warnings } = await build([noRef]);
    expect(warnings.join('\n')).toMatch(/No reference number/);
  });

  it('drops a document whose type has no eSanchit code, rather than guessing one', async () => {
    const { buffer, warnings } = await build([{ ...BL, docType: 'other' }]);
    expect(await readSheet(buffer, 'SUPPORTING_DOCS')).toHaveLength(0);
    expect(warnings.join('\n')).toMatch(/No eSanchit document-type code/);
  });
});
