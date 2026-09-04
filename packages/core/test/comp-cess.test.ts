import { describe, expect, it } from 'vitest';
import {
  COMP_CESS_NOTIFICATION,
  COMP_CESS_RESIDUAL_ENTRY,
  COMP_CESS_SCHEDULE,
  COMP_CESS_UNAPPLIED_AMENDMENTS,
  compCessForCth,
  compCessMatches,
} from '../src/masters/index.js';

/**
 * Notification 1/2017-Compensation Cess (Rate).
 *
 * The pair this master exists to produce is (`001/2017`, `56`) — the two values
 * Kuberr's desk types by hand into `IGST_CompCessNotn` and
 * `IGST_CompCessNotnSrNo` on every polypropylene and maleic anhydride line, and
 * which no code path could derive before.
 */
describe('compensation cess schedule', () => {
  it('reads all 56 serials of the Schedule, in order', () => {
    expect(COMP_CESS_SCHEDULE).toHaveLength(56);
    expect(COMP_CESS_SCHEDULE.map((e) => e.serial)).toEqual(
      Array.from({ length: 56 }, (_, i) => String(i + 1)),
    );
  });

  it('has exactly one "Any chapter" entry, and it is the residual S.No. 56', () => {
    const anyChapter = COMP_CESS_SCHEDULE.filter((e) => e.anyChapter);
    expect(anyChapter).toHaveLength(1);
    expect(anyChapter[0]).toBe(COMP_CESS_RESIDUAL_ENTRY);
    expect(COMP_CESS_RESIDUAL_ENTRY.serial).toBe('56');
    expect(COMP_CESS_RESIDUAL_ENTRY.rate).toBe(0);
  });
});

describe('compCessForCth', () => {
  it('answers 001/2017 S.No. 56 at nil for goods no serial names', () => {
    // Polypropylene — the reference job. This is the value the desk hand-typed.
    const cess = compCessForCth('39023000');
    expect(cess).toBeDefined();
    expect(cess!.notification).toBe(COMP_CESS_NOTIFICATION);
    expect(cess!.notification).toBe('001/2017');
    expect(cess!.entry.serial).toBe('56');
    expect(cess!.residual).toBe(true);
    expect(cess!.rate).toBe(0);
    expect(cess!.rateText).toBe('Nil');
    // No amendment can reach the residual entry, so there is nothing to warn about.
    expect(cess!.unappliedAmendments).toEqual([]);
  });

  it('answers the same for maleic anhydride, the other reference job', () => {
    expect(compCessForCth('29171400')!.entry.serial).toBe('56');
  });

  it('keeps a specific rate as text and refuses to invent a percentage', () => {
    // S.No. 39, coal: "Rs.400 per tonne". computeItemDuty applies a percentage
    // to the IGST base and nothing else, so a number here would be a fiction.
    const coal = compCessForCth('27011900')!;
    expect(coal.entry.serial).toBe('39');
    expect(coal.residual).toBe(false);
    expect(coal.rate).toBeNull();
    expect(coal.rateText).toBe('Rs.400 per tonne');
  });

  it('keeps a compound rate as text too', () => {
    // S.No. 13, filter cigarettes 65-70mm: "5% + Rs.2126 per thousand".
    const cigarettes = compCessForCth('24022040')!;
    expect(cigarettes.entry.serial).toBe('13');
    expect(cigarettes.rate).toBeNull();
    expect(cigarettes.rateText).toMatch(/Rs\./);
  });

  it('reads a plain ad valorem rate as a number', () => {
    expect(compCessForCth('22021010')!.rate).toBe(12); // S.No. 2, aerated waters
    expect(compCessForCth('87112000')!.rate).toBe(3); // S.No. 53, motorcycles > 350cc
  });

  it('prefers the more specific serial over the heading-wide catch-all', () => {
    // 8703 carries both S.No. 43-51 (specific vehicles) and S.No. 52 ("all
    // goods other than those at 43 to 51", 15%). An eight-digit electric
    // vehicle code must not collect 15%.
    const electric = compCessForCth('87031010')!;
    expect(electric.entry.serial).toBe('44');
    expect(electric.rateText).toBe('NIL');
  });

  it('surfaces entries that differ only by description as alternatives', () => {
    // S.No. 5 and 6 both name 2401 — 71% with a brand name, 65% with a lime
    // tube — so the code alone cannot decide and neither may be filed blind.
    const tobacco = compCessForCth('24011010')!;
    expect(tobacco.residual).toBe(false);
    expect(tobacco.alternatives.length).toBeGreaterThan(0);
    expect(new Set([tobacco.entry, ...tobacco.alternatives].map((e) => e.rateText)).size)
      .toBeGreaterThan(1);
    expect(tobacco.entry.brandSensitive).toBe(true);
  });

  it('reports the unapplied amendments on every named entry, and only those', () => {
    expect(COMP_CESS_UNAPPLIED_AMENDMENTS.length).toBeGreaterThan(0);
    expect(compCessForCth('27011900')!.unappliedAmendments).toEqual(COMP_CESS_UNAPPLIED_AMENDMENTS);
    expect(compCessForCth('39023000')!.unappliedAmendments).toEqual([]);
  });

  it('will not answer on a code too short to classify', () => {
    expect(compCessForCth('390')).toBeUndefined();
    expect(compCessForCth('')).toBeUndefined();
  });

  it('lists every covering entry, residual included, for a caller that wants them', () => {
    const all = compCessMatches('24011010');
    expect(all.some((e) => e.serial === '56')).toBe(true);
    expect(all.filter((e) => e.serial !== '56').length).toBeGreaterThan(1);
  });
});
