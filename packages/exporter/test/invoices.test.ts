import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, DraftInvoice, DraftItem } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * INVOICES, rule by rule.
 *
 * The golden tests pin two whole workbooks against what Logi-Sys itself
 * produced. These pin the *rules* the sheet is dictated with
 * (`docs/boe-mapping/05-invoices.md`) — the branches no single golden job
 * exercises, because one job has one terms-of-invoice code and one payment
 * term.
 *
 * Every case builds a real workbook and reads the cells back, so what is
 * asserted is the file rather than the mapper's intermediate state.
 */

/** The `ex_job6` draft with its one invoice replaced. */
function withInvoices(invoices: DraftInvoice[], patch: Partial<ChecklistDraft> = {}): ChecklistDraft {
  const base = structuredClone(EP061126_1_DRAFT);
  const template = base.items[0]!;
  const items: DraftItem[] = invoices.map((inv, i) => ({
    ...structuredClone(template),
    slNo: 1,
    invoiceSrNo: inv.srNo,
    description: `GOODS ${i + 1}`,
  }));
  return {
    ...base,
    invoices,
    items,
    invoiceMeta: {
      exchangeRates: Object.fromEntries(
        [...new Set(invoices.map((i) => i.currency))].filter((c) => c !== 'INR').map((c) => [c, 96.05]),
      ),
    },
    ...patch,
  };
}

function invoice(over: Partial<DraftInvoice> = {}): DraftInvoice {
  return {
    srNo: 1,
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-06-30',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 10000,
    paymentMethod: 'Transaction',
    natureOfTransaction: 'Sale',
    relatedParty: false,
    ...over,
  };
}

async function invoiceRows(draft: ChecklistDraft): Promise<Record<string, unknown>[]> {
  const { buffer } = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
  return readSheet(buffer, 'INVOICES');
}

async function build(draft: ChecklistDraft) {
  return buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
}

describe('the terms of invoice decide which charges are declared', () => {
  it('declares neither on CIF — both are already in the price', async () => {
    const [row] = await invoiceRows(withInvoices([invoice({ termsOfInvoice: 'CIF' })]));
    expect(row!['TOI']).toBe('CIF');
    expect(row!['Frt_%']).toBe('0.0000');
    expect(row!['Frt_Amount']).toBe('0.00');
    expect(row!['Ins_%']).toBe('0.0000');
    expect(row!['Ins_Amount']).toBe('0.00');
  });

  it('declares insurance but not freight on C&F', async () => {
    const [row] = await invoiceRows(
      withInvoices([invoice({ termsOfInvoice: 'C&F', insurance: { kind: 'percent', percent: 1.125 } })]),
    );
    expect(row!['TOI']).toBe('C&F');
    expect(row!['Ins_%']).toBe('1.1250');
    // The rate is the claim; Logi-Sys computes the rupee figure from it.
    expect(row!['Ins_Amount']).toBe('0.00');
    expect(row!['Frt_Amount']).toBe('0.00');
  });

  it('declares freight but not insurance on C&I', async () => {
    const [row] = await invoiceRows(
      withInvoices([
        // 'CI' on the draft; 'C&I' is how Logi-Sys spells it in the cell.
        invoice({ termsOfInvoice: 'CI', freight: { amount: 1200, currency: 'USD' } }),
      ]),
    );
    expect(row!['TOI']).toBe('C&I');
    expect(row!['Frt_Amount']).toBe('1200.00');
    expect(row!['Frt_Currency']).toBe('USD');
    expect(row!['Ins_Amount']).toBe('0.00');
  });

  it('declares both on FOB', async () => {
    const [row] = await invoiceRows(
      withInvoices([
        invoice({
          termsOfInvoice: 'FOB',
          freight: { amount: 1200, currency: 'USD' },
          insurance: { kind: 'amount', value: { amount: 3400, currency: 'INR' } },
        }),
      ]),
    );
    expect(row!['Frt_Amount']).toBe('1200.00');
    expect(row!['Ins_Amount']).toBe('3400.00');
    // The premium is paid to an Indian insurer, so it is quoted in rupees even
    // though the invoice is in dollars.
    expect(row!['Ins_Currency']).toBe('INR');
  });

  it('warns rather than filling a freight it does not have', async () => {
    const { warnings } = await build(withInvoices([invoice({ termsOfInvoice: 'FOB' })]));
    expect(warnings.join('\n')).toMatch(/Frt_Amount.*freight is not in the price/s);
    // Rule 10(2)'s 20% is a valuation fallback for the officer, not a figure to
    // declare as an actual.
    expect(warnings.join('\n')).not.toMatch(/20\.0000/);
  });
});

