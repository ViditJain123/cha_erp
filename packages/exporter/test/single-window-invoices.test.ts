import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * Single Window rows on a multi-invoice Bill of Entry.
 *
 * Item serials restart per invoice, so line 1 of invoice 2 and line 1 of
 * invoice 1 share `Item_SrNo`. `Inv_SrNo` was the literal 1 on SW_ADDL_INFO and
 * SW_PRODUCTION, which filed every line's declarations against invoice 1.
 */
function twoInvoices(): ChecklistDraft {
  const base = structuredClone(EP061126_1_DRAFT);
  const [inv] = base.invoices;
  const [item] = base.items;
  return {
    ...base,
    invoices: [inv!, { ...structuredClone(inv!), srNo: 2, invoiceNumber: 'ASI-EP061126-2' }],
    items: [
      item!,
      {
        ...structuredClone(item!),
        invoiceSrNo: 2,
        slNo: 1,
        ritc: '17021110',
        unit: 'KGS',
        batches: [{ batchNo: 'B-2', manufactureDate: '2026-05-05', expiryDate: '2028-05-04', bestBeforeDate: '2028-05-04', quantity: 100 }],
      },
    ],
    singleWindowInfo: [
      { invoiceSrNo: 1, itemSlNo: 1, infoType: 'Item Characteristics', qualifier: 'Standard UQC', measurement: 156450, unit: 'KGS' },
      { invoiceSrNo: 2, itemSlNo: 1, infoType: 'Item Characteristics', qualifier: 'Standard UQC', measurement: 100, unit: 'KGS' },
      { invoiceSrNo: 2, itemSlNo: 1, infoType: 'Item Category', qualifier: 'Drug Related Category', code: 'MSC' },
    ],
  };
}

describe('Single Window rows on a multi-invoice Bill of Entry', () => {
  it('files each SW_ADDL_INFO row against its own invoice', async () => {
    const { buffer } = await buildLogisysWorkbook({ draft: twoInvoices(), job: EP061126_1_JOB });
    const rows = await readSheet(buffer, 'SW_ADDL_INFO');
    // The Drug Related Category row carries a code, not a measure, so it files
    // 0.000000 with a blank unit — the shape Logi-Sys' own exports use on every
    // family other than the standard quantity.
    expect(
      rows.map((r) => [r['Inv_SrNo'], r['Item_SrNo'], r['info_Qualifier'], r['Measure']]),
    ).toEqual([
      ['1', '1', 'SQC', '156450.000000'],
      ['2', '1', 'SQC', '100.000000'],
      ['2', '1', 'DRC', '0.000000'],
    ]);
  });

  it('files the batch against the invoice its line is on', async () => {
    const { buffer } = await buildLogisysWorkbook({ draft: twoInvoices(), job: EP061126_1_JOB });
    const rows = await readSheet(buffer, 'SW_PRODUCTION');
    expect(rows.map((r) => [r['Inv_SrNo'], r['Item_SrNo'], r['Prod_Batch_ID']])).toEqual([['2', '1', 'B-2']]);
  });

  it('puts DC007 on the line carrying the drug category, not its namesake on invoice 1', async () => {
    const { buffer } = await buildLogisysWorkbook({ draft: twoInvoices(), job: EP061126_1_JOB });
    const rows = await readSheet(buffer, 'STATEMENT');
    const lineCodes = rows
      .filter((r) => r['Item_SrNo'] !== '0')
      .map((r) => `${r['Inv_SrNo']}/${r['Item_SrNo']} ${r['StatementCode']}`);
    expect(lineCodes).toEqual(['1/1 PC002', '1/1 CUF02', '2/1 DC007', '2/1 CUF02']);
  });

  it('reads a stored row with no invoice serial as invoice 1', async () => {
    const draft = structuredClone(EP061126_1_DRAFT);
    const { buffer } = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
    const rows = await readSheet(buffer, 'SW_ADDL_INFO');
    expect(rows.every((r) => r['Inv_SrNo'] === '1')).toBe(true);
  });
});
