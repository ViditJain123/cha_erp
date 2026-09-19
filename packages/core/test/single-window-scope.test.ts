import { describe, expect, it } from 'vitest';
import {
  CHEMICAL_CATEGORIES,
  HAZARDOUS_CTHS,
  isChemicalDeclarationCth,
  isHazardousCth,
} from '../src/index.js';

/**
 * What triggers a Single Window row, per line.
 *
 * Both predicates are pinned against the whole corpus, because in both cases
 * the corpus agrees with the circular with no exception in either direction —
 * and in both cases the plausible wrong reading (a chapter range) would have
 * put rows on filings that were accepted without them.
 *
 * Contract: docs/boe-mapping/11-sw-addl-info.md.
 */

describe('the chemical declaration scope', () => {
  /** Circular 23/2023: chapters 28, 29, 32, 39 and heading 3808. */
  it.each([
    ['29171400', 'liv_job1, maleic anhydride'],
    ['29091990', 'ex_job15 BE'],
    ['29269090', 'ex_job17 BE, acetonitrile'],
    ['29321100', 'ex_job23 BE'],
    ['39021000', 'ex_job28 workbook / ex_job14 BE'],
    ['39023000', 'ex_job25 workbook'],
    ['39046990', 'ex_job29 workbook'],
    ['28152000', 'chapter 28'],
    ['32041790', 'chapter 32'],
  ])('%s is in scope (%s)', (cth) => {
    expect(isChemicalDeclarationCth(cth)).toBe(true);
  });

  /** Eight for eight in the corpus, and every one of them files no CPC row. */
  it.each([
    ['27101979', 'ex_job20 workbook'],
    ['34039900', 'ex_job21 workbook — and the counter-example to the old 28–40 range'],
    ['48042100', 'ex_job12 BE'],
    ['54022090', 'ex_job16 BE'],
    ['84051090', 'I-60133'],
    ['88022000', 'I-20271'],
  ])('%s is out of scope (%s)', (cth) => {
    expect(isChemicalDeclarationCth(cth)).toBe(false);
  });

  /**
   * Circular 23/2023 narrowed the original "chapter 38" to heading 3808 alone.
   * Reading the 2023 original rather than the amendment puts chemical rows on
   * a line that must not carry them — ICES 877 / 931.
   */
  it('takes only heading 3808 out of chapter 38', () => {
    expect(isChemicalDeclarationCth('38089199')).toBe(true);
    expect(isChemicalDeclarationCth('38089399')).toBe(true);
    expect(isChemicalDeclarationCth('38170011')).toBe(false);
    expect(isChemicalDeclarationCth('38249900')).toBe(false);
  });

  it('refuses a code too short to have a chapter', () => {
    expect(isChemicalDeclarationCth('39')).toBe(false);
    expect(isChemicalDeclarationCth(undefined)).toBe(false);
  });

  it('carries the three categories the advisory names, and their obligations', () => {
    expect(CHEMICAL_CATEGORIES.map((c) => c.code)).toEqual(['CPCBB', 'CPCFM', 'CPCPR']);
    // Circular 23/2023 para 4.1(b): bulk and basic needs both, proprietary
    // needs either. ex_job29 and ex_job23 file CPCPR with neither and lean on
    // PC002 instead, which is the circular working as designed.
    expect(CHEMICAL_CATEGORIES.find((c) => c.code === 'CPCBB')!.requires).toBe('both');
    expect(CHEMICAL_CATEGORIES.find((c) => c.code === 'CPCPR')!.requires).toBe('either');
  });
});

describe('the hazardous-cargo declaration scope', () => {
  it('holds all 51 tariff items of Annexure-A to Circular 24/2026', () => {
    expect(HAZARDOUS_CTHS.size).toBe(51);
    // Chapters 28 and 29, plus heading 3808, and nothing else.
    const chapters = new Set([...HAZARDOUS_CTHS].map((c) => c.slice(0, 2)));
    expect([...chapters].sort()).toEqual(['28', '29', '38']);
    for (const cth of HAZARDOUS_CTHS) {
      if (cth.startsWith('38')) expect(cth.slice(0, 4)).toBe('3808');
    }
  });

  /**
   * The rule is per CTH, not per chapter. Three chapter-29 Bills of Entry were
   * filed after the 01.07.2026 mandate and only `ex_job17` carries the row —
   * a chapter-wide reading would have put a spurious declaration on the other
   * two, both of which ICES accepted without one.
   */
  it('splits the three chapter-29 filings exactly as ICES did', () => {
    expect(isHazardousCth('29269090')).toBe(true); // ex_job17, sl. 19 ACETONITRILE
    expect(isHazardousCth('29091990')).toBe(false); // ex_job15 — the list has 29094990
    expect(isHazardousCth('29321100')).toBe(false); // ex_job23 — the list has 29321300
  });

  /** liv_job1's CTH is listed; its filing simply predates the mandate. */
  it('lists maleic anhydride', () => {
    expect(isHazardousCth('29171400')).toBe(true);
  });

  it('is not chapter-wide', () => {
    expect(isHazardousCth('29')).toBe(false);
    expect(isHazardousCth('39021000')).toBe(false);
  });
});
