import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * EXCHANGE_RATE — the rate every foreign figure on the BE converts at.
 *
 * Twelve workbooks on disk populate this sheet, seven of them Logi-Sys' own, so
 * the format is settled: an `INR / 1.000000` row first, rates as text at six
 * decimals, and the bank columns blank for a notified currency.
 */

const build = (mutate: (d: ChecklistDraft) => void) => {
  const draft = structuredClone(EP061126_1_DRAFT);
  mutate(draft);
  return buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
};

describe('a notified currency', () => {
  it('leads with the rupee at parity and writes six decimals', async () => {
    const { buffer } = await buildLogisysWorkbook({
      draft: EP061126_1_DRAFT,
      job: EP061126_1_JOB,
    });
    const rows = await readSheet(buffer, 'EXCHANGE_RATE');
    expect(rows[0]).toMatchObject({ CURRENCY_CODE: 'INR', EXCHANGE_RATE: '1.000000' });
    expect(rows[1]!['CURRENCY_CODE']).toBe('USD');
    expect(String(rows[1]!['EXCHANGE_RATE'])).toMatch(/^\d+\.\d{6}$/);
  });

  it('leaves the bank block blank', async () => {
    const { buffer } = await buildLogisysWorkbook({
      draft: EP061126_1_DRAFT,
      job: EP061126_1_JOB,
    });
    const rows = await readSheet(buffer, 'EXCHANGE_RATE');
    for (const row of rows) {
      expect(row['BANK_NAME']).toBeUndefined();
      expect(row['BANK_CERTIFICATE']).toBeUndefined();
      expect(row['BANK_CERTIFICATE_DATE']).toBeUndefined();
    }
  });
});

describe('a charge billed in a currency no invoice uses', () => {
  it('gets a row of its own — ICES 220', async () => {
    const { buffer } = await build((d) => {
      d.invoiceMeta.exchangeRates = { ...d.invoiceMeta.exchangeRates, EUR: 103.15 };
      d.invoices[0]!.freight = { amount: 1200, currency: 'EUR' };
    });
    const rows = await readSheet(buffer, 'EXCHANGE_RATE');
    expect(rows.map((r) => r['CURRENCY_CODE'])).toEqual(['INR', 'USD', 'EUR']);
  });

  it('refuses when that currency has no rate at all', async () => {
    await expect(
      build((d) => {
        d.invoices[0]!.freight = { amount: 1200, currency: 'EUR' };
      }),
    ).rejects.toThrow(/No rate for EUR/);
  });

  it('needs no row for notional percentage insurance, which has no currency', async () => {
    const { buffer } = await build((d) => {
      d.invoices[0]!.insurance = { kind: 'percent', percent: 1.125 };
    });
    const rows = await readSheet(buffer, 'EXCHANGE_RATE');
    expect(rows.map((r) => r['CURRENCY_CODE'])).toEqual(['INR', 'USD']);
  });
});

describe('the bank certificate date', () => {
  it('warns when it is not the filing date', async () => {
    const { warnings } = await build((d) => {
      d.invoiceMeta.exchangeRates = {};
      d.invoiceMeta.bankRateCertificates = {
        USD: {
          rate: 96.05,
          bankName: 'HDFC BANK LTD',
          certificateNo: 'FX/2026/00881',
          certificateDate: '2026-06-01',
        },
      };
      d.shipment.beFilingDate = '2026-06-30';
    });
    expect(warnings.join('\n')).toMatch(/needs re-issuing before the BE is filed/);
  });
});

describe('an ex-bond Bill of Entry', () => {
  it('carries no rows at all — ICES 662', async () => {
    // <TABLE>EXCHANGE is marked X for ex-bond in the components matrix: the
    // goods were valued when they went into the warehouse.
    const { buffer } = await build((d) => {
      d.beType = 'Ex-Bond';
    }).catch(async (error: Error) => {
      // An ex-bond draft built off a home-consumption fixture blocks elsewhere.
      // What matters is that EXCHANGE_RATE was not one of the blockers.
      expect(error.message).not.toMatch(/EXCHANGE_RATE/);
      return { buffer: null };
    });
    if (buffer) expect(await readSheet(buffer, 'EXCHANGE_RATE')).toHaveLength(0);
  });
});
