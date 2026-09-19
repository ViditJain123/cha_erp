import { describe, expect, it } from 'vitest';
import { attachReImport, REIMPORT_DESCRIPTION } from '../src/re-import.js';
import type { DraftItem } from '../src/draft.js';
import type { InvoiceDoc, ShippingBillExtract } from '../src/schemas.js';

/**
 * Matching a shipping bill to the lines that came back under it.
 *
 * The two real bills in the corpus are the shape everything here is built on:
 *
 *   - `ex_job3/13592 SB.pdf` — SB 8942803, 21-Jan-2026, INNSA1, one invoice and
 *     one item of sesame seeds. RoDTEP and LICENCE set, DBK clear.
 *   - `ex_job29/14385 SHIPPING BILL.pdf` — SB 3250689, 03-Jul-2025, INNSA1,
 *     **two** invoices and **two** items, of which one came back. DBK and
 *     RoDTEP set.
 *
 * The second is why nothing here defaults a serial to 1.
 */

const line = (over: Partial<{ sbItemSrNo: number; hsCode: string; description: string; quantity: number }>) => ({
  sbItemSrNo: 1,
  hsCode: null,
  description: 'GOODS',
  quantity: null,
  unit: null,
  value: null,
  ...over,
});

function bill(over: Partial<ShippingBillExtract> = {}): ShippingBillExtract {
  return {
    sbNo: '3250689',
    sbDate: '2025-07-03',
    portCode: 'INNSA1',
    leoDate: '2025-07-03',
    exporterName: 'GUJARAT FLUOROCHEMICALS LIMITED',
    exporterIec: 'AAFCI0903C',
    exporterGstin: '24AAFCI0903C1ZB',
    consigneeName: 'HEAT TRACE LIMITED (U.K)',
    countryOfFinalDestination: 'UNITED KINGDOM',
    schemeFlags: {
      drawback: true,
      rodtep: true,
      meis: null,
      licence: null,
      dfrc: null,
      lut: null,
      reExport: null,
    },
    exchangeRate: null,
    marksAndNumbers: null,
    uncertainFields: [],
    invoices: [
      {
        sbInvSrNo: 1,
        invoiceNo: '242252000635',
        invoiceDate: '2025-06-30',
        invoiceTerm: 'FOB',
        currency: 'GBP',
        freightAmount: null,
        insuranceAmount: null,
        items: [line({ hsCode: '39046990', description: 'INOFLON PFA 8003' })],
      },
    ],
    ...over,
  } as ShippingBillExtract;
}

function item(over: Partial<DraftItem> = {}): DraftItem {
  return {
    slNo: 1,
    invoiceSrNo: 1,
    description: 'REIMPORT : INOFLON PFA 8003',
    ritc: '39046990',
    quantity: 3450,
    unit: 'KGS',
    unitPrice: 28.5,
    amount: 98325,
    bcdRate: 7.5,
    swsRate: 10,
    igstRate: 18,
    aidcRate: 0,
    compCessRate: 0,
    endUseCode: '',
    ...over,
  } as DraftItem;
}

