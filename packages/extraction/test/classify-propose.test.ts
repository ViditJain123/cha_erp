import { describe, expect, it } from 'vitest';
import { classificationCandidates } from '../src/classify-propose.js';

/**
 * Only the deterministic half: building the candidate list needs no model, and
 * it is the half that decides whether the model is ever given a fair choice.
 */
describe('classification candidates', () => {
  it('finds tariff items from the goods description alone', () => {
    const candidates = classificationCandidates({
      description: 'ACETAZOLAMIDE USP 99.5% - 25KG FIBRE DRUM',
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.cth.startsWith('3004'))).toBe(true);
  });

  it('leads with the children of a partial code the documents gave', () => {
    const candidates = classificationCandidates({
      description: 'Polypropylene homopolymer granules',
      hsHint: '390210',
    });
    expect(candidates[0]!.cth.startsWith('390210')).toBe(true);
    expect(candidates.some((c) => c.cth === '39021000')).toBe(true);
  });

  it('offers only real tariff items, each with a rate and a page', () => {
    for (const c of classificationCandidates({ description: 'Raisins, dark seedless' })) {
      expect(c.cth).toMatch(/^\d{8}$/);
      expect(typeof c.bcdRate).toBe('number');
      expect(typeof c.igstRate).toBe('number');
      expect(c.citation.page).toBeGreaterThan(0);
      expect(c.citation.edition).not.toBe('current');
    }
  });

  it('says nothing when the description says nothing', () => {
    expect(classificationCandidates({ description: '25 KG DRUM AS PER INVOICE' })).toEqual([]);
  });

  /**
   * Heading 3004.90 has ninety-odd children. Offering the first ten in code
   * order gave "Acetazolamide USP" a choice of Ayurvedic, Unani, Siddha,
   * Homoeopathic and four named antiprotozoals — and the model picked one
   * while writing that none of them fitted. The residual is the right answer
   * whenever no specific item matches, so it is never the one left out.
   */
  it('always offers the residual sub-item of a crowded subheading', () => {
    const candidates = classificationCandidates({
      description: 'ACETAZOLAMIDE USP 99.5% - 25KG FIBRE DRUM',
    });
    const family = candidates.filter((c) => c.cth.startsWith('300490'));
    expect(family.length).toBeGreaterThan(1);
    expect(family[family.length - 1]!.cth).toMatch(/9{2}$/);
  });

  it('caps the list so the choice stays a choice', () => {
    const many = classificationCandidates({ description: 'parts of machinery', hsHint: '84' });
    expect(many.length).toBeLessThanOrEqual(10);
  });
});
