import { describe, expect, it } from 'vitest';
import { computeBeDuty, computeDutyForegone, type InvoiceInput, type ItemInput } from '../src/index.js';

/**
 * `LICENSE.DebitDeutyValue` — the duty a scheme debits against its licence.
 *
 * Every expectation here is transcribed from Logi-Sys' own export of the job,
 * not derived: the LICENSE sheet of `ex_job25/JobData_I-30288_…xlsx`,
 * `ex_job26/JobData_I-60133_…xlsx` and `ex_job28/JobData_I-13882_…xlsx`. If the
 * duty engine and the vendor disagree about this figure, Customs debits a
 * licence by the wrong amount, so these are exact-to-the-paisa.
 *
 * The three jobs separate the two things that could be confused:
 *
 *   - an Advance Authorisation (021/2023-Cus) and an EPCG authorisation
 *     (026/2023-Cus) exempt BCD *and* IGST, so the debit is 27.73% of the
 *     assessable value — not the 26.25% the headline rates add up to, because
 *     the exempted BCD and SWS are in the IGST base (section 3(8A) CTA);
 *   - a DFIA (025/2023-Cus) exempts BCD only, so its debit is 8.25%.
 */

describe('EPCG — ex_job26 I-60133, licence 0831018385', () => {
  // GENERAL: INCCU1, USD @ 96.05. One item, CIF USD 550,000.
  const invoice: InvoiceInput = {
    invoiceNumber: 'GAEL-EPCG-60133',
    invoiceDate: '2026-05-20',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 550000,
    items: [
      {
        slNo: 1,
        description: 'SEEDING TANK AGITATOR',
        ritc: '84051090',
        quantity: 1,
        unit: 'SET',
        unitPrice: 550000,
        bcdRate: 7.5,
        bcdExemption: { notification: '026/2023', serial: '1', percent: 100, kind: 'scheme' },
        igstRate: 18,
        igstExemption: { notification: '026/2023', serial: '1', percent: 100 },
      },
    ],
  };
  const rates = { USD: 96.05 };

  it('assessable value is LICENSE.CIF_Value', () => {
    expect(computeBeDuty([invoice], rates).items[0]!.assessableValue).toBe(52827500.0);
  });

  it('a fully exempt line pays nothing', () => {
    expect(computeBeDuty([invoice], rates).dutyPayable).toBe(0);
  });

  it('duty foregone is LICENSE.DebitDeutyValue', () => {
    const foregone = computeDutyForegone([invoice], rates, () => '026/2023');
    expect(foregone[0]).toBe(14651707.13);
  });
});

describe('Advance Authorisation — ex_job25 I-30288, licence 0311048850', () => {
  // GENERAL: INSAJ6, USD @ 96.05. Three lines of the same grade, one invoice.
  const line = (slNo: number, quantity: number): ItemInput => ({
    slNo,
    description: 'POLYPROPYLENE GRANULES',
    ritc: '39023000',
    quantity,
    unit: 'KGS',
    unitPrice: 1.22,
    bcdRate: 7.5,
    bcdExemption: { notification: '021/2023', serial: '1', percent: 100, kind: 'scheme' },
    igstRate: 18,
    igstExemption: { notification: '021/2023', serial: '1', percent: 100 },
  });
  const invoice: InvoiceInput = {
    invoiceNumber: 'RPL-AA-30288',
    invoiceDate: '2026-07-10',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 60390,
    items: [line(1, 5200), line(2, 15125), line(3, 29175)],
  };
  const rates = { USD: 96.05 };

  it('per-line assessable values are the sheet CIF_Value column', () => {
    const av = computeBeDuty([invoice], rates).items.map((i) => i.assessableValue);
    expect(av).toEqual([609341.2, 1772362.63, 3418755.68]);
  });

  it('per-line duty foregone is the sheet DebitDeutyValue column', () => {
    const foregone = computeDutyForegone([invoice], rates, () => '021/2023');
    expect(foregone).toEqual([169000.78, 491564.78, 948191.89]);
  });
});