describe('attaching a shipping bill', () => {
  it('fills the block from the bill and carries the bill’s own serials', () => {
    const items = [item()];
    attachReImport(items, [bill()], [], { beFilingDate: '2026-09-07' });
    const re = items[0]!.reImport!;
    expect(re.sbNo.value).toBe('3250689');
    expect(re.sbDate.value).toBe('2025-07-03');
    expect(re.portOfExport.value).toBe('INNSA1');
    expect(re.sbInvSrNo.value).toBe(1);
    expect(re.sbItemSrNo.value).toBe(1);
    expect(re.sbNo.source).toBe('document');
  });

  it('never chooses the notification — it offers the candidates', () => {
    const items = [item()];
    attachReImport(items, [bill()], [], { beFilingDate: '2026-09-07' });
    const re = items[0]!.reImport!;
    expect(re.notification).toBeUndefined();
    // DBK and RoDTEP are both set on ex_job29's bill, so both entries fit, plus
    // the residuary. One row carries one, and a person picks.
    expect(re.candidates?.map((c) => c.serial).sort()).toEqual(['1A', '1F', '5']);
    expect(re.candidates?.every((c) => c.notification === '045/2017')).toBe(true);
  });

  it('tells the operator which of the six amounts each candidate needs', () => {
    const items = [item()];
    attachReImport(items, [bill()], [], { beFilingDate: '2026-09-07' });
    const bySerial = new Map(items[0]!.reImport!.candidates!.map((c) => [c.serial, c]));
    expect(bySerial.get('1A')!.needsIncentiveRepayment).toBe(true);
    expect(bySerial.get('1A')!.needsExportFreightInsurance).toBe(false);
    expect(bySerial.get('5')!.needsIncentiveRepayment).toBe(false);
  });

  it('cautions only the candidates whose own time limit the return missed', () => {
    const items = [item()];
    attachReImport(items, [bill()], [], { beFilingDate: '2026-09-07' });
    const bySerial = new Map(items[0]!.reImport!.candidates!.map((c) => [c.serial, c.cautions]));
    // 03-Jul-2025 to 07-Sep-2026 is fourteen months. 1A and 5 allow three
    // years, so neither says anything.
    expect(bySerial.get('1A')!.filter((c) => /after export/.test(c))).toEqual([]);

    // The entry with the one-year limit is 1E, and it is the one ex_job29 was
    // actually filed under — which is why that folder holds a shipping bill
    // extension letter. Offer it, and the caution appears.
    const withLicence = bill();
    withLicence.schemeFlags.licence = true;
    const other = [item()];
    attachReImport(other, [withLicence], [], { beFilingDate: '2026-09-07' });
    const oneE = other[0]!.reImport!.candidates!.find((c) => c.serial === '1E')!;
    expect(oneE.cautions.some((c) => /14 months after export/.test(c))).toBe(true);
    expect(oneE.cautions.some((c) => /extension letter/.test(c))).toBe(true);
  });

  it('picks the line that came back out of a bill covering several', () => {
    const twoItems = bill({
      invoices: [
        {
          sbInvSrNo: 1,
          invoiceNo: '242252000622',
          invoiceDate: '2025-06-30',
          invoiceTerm: 'FOB',
          currency: 'GBP',
          freightAmount: null,
          insuranceAmount: null,
          items: [line({ sbItemSrNo: 1, hsCode: '39023000', description: 'POLYPROPYLENE GRANULES' })],
        },
        {
          sbInvSrNo: 2,
          invoiceNo: '242252000635',
          invoiceDate: '2025-06-30',
          invoiceTerm: 'FOB',
          currency: 'GBP',
          freightAmount: null,
          insuranceAmount: null,
          items: [line({ sbItemSrNo: 3, hsCode: '39046990', description: 'INOFLON PFA 8003' })],
        },
      ],
    } as Partial<ShippingBillExtract>);
    const items = [item()];
    attachReImport(items, [twoItems], [], { beFilingDate: '2026-09-07' });
    // The second invoice's third item — not 1/1, which is what a default would
    // have written and what ICES would have matched to the wrong export.
    expect(items[0]!.reImport!.sbInvSrNo.value).toBe(2);
    expect(items[0]!.reImport!.sbItemSrNo.value).toBe(3);
  });

  it('matches on the tariff heading over the words', () => {
    const items = [
      item({ slNo: 1, ritc: '39023000', description: 'REIMPORT : RANDOM POLYPROPYLENE RP2248N' }),
      item({ slNo: 2, ritc: '39046990', description: 'REIMPORT : INOFLON PFA 8003' }),
    ];
    attachReImport(items, [bill()], [], {});
    expect(items[0]!.reImport).toBeUndefined();
    expect(items[1]!.reImport).toBeDefined();
  });

  it('refuses to match two lines of the same subheading it cannot separate', () => {
    const twoAlike = bill({
      invoices: [
        {
          sbInvSrNo: 1,
          invoiceNo: 'X',
          invoiceDate: '2025-06-30',
          invoiceTerm: 'FOB',
          currency: 'GBP',
          freightAmount: null,
          insuranceAmount: null,
          items: [
            line({ sbItemSrNo: 1, hsCode: '39046990', description: 'INOFLON PFA 8003' }),
            line({ sbItemSrNo: 2, hsCode: '39046990', description: 'INOFLON PFA 8003' }),
          ],
        },
      ],
    } as Partial<ShippingBillExtract>);
    const items = [item()];
    const { flags } = attachReImport(items, [twoAlike], [], {});
    expect(items[0]!.reImport).toBeUndefined();
    expect(flags.some((f) => /matches two lines/.test(f.message))).toBe(true);
  });

  it('leaves an ordinary import alone', () => {
    const items = [item({ description: 'POLYPROPYLENE GRANULES', ritc: '39023000' })];
    const { flags } = attachReImport(items, [], [], {});
    expect(items[0]!.reImport).toBeUndefined();
    expect(flags).toEqual([]);
  });

  it('blocks a line that reads as a return with no shipping bill on the job', () => {
    const items = [item()];
    const { flags } = attachReImport(items, [], [], {});
    expect(flags[0]!.severity).toBe('error');
    expect(flags[0]!.message).toMatch(/no shipping bill is on the job/);
  });

  it('blocks a line that reads as a return the bill does not account for', () => {
    const items = [item({ description: 'RE-IMPORT OF SOMETHING ELSE', ritc: '85044090' })];
    const { flags } = attachReImport(items, [bill()], [], {});
    expect(flags.some((f) => f.severity === 'error' && /no line of shipping bill/.test(f.message))).toBe(true);
  });

  it('says where the export invoice’s figures belong', () => {
    const items = [item()];
    const exportInvoice = { invoiceNumber: 'FEI-2526-318' } as InvoiceDoc;
    const { flags } = attachReImport(items, [bill()], [exportInvoice], {});
    expect(flags.some((f) => /FEI-2526-318/.test(f.message) && /not filed as an invoice/.test(f.message))).toBe(true);
  });
});

describe('the description signal', () => {
  it('catches how the goldens actually word it', () => {
    for (const text of [
      'Re-import of Mechanically Hulled Autodried Sortexed Sesame seeds',
      'REIMPORT : INOFLON PFA 8003',
      '(RE-IMPORT) POLYTETRAFLUOROETHYLENE T305',
      'REJECTED AND RETURNBLE CARGO',
      'MATERIAL RETURN VIDE INVOICE',
    ]) {
      expect(REIMPORT_DESCRIPTION.test(text), text).toBe(true);
    }
  });

  it('does not fire on goods that merely have "return" in their name', () => {
    for (const text of ['CONDENSATE RETURN PUMP', 'RETURN LINE VALVE ASSEMBLY']) {
      expect(REIMPORT_DESCRIPTION.test(text), text).toBe(false);
    }
  });
});