describe('miscellaneous charges', () => {
  it('declares the actual amount, with the rate always nil', async () => {
    // `ex_job1`: a FREIGHT-CHARGE line of $590.75 taken out of the invoice
    // value and filed as Misc. Charges.
    const [row] = await invoiceRows(
      withInvoices([
        invoice({ invoiceValue: 15283.84, miscCharges: { amount: 590.75, currency: 'USD' } }),
      ]),
    );
    expect(row!['Product_Value']).toBe('15283.84');
    expect(row!['Misc_Charge_%']).toBe('0.0000');
    expect(row!['Misc_Charge_Amount']).toBe('590.75');
    expect(row!['Misc_Charge_Currency']).toBe('USD');
  });

  it('leaves the currency empty when there is nothing to charge', async () => {
    const [row] = await invoiceRows(withInvoices([invoice()]));
    expect(row!['Misc_Charge_Amount']).toBe('0.00');
    expect(row!['Misc_Charge_Currency']).toBeUndefined();
  });

  it('warns when the charge is not in the invoice currency', async () => {
    const { warnings } = await build(
      withInvoices([invoice({ currency: 'USD', miscCharges: { amount: 5000, currency: 'INR' } })]),
    );
    expect(warnings.join('\n')).toMatch(/Misc_Charge_Currency.*INR.*USD/s);
  });
});

describe('the related-party block', () => {
  const svb = {
    isRelated: true,
    base: 'Wholly owned subsidiary',
    condition: 'Price list applies to group companies',
    svbRefNo: 'SVB/123/2024',
    svbDate: '2024-11-02',
    svbCustomHouse: 'INNSA1',
    loadingBasis: 'A',
    rateAssessable: 1.5,
    statusAssessable: 'P',
    revenueDepositPercent: 1,
  };

  it('fills nothing when the parties are unrelated', async () => {
    const [row] = await invoiceRows(withInvoices([invoice({ relatedParty: false })]));
    expect(row!['Is_Related']).toBe('N');
    expect(row!['Relation']).toBeUndefined();
    expect(row!['Base']).toBeUndefined();
    expect(row!['Condition']).toBeUndefined();
    expect(row!['RD_%']).toBe('0.00');
  });

  it('writes YES in capitals, the SVB order and the deposit when they are', async () => {
    const [row] = await invoiceRows(
      withInvoices([invoice({ relatedParty: true })], { supplierRelationship: svb }),
    );
    expect(row!['Is_Related']).toBe('Y');
    expect(row!['Relation']).toBe('YES');
    expect(row!['Base']).toBe('Wholly owned subsidiary');
    expect(row!['SVB_Ref_No']).toBe('SVB/123/2024');
    expect(row!['SVB_Date']).toBe('02-Nov-2024');
    expect(row!['SVB_Loading_Basis']).toBe('A');
    expect(row!['SVB_Rate_Assessable']).toBe('1.50000');
    expect(row!['SVB_Status_Assessable']).toBe('P');
    expect(row!['RD_%']).toBe('1.00');
  });

  it('warns when a related pair has no SVB order on record', async () => {
    const { warnings } = await build(withInvoices([invoice({ relatedParty: true })]));
    expect(warnings.join('\n')).toMatch(/SVB_Ref_No.*Special Valuation Branch/s);
  });

  it('keeps Custom_House_Code for the SVB house, not the filing station', async () => {
    // The station is GENERAL.CustomsHouseCode. Filling this column with it is a
    // repeat mistake, and the vendor's own export leaves it empty.
    const [plain] = await invoiceRows(withInvoices([invoice()]));
    expect(plain!['Custom_House_Code']).toBeUndefined();

    const [related] = await invoiceRows(
      withInvoices([invoice({ relatedParty: true })], { supplierRelationship: svb }),
    );
    expect(related!['Custom_House_Code']).toBe('INNSA1');
  });
});

