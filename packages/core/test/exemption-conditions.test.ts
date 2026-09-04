import { describe, expect, it } from 'vitest';
import {
  BCD_CONDITIONS,
  BCD_EXEMPTIONS,
  bcdConditions,
  bcdConditionTexts,
  bcdExemptionMatches,
  bcdSubEntryConditions,
  requiresIgcr,
} from '../src/masters/index.js';

/**
 * What a duty concession *demands*, not just what it grants.
 *
 * 286 of the 539 entries in 45/2025 are conditional. Until these masters
 * carried the condition as anything but prose, the whole obligation — hold a
 * registration, produce a certificate, keep the goods to an end use — survived
 * only as a substring in one flag message, and nothing downstream could act on
 * it. These tests pin the structure that replaced that.
 *
 * The worked example throughout is job I-40127: bleached softwood kraft pulp,
 * CTH 47032100, claiming Nil BCD against a 5% tariff rate under Table I S.No.
 * 160 — worth ₹3.35 lakh of BCD and SWS on a single four-container consignment,
 * and lawful only because the importer follows the IGCR Rules.
 */
describe('exemption conditions carry a citable number', () => {
  it('splits the citation cell into the numbers it cites', () => {
    // "2 and 3" is two conditions, not a string to re-parse at every call site.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '12');
    expect(entry?.condition).toBe('2 and 3');
    expect(entry?.conditions).toEqual(['2', '3']);
  });

  it('de-duplicates a cell that repeats a condition per sub-item', () => {
    // S.No. 160 stacks four sub-items in one row, so its condition cell reads
    // "3 and 19 3 3 3" — condition 3 once per sub-item, 19 only for the first.
    // Until the sub-items are split apart, the honest reading is the set.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '160');
    expect(entry?.condition).toBe('3 and 19 3 3 3');
    expect(entry?.conditions).toEqual(['3', '19']);
  });

  it('leaves an unconditional entry with no conditions', () => {
    // S.No. 2, not 1: 02/2026 omitted S.No. 1 outright.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '2');
    expect(entry?.condition).toBeNull();
    expect(entry?.conditions).toEqual([]);
  });

  it('resolves every cited number to a condition of the same table', () => {
    // The build already aborts when a citation dangles; this is the guarantee
    // restated from the consumer's side.
    for (const entry of BCD_EXEMPTIONS) {
      expect(bcdConditions(entry)).toHaveLength(entry.conditions.length);
    }
  });

  it('still answers with prose for callers that only want the text', () => {
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '160')!;
    const texts = bcdConditionTexts(entry);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('Concessional Rate of Duty');
    expect(texts[1]).toContain('newsprint');
  });
});

describe('conditions are classified by what they demand', () => {
  it('recognises the IGCR sentence, which is the same in both tables', () => {
    // Table I condition 3 and Table II condition 1 are the identical sentence.
    // It is boilerplate, so this matches on the text and not on luck.
    const igcr = BCD_CONDITIONS.filter((c) => c.kinds.includes('igcr'));
    expect(igcr.map((c) => `${c.table}/${c.no}`).sort()).toEqual(['I/3', 'II/1']);
    for (const c of igcr) {
      expect(c.text).toContain('Import of Goods at Concessional Rate of Duty');
    }
  });

  it('reaches the bulk of conditional entries with three kinds', () => {
    // igcr 120, certificate 70, importer-type 55 of 286 conditional entries.
    // If a matcher regresses these collapse, so the floor is asserted rather
    // than the exact count, which moves when CBIC amends the notification.
    // 260 conditional entries after amendments — 286 as published, less the
    // 26 conditional ones among the 85 serials 02/2026 omitted.
    const conditional = BCD_EXEMPTIONS.filter((e) => e.conditions.length > 0);
    expect(conditional.length).toBeGreaterThan(230);

    const covers = (kind: string) =>
      conditional.filter((e) => bcdConditions(e).some((c) => c.kinds.includes(kind as never))).length;

    expect(covers('igcr')).toBeGreaterThanOrEqual(95);
    expect(covers('certificate')).toBeGreaterThanOrEqual(60);
    expect(covers('importer-type')).toBeGreaterThanOrEqual(50);
  });

  it('classifies every condition, falling back to other rather than nothing', () => {
    for (const c of BCD_CONDITIONS) {
      expect(c.kinds.length).toBeGreaterThan(0);
    }
    // The long tail is real and is meant to be read by a person, but it should
    // stay a tail: most of the master must be actionable.
    const onlyOther = BCD_CONDITIONS.filter((c) => c.kinds.length === 1 && c.kinds[0] === 'other');
    expect(onlyOther.length).toBeLessThan(BCD_CONDITIONS.length / 2);
  });
});

