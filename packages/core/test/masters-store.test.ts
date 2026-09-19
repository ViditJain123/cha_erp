import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addExchangeRateTable,
  exchangeRateTableOn,
  exchangeRatesOn,
  lookupImporter,
  lookupTariff,
  normalizeMemoryKeys,
  recallProductMemory,
  upsertImporter,
  upsertProductMemory,
  upsertTariff,
} from '../src/index.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'masters-'));
  process.env.MASTERS_DIR = dir;
});

afterAll(() => {
  delete process.env.MASTERS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('masters overlay store', () => {
  it('serves seed data when the overlay is empty', () => {
    expect(lookupTariff('17021110')?.bcdRate).toBe(25);
    // The importer seed is deliberately empty: the party master is the
    // uploaded organization repository, not a list in the source tree.
    expect(lookupImporter('FRESHCARE INDUSTRIES PRIVATE LIMITED')).toBeUndefined();
  });

  it('overlay tariff rows win over seed rows and add new CTHs', () => {
    upsertTariff({
      cth: '39269099',
      description: 'Articles of plastics — other',
      bcdRate: 10,
      unit: 'KGS',
      igstRate: 18,
      igstNotification: '009/2025',
      aidcRate: 0,
      aidcNotification: '011/2021',
      compCessRate: 0,
      compCessNotification: '001/2017',
    });
    expect(lookupTariff('39269099')?.bcdRate).toBe(10);

    upsertTariff({ ...lookupTariff('17021110')!, bcdRate: 30 });
    expect(lookupTariff('17021110')?.bcdRate).toBe(30);
  });

  it('an operator-keyed table takes effect for its own window only', () => {
    // The escape hatch for a fortnight ICEGATE has published but this build
    // predates. It replaces the generated table for the same effectiveFrom.
    addExchangeRateTable({
      effectiveFrom: '2026-08-21',
      effectiveTo: '2026-09-03',
      source: 'keyed on the masters screen',
      rates: { USD: { import: 96.1, export: 94.4 } },
    });
    expect(exchangeRatesOn('2026-08-25')?.['USD']).toBe(96.1);

    // And emphatically not for a date the notified history already answers.
    expect(exchangeRatesOn('2024-06-25')?.['USD']).toBe(84.3);
  });

  it('refuses a date no table covers rather than reaching for a neighbour', () => {
    // Before the history starts. The old lookup fell back to the first table.
    expect(exchangeRatesOn('2001-01-01')).toBeUndefined();
    expect(exchangeRateTableOn('2001-01-01')).toMatchObject({ ok: false, reason: 'before-history' });

    // A fortnight CBIC published as an image-only scan. Its neighbour's rates
    // are not the rates that were in force, so there is no answer to give.
    expect(exchangeRatesOn('2022-11-20')).toBeUndefined();
    expect(exchangeRateTableOn('2022-11-20')).toMatchObject({
      ok: false,
      reason: 'unreadable-notification',
    });
  });

  it('quotes the yen per single unit, not per hundred', () => {
    // 45/2024-Cus (N.T) Schedule II says `100 Japanese Yen = 53.60`. Filing
    // 53.60 against one yen is a 100x error on the assessable value.
    expect(exchangeRatesOn('2024-06-25')?.['JPY']).toBeCloseTo(0.536, 6);
  });

  it('learns and recalls importers', () => {
    upsertImporter({
      name: 'ORIGAMI CELLULO PRIVATE LIMITED',
      aliases: [],
      iec: '0712003053',
      pan: 'AABCO6103C',
      gstin: '05AABCO6103C1Z5',
      gstStateCode: '05',
      gstStateName: 'UTTARAKHAND',
      adCode: '6440004',
      branchSno: '10',
      address: ['KHASRA NO 171 AND 172, JMJ PAPER PRODUCT'],
      city: 'Roorkee',
      state: 'Uttarakhand',
    });
    expect(lookupImporter('Origami Cellulo Pvt Ltd')?.gstin).toBe('05AABCO6103C1Z5');
  });

  it('recalls product memory by importer + description prefix', () => {
    const keys = normalizeMemoryKeys('FUCHS LUBRICANTS (INDIA) PRIVATE LIMITED', 'FLUOROCARBON GEL 880FG W/UV DYE 8LB PAIL');
    upsertProductMemory({
      ...keys,
      ritc: '34039900',
      bcdRate: 7.5,
      igstRate: 18,
      igstNotification: '009/2025',
      learnedFrom: 'I-13841/26-27',
      learnedAt: '2026-08-05',
    });
    const hit = recallProductMemory('FUCHS LUBRICANTS (INDIA) PVT LTD', 'FLUOROCARBON GEL 880FG W/UV DYE 55CC SYRINGE');
    expect(hit?.ritc).toBe('34039900');
  });
});