describe('terms of payment', () => {
  it('codes the instrument and leaves the remark blank', async () => {
    const [row] = await invoiceRows(
      withInvoices([invoice({ termsOfPayment: 'D/A 45 days from B/L Date' })]),
    );
    expect(row!['Terms_of_Payment']).toBe('DA');
    expect(row!['Other_Terms_of_Payment_Remark']).toBeUndefined();
  });

  it('writes OTHERS in both columns when no instrument is named', async () => {
    const [row] = await invoiceRows(withInvoices([invoice({ termsOfPayment: '100% advance TT' })]));
    expect(row!['Terms_of_Payment']).toBe('OTHERS');
    expect(row!['Other_Terms_of_Payment_Remark']).toBe('OTHERS');
  });

  it('carries the LC number only beside LC terms', async () => {
    const [onLc] = await invoiceRows(
      withInvoices([invoice({ termsOfPayment: 'Irrevocable LC at sight', lcNumber: 'LC-9911', lcDate: '2026-05-01' })]),
    );
    expect(onLc!['Terms_of_Payment']).toBe('LC');
    expect(onLc!['LC_No']).toBe('LC-9911');
    expect(onLc!['LC_Date']).toBe('01-May-2026');

    // An LC number beside D/A terms would say the goods were paid for a way
    // they were not.
    const [notOnLc] = await invoiceRows(
      withInvoices([invoice({ termsOfPayment: 'D/A 45 days', lcNumber: 'LC-9911' })]),
    );
    expect(notOnLc!['LC_No']).toBeUndefined();
  });

  it('files a free-of-cost re-import as FOC, as ex_job3 and ex_job4 were', async () => {
    const [row] = await invoiceRows(
      withInvoices([invoice({ termsOfPayment: 'FOC', natureOfTransaction: 'Free of cost' })]),
    );
    expect(row!['Terms_of_Payment']).toBe('FOC');
    expect(row!['Nature_of_Trans']).toBe('Free of cost');
  });
});

describe('the high seas sale loading', () => {
  const hssJob = (hssValue: number | undefined) => {
    const draft = withInvoices([invoice({ invoiceValue: 100000, ...(hssValue != null && { hssValue }) })]);
    draft.boe = { ...draft.boe!, flags: { ...draft.boe!.flags, hss: true } };
    // The flag, the chain and the loading move together — ICES 116 rejects any
    // two of the three on their own, and the HSS mapper blocks on a flag with
    // no seller. See docs/boe-mapping/16-hss.md.
    draft.hssChain = [{ level: 0, iec: '0388012345', branchSrNo: 1, name: 'MIDSEA TRADING PTE LTD' }];
    return draft;
  };

  it('is nil on a job that is not a high seas sale', async () => {
    const [row] = await invoiceRows(withInvoices([invoice({ invoiceValue: 100000, hssValue: 150000 })]));
    expect(row!['HSS_%']).toBe('0.0000');
    expect(row!['HSS_Amount']).toBe('0.00');
  });

  it('declares the 2% minimum when the difference is smaller', async () => {
    // 1% over the import price. The BE loads 2%, which is the practice.
    const [row] = await invoiceRows(hssJob(101000));
    expect(row!['HSS_%']).toBe('2.0000');
    expect(row!['HSS_Amount']).toBe('0.00');
  });

  it('declares the actual difference when it exceeds 2%', async () => {
    const [row] = await invoiceRows(hssJob(105000));
    expect(row!['HSS_%']).toBe('0.0000');
    expect(row!['HSS_Amount']).toBe('5000.00');
  });

  it('warns when the job is a high seas sale and no HSS price is known', async () => {
    const { warnings } = await build(hssJob(undefined));
    expect(warnings.join('\n')).toMatch(/HSS_Amount.*high seas sale/s);
  });

  it('refuses a high seas sale priced below the import', async () => {
    await expect(build(hssJob(90000))).rejects.toThrow(/below the.*import price/s);
  });
});

