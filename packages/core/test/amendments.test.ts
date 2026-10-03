import { describe, expect, it } from 'vitest';
import {
  BCD_CONDITIONS,
  BCD_EXEMPTIONS,
  BCD_UNAPPLIED_AMENDMENTS,
  bcdExemptionEntry,
  bcdExemptionLapsed,
  bcdExemptionMatches,
  isInForce,
  isStale,
} from '../src/masters/index.js';

/**
 * A notification is not a document — it is a document plus everything issued
 * against it since, each part taking effect on its own date.
 *
 * 45/2025 was published on 24 October 2025 and amended six times in the next
 * nine months. Read from the base PDF alone it is wrong about a third of its
 * entries: 02/2026 alone extends 95 sunset provisos from 31.03.2026 to
 * 31.03.2028 and omits 86 serials. But the omissions mostly wait until April
 * or May, and a Bill of Entry is assessed under the text in force on its own
 * date — so the masters keep every version, dated, rather than the latest
 * text alone.
 *
 * These pin the amendments that are applied, the dates they apply from, and —
 * just as important — the ones that are not applied.
 */
describe('sunset provisos move with the amendment', () => {
  const entry = (serial: string) => bcdExemptionEntry('I', serial)!;

  it('carries S.No. 160 to 2028, which is what makes job I-40127 lawful', () => {
    // Wood pulp for the manufacture of paper. The base notification kills this
    // concession on 31 March 2026; 02/2026 item (77) moves it to 2028. The job
    // arrives 8 October 2026, so the difference is the whole claim — ₹3.35 lakh
    // of BCD and SWS on one four-container consignment.
    expect(entry('160').description).toContain('31st March, 2028');
    expect(entry('160').description).not.toContain('31st March, 2026');
    expect(entry('160').amendedBy).toContain('02/2026-Customs (sunset)');
  });

  it('reads the sunset out as a date, so it can be compared to a filing date', () => {
    expect(entry('160').validUntil).toBe('2028-03-31');
    expect(isInForce(entry('160'), '2026-10-08')).toBe(true);
    expect(isInForce(entry('160'), '2028-04-01')).toBe(false);
  });

  it('starts every entry on the day 45/2025 came into force', () => {
    expect(entry('160').validFrom).toBe('2025-11-01');
    expect(isInForce(entry('160'), '2025-10-31')).toBe(false);
  });

  it('clears Table I of provisos the amendment already moved', () => {
    // Every Table I entry still ending 31 March 2026 is either omitted from
    // 1 April 2026, or one whose whole row 02/2026 substituted — recorded as
    // stale, with the new text unread. None is simply an unapplied date.
    const left = BCD_EXEMPTIONS.filter(
      (e) => e.table === 'I' && e.validUntil === '2026-03-31' && !isStale(e) && !e.omittedBy,
    );
    expect(left).toEqual([]);
  });

  it('applies part IV of 02/2026 to Table II, not only part I to Table I', () => {
    // The Table II sunsets sit after the numbered Table I instructions, under
    // their own roman numeral and lettered (a), (b). Read as one numbered run,
    // they were silently lost and both concessions read as lapsed in April.
    for (const serial of ['1', '2']) {
      const e = bcdExemptionEntry('II', serial)!;
      expect(e.validUntil).toBe('2028-03-31');
      expect(e.amendedBy).toContain('02/2026-Customs (sunset)');
    }
    expect(bcdExemptionEntry('II', '66')!.staleBy).toContain('02/2026-Customs (replace)');
  });

  it('still holds concessions that genuinely lapsed, and can say so', () => {
    const lapsed = BCD_EXEMPTIONS.filter((e) => !isInForce(e, '2026-08-31'));
    expect(lapsed.length).toBeGreaterThan(0);
    for (const e of lapsed) expect(e.validUntil! < '2026-08-31' || e.validFrom > '2026-08-31').toBe(true);
  });
});

describe('omitted serials are kept, ending the day before the omission', () => {
  it('keeps all 86 serials 02/2026 omits, each with an end date', () => {
    const omitted = BCD_EXEMPTIONS.filter((e) => e.omittedBy);
    expect(omitted.length).toBe(86);
    for (const e of omitted) {
      expect(e.omittedBy).toBe('02/2026-Customs');
      expect(e.validUntil).toBeDefined();
    }
  });

  it('ends an unqualified omission the day before 02/2026 came into force', () => {
    // "S. No. 1 and the entries relating thereto shall be omitted" — no date
    // of its own, so it takes the notification's: 2 February 2026, the day
    // after the Budget it was issued on.
    expect(bcdExemptionEntry('I', '1')!.validUntil).toBe('2026-02-01');
  });

  it('honours an instruction that names its own date', () => {
    // "S. No. 4 ... shall be omitted with effect from the 1st day of May, 2026".
    const e = bcdExemptionEntry('I', '4')!;
    expect(e.validUntil).toBe('2026-04-30');
    expect(isInForce(e, '2026-04-30')).toBe(true);
    expect(isInForce(e, '2026-05-01')).toBe(false);
  });

  it('offers an omitted concession only to filings before it went', () => {
    // S.No. 161 was rayon grade wood pulp, heading 4702, beside S.No. 160's
    // chapter-wide wood pulp. Both covered 47020000 until 161 was omitted from
    // 1 May 2026.
    const on = (date: string) => bcdExemptionMatches('47020000', { onIsoDate: date }).map((e) => e.serial);
    expect(on('2026-03-15')).toEqual(expect.arrayContaining(['160', '161']));
    expect(on('2026-10-08')).toContain('160');
    expect(on('2026-10-08')).not.toContain('161');
    expect(bcdExemptionLapsed('47020000', '2026-10-08').map((e) => e.serial)).toContain('161');
  });

  it('omits Table IV S.No. 1 from 1 April 2026, part VII of 02/2026', () => {
    const e = bcdExemptionEntry('IV', '1')!;
    expect(e.omittedBy).toBe('02/2026-Customs');
    expect(e.validUntil).toBe('2026-03-31');
  });
});

