import { describe, expect, it } from 'vitest';
import { computeJobDuty, type InvoiceInput } from '../src/index.js';

/**
 * Golden test: Job I-13811/26-27 (sea, Nhava Sheva INNSA1, Freshcare Industries).
 * Lactose from Uganda under the DFTP (LDC) scheme: 25% BCD fully exempted via
 * notification 096/2008, IGST 5%. Expected values from the real checklist PDF
 * "Import CheckList-I-1381126-27-04-AUG-2026".
 */
const invoice: InvoiceInput = {
  invoiceNumber: 'BFL/2026-27/038',
  invoiceDate: '2026-06-04',
  termsOfInvoice: 'CIF',
  currency: 'USD',
  invoiceValue: 30_000,
  items: [
    {
      slNo: 1,
      description: 'LACTOSE',
      ritc: '17021110',
      quantity: 25_000,
      unit: 'KGS',
      unitPrice: 1.2,
      bcdRate: 25,
      bcdExemption: { notification: '096/2008', serial: '(i)', percent: 100 },
      aidcRate: 0,
      aidcNotification: '011/2021',
      igstRate: 5,
      igstNotification: '009/2025',
      compCessRate: 0,
      compCessNotification: '001/2017',
    },
  ],
};

describe('golden: ex_job2 I-13811/26-27 (sea, CIF, FTA exemption, USD @ 95.30)', () => {
  const result = computeJobDuty(invoice, { USD: 95.3 });

  it('reproduces the BE gross assessable value (pure CIF, no additions)', () => {
    expect(result.totalAssessableValue).toBe(2_859_000);
  });

  it('fully exempts BCD under DFTP while keeping the 25% tariff rate visible', () => {
    const item = result.items[0]!;
    expect(item.assessableValue).toBe(2_859_000);
    expect(item.bcd).toBe(0);
    expect(item.effectiveBcdRate).toBe(0);
    expect(item.sws).toBe(0);
    expect(item.igst).toBe(142_950);
    expect(item.totalDuty).toBe(142_950);
  });

  it('reproduces duty payable and its words', () => {
    expect(result.dutyPayable).toBe(142_950);
    expect(result.igstAssessableValue).toBe(2_859_000);
    expect(result.dutyPayableInWords).toBe(
      'Rs. One Lakh Forty Two Thousand Nine Hundred Fifty Only',
    );
  });
});
