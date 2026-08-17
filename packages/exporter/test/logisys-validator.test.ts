import type { ChecklistDraft } from '@checklist/extraction';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT } from './fixtures/ep061126-1.js';
import { openWorkbook, readSheet } from './read.js';

/**
 * Regression test for the 43 errors Logi-Sys returned on the first real upload.
 *
 * The job: two lines of Fuchs fluorocarbon gel (CTH 3403.99.00) flown Boston to
 * Mumbai, filed prior, C&F. Its workbook came back from the Logi-Sys upload
 * validator with an ErrorList naming seven distinct problems, and every one of
 * them was a mapping decision here rather than bad extraction. Each `it` below
 * quotes the ErrorList line it guards, because the values it asserts look
 * arbitrary without it — 'A', 'H', 'P' and 'C&F' are not derivable from
 * anything except what that validator says it accepts.
 */

const AIR_JOB = { id: 'f5982478', reference: 'FUCHS-13841' };

/** The failing job, expressed as the smallest departure from the golden draft. */
const AIR_DRAFT: ChecklistDraft = {
  ...EP061126_1_DRAFT,
  transportMode: 'Air',
  filingStatus: 'Prior',
  customStation: { code: 'INBOM4', name: 'Mumbai Air Cargo' },
  shipment: {
    ...EP061126_1_DRAFT.shipment,
    // As extracted from the air waybill, line break and all.
    shippingLineOrCarrier: 'DSV AIR & SEA INC\nBOSTON',
    countryOfOrigin: 'United States',
    consCountry: 'United States',
    portOfLoading: 'Boston',
    containers: [],
  },
  invoice: { ...EP061126_1_DRAFT.invoice, termsOfInvoice: 'CFR' },
  items: [
    {
      ...EP061126_1_DRAFT.items[0]!,
      slNo: 1,
      description: '880FG-UV-8LB FLUOROCARBON GEL 880FG W/UV DYE 8LB PAIL',
      ritc: '34039900',
      quantity: 10,
      unit: 'NOS',
      unitPrice: 358.32,
      amount: 3583.2,
      // A Certificate of Analysis that gives batch numbers and no dates, which
      // is the usual shape for a chemical COA.
      batch: { batchNo: 'JT260407', quantity: 10 },
    },
    {
      ...EP061126_1_DRAFT.items[0]!,
      slNo: 2,
      description: '880FG-UV-55CC-CL-CASE FLUOROCARBON GEL 880FG W/UV DYE 55CC CLEA',
      ritc: '34039900',
      quantity: 16,
      unit: 'NOS',
      unitPrice: 731.29,
      amount: 11700.64,
      batch: { batchNo: 'JC260128', quantity: 16 },
    },
  ],
  singleWindowInfo: [],
  supportingDocs: [
    { fileName: '13841 AWB.pdf', docType: 'air_waybill' },
    { fileName: '13841 COA.pdf', docType: 'certificate_of_analysis' },
    { fileName: '13841 CL.pdf', docType: 'invoice' },
  ],
};

