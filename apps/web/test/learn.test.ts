import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allTariff, lookupTariff } from '@checklist/core';
import type { ChecklistDraft } from '@checklist/extraction';
import { learnFromApprovedJob } from '../lib/learn';

/**
 * What an approved job teaches the tariff master, now that the master holds the
 * whole printed tariff rather than three rows.
 */
describe('learning from an approved job', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'masters-'));
    process.env.MASTERS_DIR = dir;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.MASTERS_DIR;
  });

  function draftWith(item: Partial<ChecklistDraft['items'][number]>): ChecklistDraft {
    return {
      importer: { name: '' },
      items: [
        {
          ritc: '',
          description: 'test goods',
          unit: 'KGS',
          bcdRate: 0,
          igstRate: 0,
          aidcRate: 0,
          compCessRate: 0,
          ...item,
        },
      ],
    } as unknown as ChecklistDraft;
  }

  it('learns a reviewer correction to a row the book supplied', () => {
    // 61023010: knitwear, 20% BCD in the book, and not a seed row.
    const book = lookupTariff('61023010')!;
    expect(book.provenance?.source).toBe('book');

    const learned = learnFromApprovedJob(
      draftWith({ ritc: '61023010', bcdRate: 25, igstRate: book.igstRate }),
      'JOB-1',
    );
    expect(learned.join(' ')).toMatch(/BCD 20% → 25%/);
    const row = lookupTariff('61023010')!;
    expect(row.bcdRate).toBe(25);
    expect(row.provenance).toMatchObject({ source: 'learned', learnedFrom: 'JOB-1' });
    // What the book knew about the line is kept, not overwritten with blanks.
    expect(row.impPolicy).toBe(book.impPolicy);
  });

  /**
   * 39021000 is 7.5% in the tariff; job I-13844 paid 0% under the India-Japan
   * CEPA. Learning that as the tariff rate would hand every later importer a
   * concession they never claimed.
   */
  it('never learns a concession as the tariff rate', () => {
    const before = lookupTariff('39021000')!.bcdRate;
    const learned = learnFromApprovedJob(
      draftWith({
        ritc: '39021000',
        bcdRate: 0,
        igstRate: lookupTariff('39021000')!.igstRate,
        bcdExemption: { notification: '069/2011', percent: 100, scheme: 'CEPA' },
      }),
      'I-13844',
    );
    expect(learned.filter((l) => l.startsWith('tariff row'))).toEqual([]);
    expect(lookupTariff('39021000')!.bcdRate).toBe(before);
  });

  it('writes nothing when the job agrees with a verified row', () => {
    const row = lookupTariff('34039900')!;
    const learned = learnFromApprovedJob(
      draftWith({ ritc: '34039900', bcdRate: row.bcdRate, igstRate: row.igstRate }),
      'JOB-2',
    );
    expect(learned.filter((l) => l.startsWith('tariff row'))).toEqual([]);
  });

  it('takes an approved job as confirmation of an unverified book row', () => {
    const unverified = allTariff().find(
      (r) => r.provenance?.source === 'book' && r.provenance.confidence === 'unverified',
    )!;
    expect(unverified).toBeDefined();
    const learned = learnFromApprovedJob(
      draftWith({ ritc: unverified.cth, bcdRate: unverified.bcdRate, igstRate: unverified.igstRate }),
      'JOB-3',
    );
    expect(learned.join(' ')).toMatch(/confirms an unverified row/);
    expect(lookupTariff(unverified.cth)!.provenance?.source).toBe('learned');
  });
});
