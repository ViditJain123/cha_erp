import { describe, expect, it } from 'vitest';
import { valueAtFilingDate } from '../lib/exchange-rates';
import type { ChecklistDraft } from '@checklist/extraction';

/**
 * The step that actually fixes the bug.
 *
 * Section 14 of the Customs Act fixes the rate of exchange by the date the Bill
 * of Entry is presented. Nothing on a shipping document states that date — an
 * operator keys it on `job_boe_header`, often days after the documents are read
 * — so the merge can only seed a provisional table and this step settles it.
 *
 * Before this existed, `liv_job1` filed USD at 96.05 against the 86.20 its
 * filing date actually carried: about 11% on the assessable value of every
 * line, and invisible because nothing was missing.
 */

/** The smallest draft the rate resolution reads: one USD invoice. */
function draftWith(over: Partial<ChecklistDraft> = {}): ChecklistDraft {
  return {
    flags: [],
    shipment: {},
    invoices: [{ currency: 'USD' }],
    invoiceMeta: { exchangeRates: { USD: 999 } },
    ...over,
  } as unknown as ChecklistDraft;
}

const rateFlag = (d: ChecklistDraft) =>
  d.flags.find((f) => f.path === 'invoiceMeta.exchangeRates');

describe('valuing a draft at the rate its filing date carries', () => {
  it('uses the table in force on the date the BE is presented', () => {
    const out = valueAtFilingDate(draftWith(), { be_filing_date: '2025-07-12' });
    // ICEGATE ERAM, effective 2025-07-04. Logi-Sys' own workbook for liv_job1
    // files exactly this.
    expect(out.invoiceMeta.exchangeRates['USD']).toBe(86.2);
    expect(rateFlag(out)?.severity).toBe('info');
    expect(rateFlag(out)?.message).toContain('ICEGATE ERAM 2025-07-04');
  });

  it('uses entry inwards when the BE was presented before the vessel arrived', () => {
    // Section 46(3), second proviso. A fortnight can turn over in between, and
    // these two dates fall in different tables.
    const prior = valueAtFilingDate(draftWith(), {
      be_filing_date: '2025-07-12',
      inward_date: '2025-07-25',
    });
    expect(prior.invoiceMeta.exchangeRates['USD']).not.toBe(86.2);
    expect(rateFlag(prior)?.message).toContain('entry inwards');
  });

  it('says the rates are provisional when no filing date has been keyed', () => {
    const out = valueAtFilingDate(draftWith(), null);
    expect(rateFlag(out)?.severity).toBe('warning');
    expect(rateFlag(out)?.message).toContain('provisional');
    // The merge's seed is left alone — it is the best answer available, and the
    // flag is what stops it being mistaken for a settled one.
    expect(out.invoiceMeta.exchangeRates['USD']).toBe(999);
  });

  it('unsets the rates rather than guessing when no table covers the date', () => {
    // Inside EXCHANGE_RATE_GAPS: CBIC published 97/2022 as an image-only scan,
    // so the rates in force that fortnight are not the ones we hold. Empty
    // rates reach the exporter's existing EXCHANGE_RATE blocker.
    const out = valueAtFilingDate(draftWith(), { be_filing_date: '2022-11-20' });
    expect(out.invoiceMeta.exchangeRates).toEqual({});
    expect(rateFlag(out)?.severity).toBe('error');
    expect(rateFlag(out)?.message).toMatch(/scanned|could not be read/);
  });

  it('carries only the currencies this Bill of Entry converts at', () => {
    // The EXCHANGE_RATE sheet declares the rates it uses and no others, so all
    // 22 notified currencies must not land on the draft.
    const out = valueAtFilingDate(draftWith(), { be_filing_date: '2025-07-12' });
    expect(Object.keys(out.invoiceMeta.exchangeRates)).toEqual(['USD']);
  });

  it('names a currency the notification does not cover instead of dropping it silently', () => {
    // ICES calls it non-standard and wants the importer's bank certificate on
    // the row (error 155). Saying nothing is how that becomes a flat refusal.
    const out = valueAtFilingDate(
      draftWith({ invoices: [{ currency: 'THB' }] } as Partial<ChecklistDraft>),
      { be_filing_date: '2025-07-12' },
    );
    expect(out.invoiceMeta.exchangeRates).toEqual({});
    expect(rateFlag(out)?.severity).toBe('info');
    expect(rateFlag(out)?.message).toContain('THB');
    expect(rateFlag(out)?.message).toContain('bank rate certificate');
  });

  it('replaces its own flag rather than stacking one up per re-resolution', () => {
    // applyJobResolution re-runs on every header change, so an operator who
    // corrects a date three times must not end up with three notices.
    let d = valueAtFilingDate(draftWith(), null);
    d = valueAtFilingDate(d, { be_filing_date: '2025-07-12' });
    d = valueAtFilingDate(d, { be_filing_date: '2026-09-05' });
    expect(d.flags.filter((f) => f.path === 'invoiceMeta.exchangeRates')).toHaveLength(1);
    expect(d.invoiceMeta.exchangeRates['USD']).toBe(95.25);
  });
});