describe('the Logi-Sys upload validator, as it rejected job FUCHS-13841', () => {
  let workbook: Buffer;
  let warnings: string[];

  beforeAll(async () => {
    const result = await buildLogisysWorkbook({ draft: AIR_DRAFT, job: AIR_JOB });
    workbook = result.buffer;
    warnings = result.warnings;
  });

  it("codes the transport mode 'A', not AIR", async () => {
    // GENERAL : TransportModeCode : Expected values are 'A' for Air and 'S' for Sea
    const [row] = await readSheet(workbook, 'GENERAL');
    expect(row!['TransportModeCode']).toBe('A');
  });

  it("codes the BE type 'H', not HOME", async () => {
    // GENERAL : BETypeCode : Expected values are 'H' for Home, 'I' for Inbond, ...
    const [row] = await readSheet(workbook, 'GENERAL');
    expect(row!['BETypeCode']).toBe('H');
  });

  it("codes the filing status 'P', not PRIOR", async () => {
    // GENERAL : AdvancePriorNormal : Expected values are 'A' for Advance and 'P'
    // for Prior and 'N' for Normal
    const [row] = await readSheet(workbook, 'GENERAL');
    expect(row!['AdvancePriorNormal']).toBe('P');
  });

  it("spells cost-and-freight 'C&F', not CFR", async () => {
    // INVOICES : TOI : Expected values are FOB / CIF / C&F / C&I.
    const [row] = await readSheet(workbook, 'INVOICES');
    expect(row!['TOI']).toBe('C&F');
  });

  it('fills CETH on every item, with the same 8 digits as the CTH', async () => {
    // ITEMS : CETH : Invoice No. #1 Product No. #1 This field is mandatory
    const rows = await readSheet(workbook, 'ITEMS');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row['CETH']).toBe('34039900');
      expect(row['CETH']).toBe(row['CTH']);
    }
  });

  it('drops batch rows that have no manufacture or expiry date, and says so', async () => {
    // SW_PRODUCTION : Prod_Manufacturer_Date : Invoice No. #1 Product No. #1
    // This field is mandatory (and the same for expiry and best-before)
    const wb = await openWorkbook(workbook);
    expect(wb.getWorksheet('SW_PRODUCTION')!.rowCount).toBe(1);

    const dropped = warnings.filter((w) => w.startsWith('SW_PRODUCTION'));
    expect(dropped).toHaveLength(2);
    expect(dropped.join(' ')).toContain('JT260407');
    expect(dropped.join(' ')).toContain('JC260128');
  });

  it('lists no supporting documents at all', async () => {
    // SUPPORTING_DOCS : Doc_IRN : ... This field is mandatory — 33 of the 43
    // errors, eleven columns across three document rows.
    const wb = await openWorkbook(workbook);
    expect(wb.getWorksheet('SUPPORTING_DOCS')!.rowCount).toBe(1);
    expect(warnings.some((w) => w.startsWith('SUPPORTING_DOCS') && w.includes('13841 AWB.pdf'))).toBe(true);
  });

  it('keeps the line break out of the carrier name', async () => {
    // Not on the ErrorList, but a newline inside a cell is not something to put
    // on a declaration.
    const [row] = await readSheet(workbook, 'SHIPMENT');
    expect(row!['CarrierName']).toBe('DSV AIR & SEA INC BOSTON');
  });
});

describe('SW_PRODUCTION when the dates are known', () => {
  it('emits the row, with best-before standing in for expiry', async () => {
    const draft: ChecklistDraft = {
      ...AIR_DRAFT,
      items: [
        {
          ...AIR_DRAFT.items[0]!,
          batch: {
            batchNo: 'JT260407',
            quantity: 10,
            manufactureDate: '2026-04-07',
            expiryDate: '2028-04-06',
          },
        },
      ],
    };

    const { buffer, warnings } = await buildLogisysWorkbook({ draft, job: AIR_JOB });
    const [row] = await readSheet(buffer, 'SW_PRODUCTION');
    expect(row!['Prod_Batch_ID']).toBe('JT260407');
    expect(row!['Prod_Batch_Quantity']).toBe(10);
    expect(row!['Prod_Batch_Unit']).toBe('NOS');
    expect(row!['Prod_Manufacturer_Date']).toBe('07-Apr-2026');
    expect(row!['Prod_Expiry_Date']).toBe('06-Apr-2028');
    // The draft models no separate best-before date; Logi-Sys makes the column
    // mandatory, and for these goods it is the same date on the pack.
    expect(row!['Prod_Best_before_Date']).toBe('06-Apr-2028');
    expect(warnings.some((w) => w.startsWith('SW_PRODUCTION'))).toBe(false);
  });
});

describe('terms of invoice Logi-Sys has no value for', () => {
  it('refuses to export rather than picking the nearest one', async () => {
    // Ex-Works is a real Incoterm and not one of the four. mergeDraft rewrites
    // it to FOB long before this point, so this is the safety net for a draft
    // that reaches the exporter some other way.
    const draft: ChecklistDraft = {
      ...AIR_DRAFT,
      invoice: { ...AIR_DRAFT.invoice, termsOfInvoice: 'EXW' },
    };

    await expect(buildLogisysWorkbook({ draft, job: AIR_JOB })).rejects.toThrow(/INVOICES\.TOI/);
  });
});
