import { describe, expect, it } from 'vitest';
import {
  BCD_CONDITIONS,
  BCD_EXEMPTIONS,
  BCD_EXEMPTION_NOTIFICATION,
  IGST_RATE_NOTIFICATION,
  IGST_SCHEDULE,
  bcdConditionTexts,
  bcdExemptionMatches,
  igstRateForCth,
  igstScheduleMatches,
} from '../src/masters/index.js';

/**
 * The two standing CBIC notifications, read out of the published PDFs by
 * `scripts/build-masters.py`.
 *
 * Before these the tariff master held three rows — the CTHs the two reference
 * jobs happened to use — and every other item on every other job came out of
 * the merge with `igstRate: 0` and a flag telling the reviewer to type the
 * rates in by hand.
 */
describe('IGST rate schedule — notification 9/2025-IT(R)', () => {
  it('carries all seven schedules, numbered without gaps', () => {
    expect(IGST_SCHEDULE.length).toBeGreaterThan(1100);
    for (const schedule of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']) {
      const serials = IGST_SCHEDULE.filter((e) => e.schedule === schedule).map((e) => Number(e.serial));
      expect(serials.length).toBeGreaterThan(0);
      expect(serials).toEqual([...Array(serials.length).keys()].map((i) => i + 1));
    }
  });

  it('agrees with the serial filed on the reference Bill of Entry', () => {
    // Job EP/061126/1 filed polypropylene under IGST notification 009/2025
    // serial "II114" — schedule II, S.No. 114. That serial was transcribed off
    // the Logi-Sys checklist by hand; the masters now derive it.
    const igst = igstRateForCth('39021000');
    expect(igst?.rate).toBe(18);
    expect(igst?.notification).toBe(IGST_RATE_NOTIFICATION);
    expect(`${igst?.entry.schedule}${igst?.entry.serial}`).toBe('II114');
  });

  it('prefers the most specific entry over the heading it sits under', () => {
    // Schedule I S.No. 42 covers 0910 at 5% but excludes 0910 11 10 and
    // 0910 30 10 — fresh ginger and fresh turmeric are not spices here.
    const spice = igstRateForCth('09109929');
    expect(spice?.rate).toBe(5);
    expect(spice?.entry.serial).toBe('42');
    expect(igstScheduleMatches('09101110').some((e) => e.serial === '42' && e.schedule === 'I')).toBe(false);
  });

  it('falls back to the residual 18% entry, and says that it did', () => {
    // A CTH no schedule names is Schedule II's "goods which are not specified
    // in Schedule I, III, IV, V, VI or VII" — the notification's own rule.
    const residual = igstRateForCth('09101110');
    expect(residual?.rate).toBe(18);
    expect(residual?.residual).toBe(true);
    expect(residual?.entry.description).toMatch(/not specified in Schedule/i);
  });

  it('reports rivals rather than silently picking one', () => {
    // Heading 1702 is 5% as jaggery and 18% as everything else; only the goods
    // description separates them, so the lookup hands both back.
    const lactose = igstRateForCth('17021110');
    expect(lactose?.alternatives.length).toBeGreaterThan(0);
    expect(new Set([lactose!.rate, ...lactose!.alternatives.map((a) => a.rate)])).toEqual(new Set([5, 18]));
  });

  it('rejects a code too short to classify', () => {
    expect(igstRateForCth('390')).toBeUndefined();
  });
});

describe('BCD exemptions — notification 45/2025-Customs', () => {
  it('carries Tables I to IV and their conditions, as amended', () => {
    // 539 entries as published, 454 after 02/2026 omitted 85 serials. The
    // count moved because the notification did, not because the parse got
    // worse — the master is the notification *as in force*, not as printed.
    expect(BCD_EXEMPTIONS.length).toBeGreaterThan(400);
    expect(new Set(BCD_EXEMPTIONS.map((e) => e.table))).toEqual(new Set(['I', 'II', 'III', 'IV']));
    expect(BCD_CONDITIONS.length).toBeGreaterThan(100);
  });

  it('no longer carries a serial that has been omitted', () => {
    // S.No. 1 — animals and birds imported by a zoo — was omitted by
    // 02/2026. Holding it would offer a concession that no longer exists.
    expect(BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '1')).toBeUndefined();
    expect(BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '161')).toBeUndefined();
  });

  it('every cited condition resolves to its text', () => {
    for (const entry of BCD_EXEMPTIONS) {
      const cited = (entry.condition ?? '').match(/\d+/g) ?? [];
      if (!cited.length) continue;
      expect(bcdConditionTexts(entry).length).toBeGreaterThan(0);
    }
  });

  it('keeps a stacked rate as text instead of flattening it', () => {
    // An S.No. covering several sub-items prints one rate per sub-item in the
    // same cell. Where they differ ("15% 35% 70% 70%"), picking the first
    // would be right for one line and wrong for the rest, so the numeric rate
    // is left null and the cell is kept verbatim. Where they agree, the rate
    // is not in doubt and the number stands.
    const disagreeing = BCD_EXEMPTIONS.filter((e) => new Set(e.bcdRateText.split(' ')).size > 1);
    expect(disagreeing.length).toBeGreaterThan(0);
    for (const entry of disagreeing) expect(entry.bcdRate).toBeNull();

    const repeated = BCD_EXEMPTIONS.filter(
      (e) => e.bcdRateText.includes(' ') && new Set(e.bcdRateText.split(' ')).size === 1,
    );
    expect(repeated.length).toBeGreaterThan(0);
    for (const entry of repeated) expect(entry.bcdRate).not.toBeNull();
  });

  it('offers concessions for a code, most specific first', () => {
    const matches = bcdExemptionMatches('90211000');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.table).toBe('I');
    const ranks = matches.map((e) => Math.max(...e.include.filter((i) => '90211000'.startsWith(i)).map((i) => i.length), 0));
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('leaves "Any Chapter" entries out unless they are asked for', () => {
    // Diplomatic baggage and defence stores cover every code and describe no
    // ordinary consignment; included by default they bury the real candidates.
    const named = bcdExemptionMatches('84713010');
    const all = bcdExemptionMatches('84713010', { includeAnyChapter: true });
    expect(named.every((e) => !e.anyChapter || e.include.some((i) => '84713010'.startsWith(i)))).toBe(true);
    expect(all.length).toBeGreaterThan(named.length);
  });

  it('is filed under its ICES notification number', () => {
    expect(BCD_EXEMPTION_NOTIFICATION).toBe('045/2025');
    expect(IGST_RATE_NOTIFICATION).toBe('009/2025');
  });
});
