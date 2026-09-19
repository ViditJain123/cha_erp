import { describe, expect, it } from 'vitest';
import { crossCheckTariffBook, tariffDissent } from '../src/masters/tariff-cross-check.js';

/**
 * The book read against CBIC's own notifications.
 *
 * This is the test that would catch a re-parse quietly getting worse in a way
 * the arithmetic cannot see: nothing on a printed row constrains the statutory
 * BASIC column, so a second source is the only check on it.
 */
describe('tariff book vs the notification masters', () => {
  const report = crossCheckTariffBook();

  it('runs over the whole book', () => {
    expect(report).not.toBeNull();
    expect(report!.checked).toBeGreaterThan(11_000);
  });

  it('agrees with 9/2025-IT(R) wherever both sources state a rate', () => {
    // Two independent parses of two different documents. Below this something
    // has drifted and the build should not be trusted.
    expect(report!.agreement).toBeGreaterThan(0.95);
    expect(report!.corroborated).toBeGreaterThan(4_000);
  });

  it('keeps the real conflicts small enough for a human to read', () => {
    // At the time of writing: 87, nearly all demerit goods where the book
    // carries the 40% slab and the parsed 9/2025 masters carry 28%.
    expect(report!.disputed).toBeLessThan(400);
  });

  /**
   * Every row where the book says nil against a rated CBIC entry runs the same
   * way, and none runs the other. That is the signature of a systematic hole in
   * our masters — the companion IGST *exemption* notification, which nothing in
   * this repo parses — rather than of a bad read. If rows ever start appearing
   * in the opposite direction, that assumption has broken.
   */
  it('finds no CBIC-nil rows the book rates', () => {
    const wrongWay = report!.rows
      .flatMap((r) => r.dissent)
      .filter((d) => d.cbic === 0 && d.book > 0);
    expect(wrongWay).toEqual([]);
  });

  it('reports a dissent only where both sources named a rate', () => {
    for (const row of report!.rows) {
      if (row.status !== 'disputed') continue;
      for (const d of row.dissent) {
        expect(d.cbic).toBeGreaterThan(0);
        expect(d.book).toBeGreaterThan(0);
        expect(d.cbic).not.toBe(d.book);
      }
    }
  });

  it('stays quiet for the overwhelming majority of codes', () => {
    expect(tariffDissent('39021000')).toEqual([]);
    expect(tariffDissent('34039900')).toEqual([]);
    // Fresh produce: a gap in our masters, not a conflict, so no flag.
    expect(tariffDissent('07031011')).toEqual([]);
  });
});
