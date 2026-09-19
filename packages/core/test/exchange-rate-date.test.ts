import { GENERATED_EXCHANGE_RATES } from '../src/masters/generated/exchange-rates.js';
import { rateDeterminingDate } from '../src/boe-timing.js';
import { readFileSync, readdirSync } from 'node:fs';
import { exchangeRateTableOn, exchangeRatesOn } from '../src/masters/index.js';
import { describe, expect, it } from 'vitest';

/**
 * The bug this file exists for: the pipeline looked the rate up with `today`,
 * and the master was a single table with no end, so every job converted at
 * whatever rate happened to be typed into `masters/data.ts` last. On `liv_job1`
 * that filed USD at 96.05 against the 86.20 its filing date actually carried —
 * about 11% on the assessable value of every line, straight into the duty.
 */
describe('the date that fixes the rate of exchange', () => {
  it('is the date of presentation', () => {
    expect(rateDeterminingDate({ beFilingDate: '2026-08-25' })).toBe('2026-08-25');
  });

  it('is entry inwards when the Bill of Entry was presented before the vessel arrived', () => {
    // Section 46(3), second proviso: a prior BE is deemed presented on the date
    // of entry inwards, and a fortnight can turn over in between.
    expect(rateDeterminingDate({ beFilingDate: '2026-09-01', inwardDate: '2026-09-10' })).toBe(
      '2026-09-10',
    );
  });

  it('stays the filing date once the vessel is already in', () => {
    expect(rateDeterminingDate({ beFilingDate: '2026-09-10', inwardDate: '2026-09-01' })).toBe(
      '2026-09-10',
    );
  });

  it('answers "I cannot tell" rather than falling back to today', () => {
    expect(rateDeterminingDate({})).toBeUndefined();
    expect(rateDeterminingDate({ inwardDate: '2026-09-01' })).toBeUndefined();
    expect(rateDeterminingDate({ beFilingDate: '   ' })).toBeUndefined();
  });
});

describe('the master answers for the date, not for today', () => {
  it('serves a filing date years in the past from the table in force then', () => {
    const then = exchangeRateTableOn('2019-02-10');
    expect(then.ok).toBe(true);
    if (!then.ok) return;
    expect(then.table.effectiveFrom <= '2019-02-10').toBe(true);
    expect(then.table.effectiveTo === null || then.table.effectiveTo >= '2019-02-10').toBe(true);
  });

  it('crosses the seam from CBIC notifications to ICEGATE ERAM without a hole', () => {
    // CBIC's last notified table, 45/2024-Cus (N.T), ran to 4 July 2024; ERAM
    // took over the next day and there has been no notification since.
    const before = exchangeRateTableOn('2024-07-04');
    const after = exchangeRateTableOn('2024-07-05');
    expect(before.ok && before.table.source).toBe('45/2024-Customs (N.T)');
    expect(after.ok && after.table.source.startsWith('ICEGATE ERAM')).toBe(true);
  });

  it('names its source, so a filed rate can be traced to what published it', () => {
    const found = exchangeRateTableOn('2026-09-05');
    expect(found.ok && found.table.source).toMatch(/^ICEGATE ERAM/);
  });

  it('holds every currency ICEGATE publishes', () => {
    const rates = exchangeRatesOn('2026-09-05');
    expect(rates).toBeDefined();
    expect(Object.keys(rates!)).toHaveLength(22);
    for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AED', 'SGD', 'CHF', 'KRW'])
      expect(rates![c]).toBeGreaterThan(0);
  });
});

describe('liv_job1, the filing this bug was found on', () => {
  /**
   * A-ONE CHEM-TRADE, invoice MA-104025 dated 12 July 2025, USD 89,800 CIF from
   * Shanghai. Logi-Sys' own workbook
   * (`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx`, EXCHANGE_RATE sheet)
   * files `USD 86.200000`. We filed 96.05, because the master held one
   * hand-typed table and the lookup used the day the pipeline ran.
   */
  it('values a July 2025 presentation at the rate July 2025 carried', () => {
    const found = exchangeRateTableOn('2025-07-12');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.rates['USD']).toBe(86.2);
    expect(found.table.source).toBe('ICEGATE ERAM 2025-07-04');
    expect(found.table.effectiveTo).toBe('2025-07-17');
  });

  it('does not hand that job whatever rate is current now', () => {
    const now = exchangeRatesOn(new Date().toISOString().slice(0, 10));
    expect(now?.['USD']).not.toBe(86.2);
  });
});

describe('the generated master agrees with the source it was built from', () => {
  /**
   * The builder needs the CBIC notification PDFs, which are ~1.3 GB and
   * gitignored, so it cannot run in CI. The ERAM half *is* committed —
   * `masters-source/eram/*.json`, one file per publication — and that is the
   * half that moves every fortnight, so this is where drift would appear: a
   * table fetched and never rebuilt, or a generated file edited by hand.
   */
  const eramDir = new URL('../masters-source/eram/', import.meta.url);
  const files = readdirSync(eramDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();

  it('has every fetched ERAM table in it', () => {
    expect(files.length).toBeGreaterThan(60);
    const generated = new Map(GENERATED_EXCHANGE_RATES.map((t) => [t.effectiveFrom, t]));
    const missing = files.map((f) => f.replace('.json', '')).filter((d) => !generated.has(d));
    expect(missing, 'fetched but not built — re-run build-exchange-rates.py').toEqual([]);
  });

  it('carries each one at the rates ICEGATE published, per single unit', () => {
    const generated = new Map(GENERATED_EXCHANGE_RATES.map((t) => [t.effectiveFrom, t]));
    for (const f of files) {
      const source = JSON.parse(readFileSync(new URL(f, eramDir), 'utf8')) as {
        effectiveFrom: string;
        rates: Record<string, { import: number; export: number }>;
      };
      const built = generated.get(source.effectiveFrom)!;
      for (const [currency, pair] of Object.entries(source.rates)) {
        expect(built.rates[currency]?.import, `${source.effectiveFrom} ${currency}`).toBeCloseTo(
          pair.import,
          8,
        );
      }
    }
  });

  it('never leaves two tables claiming the same day', () => {
    for (let i = 1; i < GENERATED_EXCHANGE_RATES.length; i += 1) {
      const prev = GENERATED_EXCHANGE_RATES[i - 1]!;
      const next = GENERATED_EXCHANGE_RATES[i]!;
      expect(prev.effectiveTo, `${prev.effectiveFrom} is open-ended mid-history`).not.toBeNull();
      expect(prev.effectiveTo! < next.effectiveFrom).toBe(true);
    }
    expect(GENERATED_EXCHANGE_RATES[GENERATED_EXCHANGE_RATES.length - 1]!.effectiveTo).toBeNull();
  });
});
