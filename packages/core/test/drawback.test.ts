import { describe, expect, it } from 'vitest';
import { drawbackFile, lookupDrawback } from '../src/masters/drawback.js';

describe('duty drawback', () => {
  const file = drawbackFile();

  it('is built and says it is unverified', () => {
    expect(file).not.toBeNull();
    expect(file!.entryCount).toBeGreaterThan(2_000);
    // Load-bearing: nothing in this table checks itself, and the file has to
    // keep saying so wherever it is read.
    expect(file!.verified).toBe(false);
    expect(file!.note).toMatch(/reconcile against the DoR schedule/i);
  });

  it('flags the rates a lost decimal point would explain', () => {
    expect(file!.uncertainRates).toBeGreaterThan(0);
    // A minority. If most of the table were suspect the parse, not the scan,
    // would be the problem.
    expect(file!.uncertainRates).toBeLessThan(file!.entryCount * 0.2);
    for (const e of file!.entries) {
      if (e.rateUncertain) expect(e.ratePrinted).toContain('%');
    }
  });

  it('reaches entries from a tariff code', () => {
    // Meat of bovine animals — the first drawback entry in the book.
    const beef = lookupDrawback('02011000');
    expect(beef.length).toBeGreaterThan(0);
    expect(beef[0]!.rate).toBeCloseTo(0.15, 2);
  });

  it('keeps the printed text beside every parsed rate', () => {
    for (const e of file!.entries) {
      expect(e.ratePrinted).toMatch(/^\d/);
      expect(e.serial).toMatch(/^\d{4}(\d{2})?(\d{2})?$/);
    }
  });
});
