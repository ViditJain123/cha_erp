import { describe, expect, it } from 'vitest';
import {
  checkMasterRows,
  notificationConditionRows,
  notificationEntryRows,
  tariffLineRows,
} from '../src/masters/index.js';

/**
 * The database mirror of the masters. These pin what the migration's
 * constraints will enforce, so a sync can never be refused half-way through:
 * every row dated, keys unique, and no code or serial with two versions in
 * force on the same day.
 */
describe('master rows for the database', () => {
  const tariff = tariffLineRows();
  const entries = notificationEntryRows();
  const conditions = notificationConditionRows();
  const report = checkMasterRows(tariff, entries, conditions);

  it('passes every check the database would make', () => {
    expect(report.problems).toEqual([]);
  });

  it('carries the whole tariff, dated from the edition it was read from', () => {
    expect(tariff.length).toBeGreaterThan(11_000);
    const book = tariff.find((t) => t.source === 'book')!;
    expect(book.valid_from).toBe('2026-02-02');
    expect(book.valid_to).toBeNull();
    // The hand-typed seed outranks the book, as it does in the app.
    expect(tariff.find((t) => t.cth === '34039900')!.source).toBe('seed');
  });

  it('keeps import policy, which is what decides whether a licence is needed', () => {
    expect(tariff.find((t) => t.cth === '02089010')!.import_policy).toBe('Prohibited');
  });

  it('covers every duty the checklist computes', () => {
    for (const duty of ['BCD', 'AIDC', 'SWS', 'IGST', 'COMP_CESS', 'HEALTH_CESS', 'ANTI_DUMPING', 'TARIFF_VALUE']) {
      expect(report.byDutyType[duty], duty).toBeGreaterThan(0);
    }
  });

  it('writes both versions of a substituted 45/2025 rate, back to back', () => {
    const versions = entries
      .filter((e) => e.duty_type === 'BCD' && !e.scheme && e.table_no === 'I' && e.serial === '192' && !e.sub_entry)
      .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    expect(versions.map((v) => [v.rate_percent, v.valid_from, v.valid_to])).toEqual([
      [5, '2025-11-01', '2026-05-12'],
      [10, '2026-05-13', null],
    ]);
  });

  it('keeps an omitted serial, ended and attributed', () => {
    const zoo = entries.find((e) => e.duty_type === 'BCD' && !e.scheme && e.table_no === 'I' && e.serial === '1')!;
    expect(zoo.valid_to).toBe('2026-02-01');
    expect(zoo.omitted_by).toBe('02/2026-Customs');
  });

  it('includes the residual entries a picker must offer', () => {
    // 1/2017-Compensation Cess S.No. 56 and 9/2025-IT(R)'s Schedule II
    // residual: the "all other goods" answers, which no code names.
    expect(entries.some((e) => e.duty_type === 'COMP_CESS' && e.serial === '56' && e.any_chapter)).toBe(true);
    expect(entries.some((e) => e.duty_type === 'IGST' && e.table_no === 'II' && /not specified in Schedule/i.test(e.description))).toBe(true);
  });

  it('dates an IGST concession of 45/2025 by its serial, not by the build', () => {
    const igst = entries.filter((e) => e.duty_type === 'IGST' && e.notification === '045/2025');
    expect(igst.length).toBeGreaterThan(0);
    for (const e of igst) expect(e.valid_from >= '2025-11-01').toBe(true);
  });

  it('carries an anti-dumping row with its origin and specific amount', () => {
    const add = entries.find((e) => e.duty_type === 'ANTI_DUMPING' && e.basis === 'SPECIFIC' && e.amount !== null)!;
    expect(add.origin_countries.length).toBeGreaterThan(0);
    expect(add.amount_currency).toBeTruthy();
  });

  it('marks a preferential row with the agreement it belongs to', () => {
    const fta = entries.find((e) => e.scheme === 'IN-JP-CEPA')!;
    expect(fta.duty_type).toBe('BCD');
    expect(fta.origin_countries).toContain('JP');
  });

  it('builds the same keys twice', () => {
    expect(notificationEntryRows().map((e) => e.entry_key)).toEqual(entries.map((e) => e.entry_key));
  });

  it('carries the conditions 45/2025 entries cite', () => {
    expect(conditions.length).toBe(125);
    expect(conditions.find((c) => c.table_no === 'I' && c.condition_no === '5')!.stale_by.length).toBeGreaterThan(0);
  });
});