describe('job I-40127 — wood pulp under Table I S.No. 160', () => {
  const entry = () => BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '160')!;

  it('is offered for the CTH on the Bill of Entry', () => {
    const matches = bcdExemptionMatches('47032100');
    expect(matches.map((e) => e.serial)).toContain('160');
  });

  it('requires the importer to follow the IGCR Rules', () => {
    // Condition 3. Which means, before this Bill of Entry can be filed at all:
    // an IIN against Form IGCR-1 and a continuity bond, both declared on the
    // BE under rule 5(1) of the Customs (Import of Goods at Concessional Rate
    // of Duty or for Specified End Use) Rules, 2022.
    expect(requiresIgcr(entry())).toBe(true);
  });

  it('also cites the newsprint condition, which does not bind this importer', () => {
    // Condition 19 belongs to sub-item (i), newsprint, and demands the
    // newsprint reach a newspaper registered with the Registrar of Newspapers
    // for India. Origami Cellulo makes tissue — sub-item (ii), paper and
    // paperboard, condition 3 alone. Until the sub-items are split the entry
    // cites both, and that over-citation is exactly why the split matters.
    expect(entry().conditions).toContain('19');
  });

  it('has no rate of its own, because four end uses share the row', () => {
    // "Nil Nil Nil 2.5%" — at the entry level the rate depends on which
    // sub-item the goods meet, so a single number would be a guess.
    expect(entry().bcdRate).toBeNull();
    expect(entry().bcdRateText).toBe('Nil Nil Nil 2.5%');
  });

  it('splits into the four end uses, each with its own rate', () => {
    expect(entry().subEntries).toEqual([
      { label: 'i', text: 'newsprint', bcdRate: 0, bcdRateText: 'Nil', conditions: ['3', '19'] },
      { label: 'ii', text: 'paper and paperboard', bcdRate: 0, bcdRateText: 'Nil', conditions: ['3'] },
      { label: 'iii', text: 'adult diapers', bcdRate: 0, bcdRateText: 'Nil', conditions: ['3'] },
      {
        label: 'iv',
        text: 'all goods falling under chapter heading 9619, other than adult diapers',
        bcdRate: 2.5,
        bcdRateText: '2.5%',
        conditions: ['3'],
      },
    ]);
  });

  it('binds condition 19 to newsprint alone', () => {
    // This is the whole point of the split. Origami Cellulo makes tissue —
    // their GST filing declares HSN 4803 and 4818, no 4801 — so they claim
    // (ii), paper and paperboard, and condition 3 is all that binds them.
    // Attaching 19 as well would demand they supply an RNI-registered
    // newspaper, which they have no way to do.
    expect(bcdSubEntryConditions(entry(), 'ii').map((c) => c.no)).toEqual(['3']);
    expect(bcdSubEntryConditions(entry(), 'i').map((c) => c.no)).toEqual(['3', '19']);
  });

  it('says IGCR applies to the branch Origami claims', () => {
    expect(requiresIgcr(entry(), 'ii')).toBe(true);
  });
});

describe('the split refuses rather than guesses', () => {
  it('maps a dash in the condition cell to the sub-item it stands for', () => {
    // S.No. 260 reads "- - - - - 3": five unconditional looms, then parts and
    // components conditional on the IGCR Rules. The dashes are positional; a
    // parser that only looked for digits would attach 3 to the first loom.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '260')!;
    expect(entry.subEntries).toHaveLength(6);
    expect(entry.subEntries!.slice(0, 5).every((s) => s.conditions.length === 0)).toBe(true);
    expect(entry.subEntries![5]!.conditions).toEqual(['3']);
    expect(requiresIgcr(entry, 'vi')).toBe(true);
    expect(requiresIgcr(entry, 'i')).toBe(false);
  });

  it('leaves an entry alone when the counts do not reconcile', () => {
    // S.No. 103 has three rates but two enumerated items, because the second
    // nests "a." and "b." beneath it. There is no honest correspondence, so
    // there is no split. The rate survives anyway — all three are Nil, so it
    // is unambiguous however the sub-items line up.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '103')!;
    expect(entry.bcdRateText).toBe('Nil Nil Nil');
    expect(entry.subEntries).toBeUndefined();
    expect(entry.bcdRate).toBe(0);
  });

  it('keeps the null rate when a refused entry stacks rates that differ', () => {
    // S.No. 317 is "15% 35% 70% 70%" against two enumerated items. Neither the
    // split nor the rate can be resolved, so both stay open. A wrong duty rate
    // on a Bill of Entry is far worse than a flagged one.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '317')!;
    expect(entry.subEntries).toBeUndefined();
    expect(entry.bcdRate).toBeNull();
  });

  it('only splits where it is sure, and says so in the count', () => {
    // 23 entries stack several rates; 9 reconcile. The rest are refusals, and
    // that ratio is the design working, not a gap to close later.
    const split = BCD_EXEMPTIONS.filter((e) => e.subEntries?.length);
    expect(split.length).toBeGreaterThanOrEqual(8);
    for (const e of split) {
      expect(e.subEntries!.length).toBeGreaterThan(1);
      // A split entry must account for every condition the cell cites.
      const fromSubs = new Set(e.subEntries!.flatMap((s) => s.conditions));
      for (const no of e.conditions) expect(fromSubs.has(no)).toBe(true);
    }
  });
});
