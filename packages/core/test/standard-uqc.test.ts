import { describe, expect, it } from 'vitest';
import { standardQuantity, standardUqcFile, standardUqcForCth, weightToKg } from '../src/index.js';

/**
 * The ITCHS standard unit — `SW_ADDL_INFO.Measure_Unit`, and the quantity that
 * goes beside it.
 *
 * Every expectation below is a CTH some real filing in the repo used, with the
 * unit that filing actually carried. The two evidence sets are the eight
 * Logi-Sys workbooks and the eight ICES-processed Bills of Entry; contract in
 * docs/boe-mapping/11-sw-addl-info.md.
 */

/** CTH -> the UQC the filing carried, and where it came from. */
const FILED: [string, string, string][] = [
  ['27101979', 'KGS', 'ex_job20 workbook, 19440.000000 KGS'],
  ['34039900', 'KGS', 'ex_job21 workbook, 17600.000000 KGS'],
  ['39023000', 'KGS', 'ex_job25 workbook, three lines'],
  ['39021000', 'KGS', 'ex_job28 workbook / ex_job14 BE'],
  ['39046990', 'KGS', 'ex_job29 workbook, 3450.000000 KGS'],
  ['29171400', 'KGS', 'liv_job1 workbook, 100000.000000 KGS'],
  ['48042100', 'KGS', 'ex_job12 BE, three lines'],
  ['54022090', 'KGS', 'ex_job16 BE, 24000 KGS'],
  ['29091990', 'KGS', 'ex_job15 BE, 4800 KGS'],
  ['29321100', 'KGS', 'ex_job23 BE, 4500 KGS'],
  ['84051090', 'NOS', 'I-60133: invoiced 1 SET, filed 1 NOS'],
  ['88022000', 'NOS', 'I-20271: invoiced 1 UNT, filed 1 NOS on each of four invoices'],
];

describe('the ITCHS standard unit', () => {
  it('is built and covers the whole tariff', () => {
    const file = standardUqcFile();
    expect(file).not.toBeNull();
    expect(file!.count).toBeGreaterThan(12_000);
  });

  it.each(FILED)('resolves %s to %s (%s)', (cth, uqc) => {
    expect(standardUqcForCth(cth)).toBe(uqc);
  });

  /**
   * The CBIC First Schedule parse has no unit for this heading, and the export
   * used to have no other source. The tariff book supplies it, and ICES filed
   * exactly that on `ex_job17`.
   */
  it('covers 29269090, which the First Schedule parse leaves blank', () => {
    expect(standardUqcForCth('29269090')).toBe('KGS');
  });

  /**
   * The tariff book is an OCR'd scan that loses the superscript in m2/m3 and
   * maps m2 to MTS — the UQC for a metric tonne. CBIC's own First Schedule
   * wins, so an area stays an area.
   */
  it('does not let the book turn a square metre into a metric tonne', () => {
    const rows = standardUqcFile()!.rows;
    expect(Object.values(rows)).not.toContain('MTS');
    expect(Object.values(rows)).not.toContain('MCU');
    expect(Object.values(rows).filter((u) => u === 'SQM').length).toBeGreaterThan(800);
  });

  it('refuses a CTH that is not eight digits', () => {
    expect(standardUqcForCth('3902')).toBeUndefined();
    expect(standardUqcForCth(undefined)).toBeUndefined();
  });
});

describe('the standard quantity', () => {
  it('passes a weight straight through when the tariff unit matches', () => {
    expect(standardQuantity('39023000', 5200, 'KGS', weightToKg)).toEqual({
      ok: true,
      quantity: 5200,
      uqc: 'KGS',
    });
  });

  /** I-60133: the invoice says SET, the tariff says u, ICES took 1 NOS. */
  it('renames a count without touching the number', () => {
    expect(standardQuantity('84051090', 1, 'SET', weightToKg)).toEqual({
      ok: true,
      quantity: 1,
      uqc: 'NOS',
    });
    expect(standardQuantity('88022000', 1, 'UNT', weightToKg)).toEqual({
      ok: true,
      quantity: 1,
      uqc: 'NOS',
    });
  });

  it('converts a weight the invoice states in tonnes', () => {
    expect(standardQuantity('39023000', 5.2, 'MTS', weightToKg)).toEqual({
      ok: true,
      quantity: 5200,
      uqc: 'KGS',
    });
  });

  /**
   * Nothing in the system holds a density or a pack size, and a wrong SUQC
   * quantity is a misdeclared quantity. ICES 495.
   */
  it('refuses a weight-to-count conversion', () => {
    const r = standardQuantity('84051090', 500, 'KGS', weightToKg);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/no conversion from KGS to NOS/);
  });

  it('refuses a CTH the tariff gives no unit for', () => {
    const r = standardQuantity('99999999', 10, 'KGS', weightToKg);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/no standard unit/);
  });

  it('refuses a line with no quantity or no unit', () => {
    expect(standardQuantity('39023000', undefined, 'KGS', weightToKg).ok).toBe(false);
    expect(standardQuantity('39023000', 100, '', weightToKg).ok).toBe(false);
  });
});
