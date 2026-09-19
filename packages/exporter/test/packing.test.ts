import { describe, expect, it } from 'vitest';
import {
  attachPacking,
  releaseGrossWeight,
  releaseQuantity,
  type ChecklistDraft,
  type PackingListExtract,
} from '@checklist/extraction';

/**
 * Matching a packing list's rows to the invoice's lines, and the per-package
 * arithmetic that follows.
 *
 * These test `@checklist/extraction`, not the exporter. They live here because
 * that package has no test runner of its own and this one already depends on
 * it — move them when extraction gets vitest.
 *
 * What they are guarding: an ex-bond Bill of Entry declares the gross weight of
 * the packages it releases, and that weight only exists if one package has a
 * weight. Getting it wrong puts a wrong figure on a customs declaration, so the
 * matcher is built to attach nothing rather than attach a guess.
 */

type Item = ChecklistDraft['items'][number];

const item = (slNo: number, description: string, quantity = 100): Item =>
  ({
    slNo,
    description,
    ritc: '39021000',
    quantity,
    unit: 'KGS',
    unitPrice: 1,
    amount: quantity,
    bcdRate: 0,
    swsRate: 0,
    igstRate: 0,
    aidcRate: 0,
    compCessRate: 0,
    endUseCode: 'GNX100',
  }) as Item;

const packingList = (lines: PackingListExtract['lines']): PackingListExtract => ({
  invoiceNumberRef: null,
  packageCount: null,
  packageUnit: null,
  netWeightKg: null,
  grossWeightKg: null,
  marksAndNumbers: null,
  lines,
  uncertainFields: [],
});

const line = (over: Partial<PackingListExtract['lines'][number]>) => ({
  description: 'PRODUCT A',
  marks: null,
  itemRef: null,
  packages: 10,
  packageType: 'BAG',
  netWeightKg: 250,
  grossWeightKg: 255,
  quantity: null,
  quantityUnit: null,
  ...over,
});

describe('attaching a packing list to the invoice lines', () => {
  it('derives the per-package weights', () => {
    // The dictated case: 10 bags of product A, 255 kg gross.
    const { items } = attachPacking([item(1, 'PRODUCT A')], packingList([line({})]));
    const packing = items[0]!.packing!;
    expect(packing.packages).toBe(10);
    expect(packing.packageType).toBe('BAG');
    expect(packing.perPackageGrossKg).toBe(25.5);
    expect(packing.perPackageNetKg).toBe(25);
  });

  it('matches across the wording the two documents use', () => {
    // A packing list and an invoice describe the same goods to different people.
    const { items } = attachPacking(
      [item(1, 'POLYPROPYLENE GRANULES (NATURAL)')],
      packingList([line({ description: 'POLYPROPYLENE GRANULES NATURAL' })]),
    );
    expect(items[0]!.packing).toBeDefined();
  });

  it('attaches nothing when a line matches no invoice item', () => {
    const { items, flags } = attachPacking(
      [item(1, 'PRODUCT A')],
      packingList([line({ description: 'ENTIRELY DIFFERENT GOODS ZZZ' })]),
    );
    expect(items[0]!.packing).toBeUndefined();
    expect(flags.some((f) => f.severity === 'warning')).toBe(true);
  });

  it('attaches nothing when a line describes two items equally well', () => {
    // Two grades of one polymer share most of their words. A wrong bag weight
    // is worse than none: an empty field gets filled, a wrong one looks answered.
    const { items, flags } = attachPacking(
      [item(1, 'PP GRANULES'), item(2, 'PP GRANULES')],
      packingList([line({ description: 'PP GRANULES' })]),
    );
    expect(items[0]!.packing).toBeUndefined();
    expect(items[1]!.packing).toBeUndefined();
    expect(flags.some((f) => f.message.includes('equally well'))).toBe(true);
  });

  it('attaches nothing when one item is packed in two package sizes', () => {
    // No single per-package weight applies, so deriving one would invent a
    // package that does not exist.
    const { items, flags } = attachPacking(
      [item(1, 'PRODUCT A')],
      packingList([
        line({ description: 'PRODUCT A 25KG BAGS', packages: 8, grossWeightKg: 204 }),
        line({ description: 'PRODUCT A 50KG BAGS', packages: 2, grossWeightKg: 102 }),
      ]),
    );
    expect(items[0]!.packing).toBeUndefined();
    expect(flags.some((f) => f.message.includes('more than one package size'))).toBe(true);
  });

  it('derives no per-package weight when the line gives no package count', () => {
    const { items } = attachPacking(
      [item(1, 'PRODUCT A')],
      packingList([line({ packages: null })]),
    );
    expect(items[0]!.packing).toBeUndefined();
  });

  it('does nothing, and says nothing, for a totals-only packing list', () => {
    // Plenty of packing lists state only totals. That is not an error.
    const { items, flags } = attachPacking([item(1, 'PRODUCT A')], packingList([]));
    expect(items[0]!.packing).toBeUndefined();
    expect(flags).toHaveLength(0);
  });

  it('warns when the rows do not add up to the document’s own totals', () => {
    const list = packingList([line({ packages: 10 })]);
    list.packageCount = 12;
    const { flags } = attachPacking([item(1, 'PRODUCT A')], list);
    expect(flags.some((f) => f.message.includes('add up to 10 packages'))).toBe(true);
  });
});

describe('the ex-bond release arithmetic', () => {
  const withPacking = () =>
    attachPacking([item(1, 'PRODUCT A', 250)], packingList([line({})])).items[0]!;

  it('weighs the packages being released', () => {
    // 200 kg in the warehouse, 4 bags going out: 4 x 25.5 = 102.0 kg gross.
    expect(releaseGrossWeight(withPacking(), 4)).toBe(102);
  });

  it('apportions the goods quantity by package share', () => {
    // 4 of 10 bags is four tenths of the 250 kg the invoice declares.
    expect(releaseQuantity(withPacking(), 4)).toBe(100);
  });

  it('refuses to release more packages than exist', () => {
    expect(releaseQuantity(withPacking(), 11)).toBeUndefined();
  });

  it('answers nothing when the item has no packing data', () => {
    expect(releaseGrossWeight(item(1, 'PRODUCT A'), 4)).toBeUndefined();
    expect(releaseQuantity(item(1, 'PRODUCT A'), 4)).toBeUndefined();
  });
});
