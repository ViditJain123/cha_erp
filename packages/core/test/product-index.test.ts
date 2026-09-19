import { describe, expect, it } from 'vitest';
import { searchProductIndex } from '../src/masters/product-index.js';
import { lookupTariff, resolveTariffPrefix } from '../src/masters/index.js';

describe('product index search', () => {
  /** The shape a real invoice line arrives in, noise and all. */
  const cases: [string, string][] = [
    ['ACETAZOLAMIDE USP 99.5% - 25KG FIBRE DRUM', '3004'],
    ['Polypropylene Homopolymer Granules, 25 kg bags', '3902'],
    ['Raisins, dark seedless, 10 kg cartons', '0806'],
    ['Bovine semen, frozen straws', '0511'],
  ];

  it.each(cases)('puts the right heading in the candidates for %s', (line, heading) => {
    const hits = searchProductIndex(line, 8);
    expect(hits.length).toBeGreaterThan(0);
    const headings = hits.flatMap((h) => h.headings.map((c) => c.slice(0, 4)));
    expect(headings).toContain(heading);
  });

  it('says which words it matched on', () => {
    const [top] = searchProductIndex('ACETAZOLAMIDE USP 99.5% - 25KG FIBRE DRUM');
    expect(top!.matched).toContain('acetazolamide');
    expect(top!.page).toBeGreaterThan(0);
  });

  it('is not fooled by packing noise alone', () => {
    // Nothing but stopwords and quantities: no opinion is the right answer.
    expect(searchProductIndex('25 KG DRUM AS PER INVOICE')).toEqual([]);
  });

  it('produces candidates that resolve to real tariff items', () => {
    const hits = searchProductIndex('Polypropylene Homopolymer Granules', 5);
    const reachable = hits.flatMap((h) =>
      h.headings.flatMap((code) =>
        code.length === 8 ? [lookupTariff(code)] : resolveTariffPrefix(code).candidates,
      ),
    ).filter(Boolean);
    expect(reachable.length).toBeGreaterThan(0);
  });
});