describe('DFIA — ex_job28 I-13882, licence 0811016774', () => {
  // GENERAL: INNSA1, USD @ 97.20. DFIA exempts BCD; IGST stays payable, which
  // is why `IGST_ExemptionNotn` is blank on this job's ITEMS rows.
  const line = (slNo: number, quantity: number): ItemInput => ({
    slNo,
    description: 'RE425MO POLYPROPYLENE',
    ritc: '39021000',
    quantity,
    unit: 'KGS',
    unitPrice: 1.36,
    bcdRate: 7.5,
    bcdExemption: { notification: '025/2023', serial: '1', percent: 100, kind: 'scheme' },
    igstRate: 18,
  });
  const invoice: InvoiceInput = {
    invoiceNumber: '6060095873',
    invoiceDate: '2026-06-30',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 134640,
    items: [line(1, 59800), line(2, 39200)],
  };
  const rates = { USD: 97.2 };

  it('per-line assessable values are the sheet CIF_Value column', () => {
    const av = computeBeDuty([invoice], rates).items.map((i) => i.assessableValue);
    expect(av).toEqual([7905081.6, 5181926.4]);
  });

  it('debits BCD and SWS only — 8.25%, not 27.73%', () => {
    const foregone = computeDutyForegone([invoice], rates, () => '025/2023');
    expect(foregone).toEqual([652169.23, 427508.93]);
  });

  it('IGST is charged on the base including the BCD the scheme forgave', () => {
    // Checklist: `IGST Duty: 009/2025 II114 18% 1540305.15` on line 1, which
    // is 18% of AV + the tariff BCD 592,881.12 + SWS 59,288.11 — not 18% of
    // AV, which would be 1,422,914.69.
    expect(computeBeDuty([invoice], rates).items[0]!.igst).toBe(1540305.15);
  });
});

describe('TRQ — ex_job27 I-14222, licence 0111032798', () => {
  // A *partial* concession: 022/2022-Cus III(2) halves BCD from 7.5% to 3.75%,
  // and no IGST relief at all. The one case that separates "the scheme keeps
  // the forgone duty in the IGST base" from every other reading of the goldens.
  const invoice: InvoiceInput = {
    invoiceNumber: 'SIGMA-TRQ-14222',
    invoiceDate: '2026-07-20',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 108900,
    items: [
      {
        slNo: 1,
        description: 'Borsafe HE3490LS HD polyethylene',
        ritc: '39012000',
        quantity: 99000,
        unit: 'KGS',
        unitPrice: 1.1,
        bcdRate: 7.5,
        bcdExemption: { notification: '022/2022', serial: 'III2', percent: 50, kind: 'scheme' },
        igstRate: 18,
      },
    ],
  };
  const rates = { USD: 96.05 };
  const filed = () => computeBeDuty([invoice], rates).items[0]!;

  it('assessable value is the checklist AV', () => {
    expect(filed().assessableValue).toBe(10459845.0);
  });

  it('pays the concessional BCD, not the tariff one', () => {
    expect(filed().bcd).toBe(392244.19);
    expect(filed().sws).toBe(39224.42);
  });

  it('but IGST is charged on the base including the half it did not pay', () => {
    // Checklist: `IGST Duty: 18% 2038100.80`. On the paid BCD the base would
    // give 1,960,436.45 — the vendor does not file that.
    expect(filed().igst).toBe(2038100.8);
  });

  it('duty foregone is the checklist BCD Fg, with IGST Fg nil', () => {
    expect(computeDutyForegone([invoice], rates, () => '022/2022')[0]).toBe(431468.61);
  });
});

describe('an FTA concession is a rate, not forgone duty — ex_job6 I-13844', () => {
  // India-Japan CEPA, 069/2011-Cus serial 295, BCD 0%. The checklist files
  // `IGST Duty: 18% 3303058.70`, which is 18% of the assessable value with
  // nothing notional added. `kind` defaults to 'effective', so this is what
  // every existing golden already relies on.
  const invoice: InvoiceInput = {
    invoiceNumber: 'EP061126-1',
    invoiceDate: '2026-06-10',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 188924.32,
    items: [
      {
        slNo: 1,
        description: 'PP GRANULES (POLYPROPYLENE)',
        ritc: '39021000',
        quantity: 156450,
        unit: 'KGS',
        unitPrice: 1.20757,
        bcdRate: 7.5,
        bcdExemption: { notification: '069/2011', serial: '295', percent: 100 },
        igstRate: 18,
      },
    ],
  };
  it('charges IGST on the assessable value alone', () => {
    const item = computeBeDuty([invoice], { USD: 97.13 }).items[0]!;
    expect(item.bcd).toBe(0);
    expect(item.igst).toBe(Number((item.assessableValue * 0.18).toFixed(2)));
  });
});

describe('an exemption claimed under another notification is not debited twice', () => {
  const invoice: InvoiceInput = {
    invoiceNumber: 'MIXED',
    invoiceDate: '2026-06-30',
    termsOfInvoice: 'CIF',
    currency: 'USD',
    invoiceValue: 10000,
    items: [
      {
        slNo: 1,
        description: 'GOODS UNDER AN FTA, NOT A SCHEME',
        ritc: '39021000',
        quantity: 100,
        unit: 'KGS',
        unitPrice: 100,
        bcdRate: 7.5,
        bcdExemption: { notification: '069/2011', serial: '295', percent: 100 },
        igstRate: 18,
      },
    ],
  };
  it('prices only the scheme notification', () => {
    expect(computeDutyForegone([invoice], { USD: 90 }, () => '021/2023')).toEqual([0]);
  });
  it('and nothing at all when no scheme is claimed', () => {
    expect(computeDutyForegone([invoice], { USD: 90 }, () => undefined)).toEqual([0]);
  });
});
