import { describe, expect, it } from 'vitest';
import { allTariff, lookupTariff } from '../src/masters/index.js';
import { TARIFF } from '../src/masters/data.js';
import { productIndexFile, tariffBook, tariffBookMasters } from '../src/masters/tariff-book.js';

/**
 * Covers the whole parsed book, not the two reference jobs.
 *
 * The point of these is that a re-parse which reads *worse* fails here rather
 * than shipping a thinner or wronger master. The build script enforces its own
 * floors; this enforces what the rest of the codebase is entitled to assume.
 */
describe('tariff book', () => {
  const book = tariffBook();

  it('is built and committed', () => {
    expect(book).not.toBeNull();
  });

  it('covers the First Schedule', () => {
    expect(book!.rowCount).toBeGreaterThan(11_000);
    const chapters = new Set(book!.rows.map((r) => Number(r.cth.slice(0, 2))));
    // 77 is reserved by the HS and carries no tariff items.
    for (let ch = 1; ch <= 98; ch++) {
      if (ch === 77) continue;
      expect(chapters, `chapter ${ch}`).toContain(ch);
    }
  });

  it('reconciles the great majority of rows against their printed TOTAL', () => {
    expect(book!.checksumPassRate).toBeGreaterThan(0.85);
  });

  /**
   * The three seed rows were transcribed by hand from filed jobs, so they are
   * the only rows whose rates are known independently of the parse. The book
   * reproducing them exactly is the evidence that the other 12,000 can be
   * trusted — and the reason the seed is allowed to sit above the book in
   * `allTariff()` without hiding a disagreement.
   */
  it('reproduces every hand-typed seed row', () => {
    const rows = new Map(tariffBookMasters().map((r) => [r.cth, r]));
    for (const seed of TARIFF) {
      const parsed = rows.get(seed.cth);
      expect(parsed, `${seed.cth} missing from the book`).toBeDefined();
      expect(parsed!.bcdRate, `${seed.cth} BCD`).toBe(seed.bcdRate);
      expect(parsed!.igstRate, `${seed.cth} IGST`).toBe(seed.igstRate);
      expect(parsed!.unit, `${seed.cth} UQC`).toBe(seed.unit);
    }
  });

  it('answers the codes the pipeline actually meets', () => {
    // Polypropylene (job I-13844/26-27) and lubricating preparations.
    expect(lookupTariff('39021000')?.bcdRate).toBe(7.5);
    expect(lookupTariff('34039900')?.igstRate).toBe(18);
    // A code no seed row carries, so it can only have come from the book.
    const knitwear = lookupTariff('61023010');
    expect(knitwear?.provenance?.source).toBe('book');
    expect(knitwear?.igstRate).toBe(18);
  });

  it('keeps the seed and overlay above the book', () => {
    const all = allTariff();
    expect(all.length).toBeGreaterThan(11_000);
    expect(new Set(all.map((r) => r.cth)).size).toBe(all.length);
    expect(lookupTariff('17021110')?.provenance?.source).toBe('seed');
  });

  it('never ships a rate it could not verify without saying so', () => {
    for (const row of tariffBookMasters()) {
      expect(row.provenance?.confidence).toBeDefined();
    }
    const unverified = tariffBookMasters().filter(
      (r) => r.provenance?.confidence === 'unverified',
    );
    // They exist, they are a minority, and they are labelled.
    expect(unverified.length).toBeLessThan(book!.rowCount * 0.15);
  });
});

describe('product index', () => {
  const index = productIndexFile();

  it('is built and reaches most of the schedule', () => {
    expect(index).not.toBeNull();
    expect(index!.entryCount).toBeGreaterThan(10_000);
    expect(index!.headingCount).toBeGreaterThan(3_000);
  });

  it('points at headings the schedule carries', () => {
    // Some drift is expected: the index is set against HS-2022 and cites
    // Chapter Notes as well as headings. A lot of drift means a parse broke.
    expect(index!.headingsNotInSchedule.length).toBeLessThan(index!.headingCount * 0.2);
  });
});
