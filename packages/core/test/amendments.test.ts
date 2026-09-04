import { describe, expect, it } from 'vitest';
import {
  BCD_EXEMPTIONS,
  BCD_UNAPPLIED_AMENDMENTS,
  bcdExemptionMatches,
  isInForce,
  isStale,
} from '../src/masters/index.js';

/**
 * A notification is not a document — it is a document plus everything issued
 * against it since.
 *
 * 45/2025 was published on 24 October 2025 and amended six times in the next
 * nine months. Read from the base PDF alone it is wrong about a third of its
 * entries: 02/2026 alone extends 93 sunset provisos from 31.03.2026 to
 * 31.03.2028 and omits 85 serials outright. So a master built from the base
 * text would simultaneously deny 93 live concessions and offer 85 that no
 * longer exist.
 *
 * These pin the amendments that are applied, and — just as important — the
 * ones that are not.
 */
describe('sunset provisos move with the amendment', () => {
  const entry = (serial: string) => BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === serial);

  it('carries S.No. 160 to 2028, which is what makes job I-40127 lawful', () => {
    // Wood pulp for the manufacture of paper. The base notification kills this
    // concession on 31 March 2026; 02/2026 item (77) moves it to 2028. The job
    // arrives 8 October 2026, so the difference is the whole claim — ₹3.35 lakh
    // of BCD and SWS on one four-container consignment.
    expect(entry('160')!.description).toContain('31st March, 2028');
    expect(entry('160')!.description).not.toContain('31st March, 2026');
    expect(entry('160')!.amendedBy).toContain('02/2026-Customs (sunset)');
  });

  it('reads the sunset out as a date, so it can be compared to a filing date', () => {
    expect(entry('160')!.validUntil).toBe('2028-03-31');
    expect(isInForce(entry('160')!, '2026-10-08')).toBe(true);
    expect(isInForce(entry('160')!, '2028-04-01')).toBe(false);
  });

  it('clears Table I of provisos the amendment already moved', () => {
    // Every Table I entry still naming 31 March 2026 is one whose whole row
    // 02/2026 substituted — recorded as stale, with the new text unread. None
    // is simply an unapplied date.
    const left = BCD_EXEMPTIONS.filter(
      (e) => e.table === 'I' && e.validUntil === '2026-03-31' && !isStale(e),
    );
    expect(left).toEqual([]);
  });

  it('still holds concessions that genuinely lapsed, and can say so', () => {
    // 02/2026 amended Table I only, so a handful of Table II provisos really
    // did expire on 31 March 2026 and were never extended. They stay in the
    // master — the entry is what the notification says — but a filing date
    // decides whether they may be claimed, which is what isInForce is for.
    const lapsed = BCD_EXEMPTIONS.filter((e) => !isInForce(e, '2026-08-31'));
    expect(lapsed.length).toBeGreaterThan(0);
    for (const e of lapsed) expect(e.validUntil! < '2026-08-31').toBe(true);
  });
});

describe('omitted serials are gone, not merely flagged', () => {
  it('drops the 85 serials 02/2026 removed', () => {
    // 539 published, 454 in force.
    expect(BCD_EXEMPTIONS.length).toBe(454);
    for (const serial of ['1', '4', '7', '161']) {
      expect(BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === serial)).toBeUndefined();
    }
  });

  it('stops offering an omitted concession for a code it used to cover', () => {
    // S.No. 161 was rayon grade wood pulp, in the same chapter as 160. Both
    // covered CTH 47032100; only one still does.
    expect(bcdExemptionMatches('47032100').map((e) => e.serial)).toContain('160');
    expect(bcdExemptionMatches('47032100').map((e) => e.serial)).not.toContain('161');
  });
});

describe('rate substitutions are applied where they are unambiguous', () => {
  it('moves S.No. 192 from 5% to 10% per 15/2026', () => {
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '192')!;
    expect(entry.bcdRate).toBe(10);
    expect(entry.bcdRateText).toBe('10%');
    expect(entry.amendedBy).toContain('15/2026-Customs (rate)');
  });
});

describe('what could not be applied is published, not hidden', () => {
  it('records every instruction left for a human', () => {
    // 31 of 202: inserted serials and substituted rows carry new text only a
    // person can read, two corrigenda edit a printed page and cannot be
    // located by serial at all, and one amends an appended List we do not
    // parse. Silence here would be the dangerous outcome.
    expect(BCD_UNAPPLIED_AMENDMENTS.length).toBe(31);
    const kinds = new Set(BCD_UNAPPLIED_AMENDMENTS.map((i) => i.kind));
    expect(kinds).toContain('insert');
    expect(kinds).toContain('page');
  });

  it('marks the entries those instructions touch as stale', () => {
    const stale = BCD_EXEMPTIONS.filter(isStale);
    expect(stale.length).toBeGreaterThan(0);
    for (const entry of stale) {
      expect(entry.staleBy!.length).toBeGreaterThan(0);
    }
  });

  it('splits a compound instruction so neither half is lost', () => {
    // Instruction 62 of 02/2026 does two things to S.No. 140: moves its sunset
    // (applied) and rewrites its conditions (not applied). Reading the
    // instruction as one action would apply the first and silently drop the
    // second, leaving an entry that looks current and states the wrong
    // conditions.
    const entry = BCD_EXEMPTIONS.find((e) => e.table === 'I' && e.serial === '140')!;
    expect(entry.description).toContain('31st March, 2028');
    expect(entry.amendedBy).toContain('02/2026-Customs (sunset)');
    expect(entry.staleBy).toContain('02/2026-Customs (condition)');
    expect(isStale(entry)).toBe(true);
  });
});
