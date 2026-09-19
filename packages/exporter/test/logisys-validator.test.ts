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
  // The header is what the GENERAL mapper reads; the three fields above are the
  // draft-level copies applyGeneralResolution keeps in step with it.
  boe: {
    ...EP061126_1_DRAFT.boe!,
    transportMode: { value: 'Air', source: 'document' },
    customStation: {
      value: { code: 'INBOM4', name: 'Mumbai Air Cargo' },
      source: 'mail',
    },
    filingStatus: { value: 'Prior', source: 'operator' },
  },
  shipment: {
    ...EP061126_1_DRAFT.shipment,
    // As extracted from the air waybill, line break and all.
    shippingLineOrCarrier: 'DSV AIR & SEA INC\nBOSTON',
    countryOfOrigin: 'United States',
    consCountry: 'United States',
    portOfLoading: 'Boston',
    containers: [],
  },
  invoices: [{ ...EP061126_1_DRAFT.invoices[0]!, termsOfInvoice: 'CFR' }],
  items: [
    {
      ...EP061126_1_DRAFT.items[0]!,
      slNo: 1,
      invoiceSrNo: 1,
      description: '880FG-UV-8LB FLUOROCARBON GEL 880FG W/UV DYE 8LB PAIL',
      ritc: '34039900',
      quantity: 10,
      unit: 'NOS',
      unitPrice: 358.32,
      amount: 3583.2,
      // A Certificate of Analysis that gives batch numbers and no dates, which
      // is the usual shape for a chemical COA.
      batches: [{ batchNo: 'JT260407', quantity: 10 }],
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
      batches: [{ batchNo: 'JC260128', quantity: 16 }],
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

  it("fills CETH on every item with NOEXCISE, not the CTH", async () => {
    // ITEMS : CETH : Invoice No. #1 Product No. #1 This field is mandatory
    //
    // The ErrorList said only that the column must not be empty, so this first
    // shipped as a copy of the CTH. Both of Logi-Sys' own exports — I-10793 and
    // the desk's corrected e4a144cd — write NOEXCISE instead, which is the
    // truthful answer: an imported good has no Central Excise Tariff Heading,
    // and repeating the CTH asserts an excise classification that does not
    // exist.
    const rows = await readSheet(workbook, 'ITEMS');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row['CETH']).toBe('NOEXCISE');
      expect(row['CETH']).not.toBe(row['CTH']);
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
  it('emits the row', async () => {
    const draft: ChecklistDraft = {
      ...AIR_DRAFT,
      items: [
        {
          ...AIR_DRAFT.items[0]!,
          batches: [
            {
              batchNo: 'JT260407',
              quantity: 10,
              manufactureDate: '2026-04-07',
              expiryDate: '2028-04-06',
              bestBeforeDate: '2027-10-06',
            },
          ],
        },
      ],
    };

    const { buffer, warnings } = await buildLogisysWorkbook({ draft, job: AIR_JOB });
    const [row] = await readSheet(buffer, 'SW_PRODUCTION');
    expect(row!['Prod_Batch_ID']).toBe('JT260407');
    // CONFIRM the precision: no vendor export we hold has a SW_PRODUCTION row,
    // so this follows the N(16,6) the spec gives the column.
    expect(row!['Prod_Batch_Quantity']).toBe('10.000000');
    expect(row!['Prod_Batch_Unit']).toBe('NOS');
    expect(row!['Prod_Manufacturer_Date']).toBe('07-Apr-2026');
    expect(row!['Prod_Expiry_Date']).toBe('06-Apr-2028');
    // A best-before is a quality date and an expiry a safety date. This mapper
    // used to write the expiry into both; it no longer does.
    expect(row!['Prod_Best_before_Date']).toBe('06-Oct-2027');
    expect(warnings.some((w) => w.startsWith('SW_PRODUCTION'))).toBe(false);
  });

  it('drops the row when only the best-before date is missing', async () => {
    // Logi-Sys makes all three dates mandatory, stricter than ICES, which marks
    // Best Before optional. The uploader is what we have to satisfy.
    const draft: ChecklistDraft = {
      ...AIR_DRAFT,
      items: [
        {
          ...AIR_DRAFT.items[0]!,
          batches: [
            { batchNo: 'JT260407', manufactureDate: '2026-04-07', expiryDate: '2028-04-06' },
          ],
        },
      ],
    };

    const { buffer, warnings } = await buildLogisysWorkbook({ draft, job: AIR_JOB });
    expect(await readSheet(buffer, 'SW_PRODUCTION')).toHaveLength(0);
    expect(warnings.some((w) => w.startsWith('SW_PRODUCTION') && w.includes('best-before'))).toBe(true);
  });

  it('files one row per lot when the certificate breaks the line into several', async () => {
    const draft: ChecklistDraft = {
      ...AIR_DRAFT,
      items: [
        {
          ...AIR_DRAFT.items[0]!,
          batches: [
            { batchNo: 'L-1', manufactureDate: '2026-04-07', expiryDate: '2028-04-06', bestBeforeDate: '2028-04-06' },
            { batchNo: 'L-2', manufactureDate: '2026-05-11', expiryDate: '2028-05-10', bestBeforeDate: '2028-05-10' },
          ],
        },
      ],
    };

    const { buffer } = await buildLogisysWorkbook({ draft, job: AIR_JOB });
    const rows = await readSheet(buffer, 'SW_PRODUCTION');
    expect(rows.map((r) => r['Prod_Batch_ID'])).toEqual(['L-1', 'L-2']);
    // Both hang off the same line, so both keys repeat.
    expect(rows.every((r) => r['Inv_SrNo'] === '1' && r['Item_SrNo'] === '1')).toBe(true);
  });
});

describe('terms of invoice Logi-Sys has no value for', () => {
  it('refuses to export rather than picking the nearest one', async () => {
    // Ex-Works is a real Incoterm and not one of the four. mergeDraft rewrites
    // it to FOB long before this point, so this is the safety net for a draft
    // that reaches the exporter some other way.
    const draft: ChecklistDraft = {
      ...AIR_DRAFT,
      invoices: [{ ...AIR_DRAFT.invoices[0]!, termsOfInvoice: 'EXW' }],
    };

    // The path names the invoice as well as the column: a Bill of Entry can
    // carry a dozen, and "INVOICES.TOI" would not say which one.
    await expect(buildLogisysWorkbook({ draft, job: AIR_JOB })).rejects.toThrow(/INVOICES\[1\]\.TOI/);
  });
});

describe('the Logi-Sys upload validator, as it rejected job dbf3530c', () => {
  /**
   * The whole workbook came back with four errors and nothing else:
   *
   *   CONTAINERS : IGM Sr.No : Shipment #nullContainer #1 This field is mandatory
   *   ... and the same for containers #2, #3 and #4.
   *
   * Logi-Sys rejects the file entire on any error, so the invoice and the four
   * products never landed either — which read as "the products are not being
   * picked up" when the products were never the problem.
   */
  const SEA_DRAFT: ChecklistDraft = {
    ...EP061126_1_DRAFT,
    shipment: {
      ...EP061126_1_DRAFT.shipment,
      containers: [
        { number: 'MRKU5476879', sizeType: '40HC', sealNo: 'ML-AE4514913' },
        { number: 'GAOU7335753', sizeType: '40HC', sealNo: 'ML-AE4514917' },
        { number: 'MRSU7310982', sizeType: '40HC', sealNo: 'ML-AE4514911' },
        { number: 'GCXU6202790', sizeType: '40HC', sealNo: 'ML-AE4514915' },
      ],
    },
  };

  it('numbers every container, so none of the four errors can recur', async () => {
    const { buffer, warnings } = await buildLogisysWorkbook({
      draft: SEA_DRAFT,
      job: { id: 'dbf3530c', reference: 'RAJSHREE-1' },
    });
    const rows = await readSheet(buffer, 'CONTAINERS');

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r['IGM Sr.No'])).toEqual(['1', '2', '3', '4']);
    for (const row of rows) {
      expect(row['IGM Sr.No']).toBeDefined();
      expect(String(row['IGM Sr.No'])).not.toBe('');
    }

    // Guessed, so said out loud: the serials are positional, not read off an IGM.
    const warning = warnings.find((w) => w.startsWith('CONTAINERS.IGM Sr.No'));
    expect(warning).toContain('1–4');
  });

  it('says so when the B/L states more containers than the workbook declares', async () => {
    // The other way this sheet goes wrong, and the quieter one. Four rows in a
    // workbook is indistinguishable from a correct workbook unless something
    // holds the B/L's own total up beside it.
    const { warnings } = await buildLogisysWorkbook({
      draft: {
        ...SEA_DRAFT,
        shipment: { ...SEA_DRAFT.shipment, containerCountStated: 6 },
      },
      job: { id: 'dbf3530c', reference: 'RAJSHREE-1' },
    });

    const warning = warnings.find((w) => w.startsWith('CONTAINERS.Container No'));
    expect(warning).toContain('B/L states 6 containers');
    expect(warning).toContain('declares 4');
  });

  it('stays quiet when the stated total and the list agree', async () => {
    const { warnings } = await buildLogisysWorkbook({
      draft: {
        ...SEA_DRAFT,
        shipment: { ...SEA_DRAFT.shipment, containerCountStated: 4 },
      },
      job: { id: 'dbf3530c', reference: 'RAJSHREE-1' },
    });
    expect(warnings.some((w) => w.startsWith('CONTAINERS.Container No'))).toBe(false);
  });
});
