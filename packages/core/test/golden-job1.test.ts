import { describe, expect, it } from 'vitest';
import { computeJobDuty, type InvoiceInput } from '../src/index.js';

/**
 * Golden test: Job I-13841/26-27 (air, Sahar INBOM4, Fuchs Lubricants).
 * Expected values transcribed from the real Logi-Sys checklist PDF
 * "Import CheckList-I-1384126-27-02-JUL-2026".
 */
const invoice: InvoiceInput = {
  invoiceNumber: 'INV00000208940',
  invoiceDate: '2026-06-29',
  termsOfInvoice: 'C&F',
  currency: 'USD',
  invoiceValue: 15283.84,
  insurance: { kind: 'amount', value: { amount: 178.52, currency: 'INR' } },
  miscCharges: { amount: 590.75, currency: 'USD' },
  items: [
    {
      slNo: 1,
      description:
        'FLUOROCARBON GEL 880FG W/UV DYE 55CC CLEAR SYRINGE,25/CASE (LUBRICATING PREPARATION)',
      ritc: '34039900',
      quantity: 10,
      unit: 'NOS',
      unitPrice: 358.32,
      bcdRate: 7.5,
      aidcRate: 0,
      aidcNotification: '011/2021',
      igstRate: 18,
      igstNotification: '009/2025',
      compCessRate: 0,
      compCessNotification: '001/2017',
    },
    {
      slNo: 2,
      description: 'FLUOROCARBON GEL 880FG W/UV DYE 8LB PAIL (LUBRICATING PREPARATIONS)',
      ritc: '34039900',
      quantity: 16,
      unit: 'NOS',
      unitPrice: 731.29,
      bcdRate: 7.5,
      aidcRate: 0,
      igstRate: 18,
      compCessRate: 0,
    },
  ],
};

describe('golden: ex_job1 I-13841/26-27 (air, C&F, USD @ 95.30)', () => {
  const result = computeJobDuty(invoice, { USD: 95.3 });

  it('reproduces the BE gross assessable value', () => {
    expect(result.totalAssessableValue).toBe(1_513_026.95);
  });

  it('reproduces item 1 (syringe case) to the paisa', () => {
    const item = result.items[0]!;
    expect(item.assessableValue).toBe(354_719.64);
    expect(item.bcd).toBe(26_603.97);
    expect(item.sws).toBe(2_660.4);
    expect(item.igst).toBe(69_117.12);
    expect(item.totalDuty).toBe(98_381.49);
  });

  it('reproduces item 2 (8lb pail) to the paisa', () => {
    const item = result.items[1]!;
    expect(item.assessableValue).toBe(1_158_307.31);
    expect(item.bcd).toBe(86_873.05);
    expect(item.sws).toBe(8_687.3);
    expect(item.igst).toBe(225_696.18);
    expect(item.totalDuty).toBe(321_256.53);
  });

  it('reproduces the duty summary table', () => {
    expect(result.totals.bcd).toBe(113_477.02);
    expect(result.totals.sws).toBe(11_347.7);
    expect(result.totals.igst).toBe(294_813.3);
    expect(result.totals.compCess).toBe(0);
  });

  it('reproduces the GSTIN table IGST assessable value', () => {
    expect(result.igstAssessableValue).toBe(1_637_852);
  });

  it('reproduces duty payable and its words', () => {
    expect(result.dutyPayable).toBe(419_638);
    expect(result.dutyPayableInWords).toBe(
      'Rs. Four Lakh Nineteen Thousand Six Hundred Thirty Eight Only',
    );
  });
});