describe('more than one invoice', () => {
  const two = [
    invoice({ srNo: 1, invoiceNumber: 'NI26060135', currency: 'USD', invoiceValue: 22986.8 }),
    invoice({ srNo: 2, invoiceNumber: 'NI26060136', currency: 'JPY', invoiceValue: 1450000 }),
  ];

  it('writes one row per invoice, serially numbered', async () => {
    const rows = await invoiceRows(withInvoices(two));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['InvSrNo'])).toEqual(['1', '2']);
    expect(rows.map((r) => r['Invoice_No'])).toEqual(['NI26060135', 'NI26060136']);
  });

  it('turns off the single-charge flag, which is what it is for', async () => {
    const [one] = await invoiceRows(withInvoices([two[0]!]));
    expect(one!['Is_Single_Frt_Ins_Other_Chrg']).toBe('Y');

    const many = await invoiceRows(withInvoices(two));
    expect(many.every((r) => r['Is_Single_Frt_Ins_Other_Chrg'] === 'N')).toBe(true);
  });

  it('declares an exchange rate for every currency on the Bill of Entry', async () => {
    const { buffer } = await build(withInvoices(two));
    const rates = await readSheet(buffer, 'EXCHANGE_RATE');
    expect(rates.map((r) => r['CURRENCY_CODE'])).toEqual(['INR', 'USD', 'JPY']);
  });

  it('points every item at the invoice that billed it', async () => {
    const { buffer } = await build(withInvoices(two));
    const items = await readSheet(buffer, 'ITEMS');
    expect(items.map((r) => r['InvSrNo'])).toEqual(['1', '2']);
    // The item serial restarts per invoice — ICES field 8 is the item serial
    // *within* the invoice.
    expect(items.map((r) => r['ItemSrNo'])).toEqual(['1', '1']);
  });

  it('names the invoice in a warning, so twelve rows stay tellable apart', async () => {
    const { warnings } = await build(
      withInvoices([two[0]!, { ...two[1]!, termsOfInvoice: 'FOB' }]),
    );
    expect(warnings.join('\n')).toMatch(/INVOICES\[2\]\.Frt_Amount/);
  });
});

describe('columns that are constants, and the evidence for them', () => {
  it('writes the vendor nils for agency and loading', async () => {
    const [row] = await invoiceRows(withInvoices([invoice()]));
    // Nil on all five vendor workbooks and all seven checklists. An Indian
    // service, so the currency beside the zero is rupees.
    expect(row!['Agency_%']).toBe('0.0000');
    expect(row!['Agency_Amount']).toBe('0.00');
    expect(row!['Agency_Currency']).toBe('INR');
    expect(row!['Loading_Amount']).toBe('0.00');
    expect(row!['Loading_Currency']).toBe('INR');
    expect(row!['RD_Basis']).toBe('A');
  });

  it('defaults the valuation method to the string that round-trips', async () => {
    const [row] = await invoiceRows(withInvoices([invoice()]));
    expect(row!['Valuation_Method']).toBe('RULE 4 (TRANSACTION VALUE)');
  });

  it('writes the terms place only when the invoice named one', async () => {
    const [without] = await invoiceRows(withInvoices([invoice()]));
    expect(without!['TOI_Place']).toBeUndefined();

    const [with_] = await invoiceRows(withInvoices([invoice({ termsPlace: 'NHAVA SHEVA' })]));
    expect(with_!['TOI_Place']).toBe('NHAVA SHEVA');
  });

  it('refuses a Bill of Entry with no invoice at all', async () => {
    await expect(build(withInvoices([]))).rejects.toThrow(/nothing to declare/);
  });
});