describe('a substituted rate becomes a second dated version', () => {
  it('holds S.No. 192 at 5% until 15/2026 takes effect, and 10% from then', () => {
    // 15/2026 was issued on 12 May 2026 and "shall come into force on the
    // 13th day of May, 2026" — the issue date is not the date that matters.
    expect(bcdExemptionEntry('I', '192', '2026-05-12')!.bcdRate).toBe(5);
    expect(bcdExemptionEntry('I', '192', '2026-05-13')!.bcdRate).toBe(10);
    const latest = bcdExemptionEntry('I', '192')!;
    expect(latest.bcdRateText).toBe('10%');
    expect(latest.amendedBy).toContain('15/2026-Customs (rate)');
  });

  it('never has two versions of a serial in force on the same day', () => {
    const byKey = new Map<string, typeof BCD_EXEMPTIONS>();
    for (const e of BCD_EXEMPTIONS) {
      const key = `${e.table}/${e.serial}`;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
    for (const versions of byKey.values()) {
      const sorted = [...versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1]!.validUntil).toBeDefined();
        expect(sorted[i - 1]!.validUntil! < sorted[i]!.validFrom).toBe(true);
      }
    }
  });

  it('does not report a serial as lapsed when a later version took over', () => {
    const cth = '71081300';
    expect(bcdExemptionMatches(cth).filter((e) => e.serial === '192')).toHaveLength(2);
    expect(bcdExemptionLapsed(cth, '2026-06-01').map((e) => e.serial)).not.toContain('192');
  });
});

describe('what could not be applied is published, not hidden', () => {
  it('records every instruction left for a human', () => {
    // Inserted serials and substituted rows carry new text only a person can
    // read; two corrigenda edit a printed page and cannot be located by serial
    // at all; the appended Lists and the condition annexures are not parsed.
    // Silence here would be the dangerous outcome.
    expect(BCD_UNAPPLIED_AMENDMENTS.length).toBe(38);
    const kinds = new Set(BCD_UNAPPLIED_AMENDMENTS.map((i) => i.kind));
    for (const kind of ['insert', 'page', 'list', 'annexure'] as const) expect(kinds).toContain(kind);
  });

  it('dates each instruction by when it takes effect, not when it was issued', () => {
    const fifteen = BCD_UNAPPLIED_AMENDMENTS.find((i) => i.notification === '15/2026-Customs')!;
    expect(fifteen.date).toBe('2026-05-12');
    expect(fifteen.inForce).toBe('2026-05-13');
  });

  it('marks a rewritten condition stale, and leaves an inserted one alone', () => {
    // Part II of 02/2026 changes Table I condition 5 from 1% to 3%, and
    // inserts condition 88 after 87 — which changes nothing about 87.
    const condition = (no: string) => BCD_CONDITIONS.find((c) => c.table === 'I' && c.no === no)!;
    expect(condition('5').staleBy).toContain('02/2026-Customs (annexure)');
    expect(condition('87').staleBy).toBeUndefined();
  });

  it('marks the entries those instructions touch as stale', () => {
    const stale = BCD_EXEMPTIONS.filter((e) => isStale(e));
    expect(stale.length).toBeGreaterThan(0);
    for (const entry of stale) {
      expect(entry.staleBy!.length).toBeGreaterThan(0);
      expect(entry.staleFrom).toBeDefined();
    }
  });

  it('splits a compound instruction so neither half is lost', () => {
    // Instruction 62 of 02/2026 does two things to S.No. 140: moves its sunset
    // (applied) and rewrites its conditions (not applied). Reading the
    // instruction as one action would apply the first and silently drop the
    // second, leaving an entry that looks current and states the wrong
    // conditions.
    const entry = bcdExemptionEntry('I', '140')!;
    expect(entry.description).toContain('31st March, 2028');
    expect(entry.amendedBy).toContain('02/2026-Customs (sunset)');
    expect(entry.staleBy).toContain('02/2026-Customs (condition)');
    expect(isStale(entry)).toBe(true);
  });

  it('is not stale for a filing before the amendment took effect', () => {
    // Before 2 February 2026 the base text of S.No. 140 was the text in force.
    const entry = bcdExemptionEntry('I', '140')!;
    expect(isStale(entry, '2026-01-15')).toBe(false);
    expect(isStale(entry, '2026-02-02')).toBe(true);
  });
});
