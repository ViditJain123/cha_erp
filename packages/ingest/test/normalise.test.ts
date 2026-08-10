import { describe, expect, it } from 'vitest';
import {
  dedupeIdentifiers,
  isValidContainerNumber,
  makeIdentifier,
  normaliseAwb,
  normaliseBl,
  normaliseContainer,
  normaliseInvoice,
} from '../src/normalise.js';

describe('container check digit (ISO 6346)', () => {
  // CSQU3054383 is the worked example from the standard itself.
  it.each(['CSQU3054383', 'MSKU6874101', 'TGHU7644424', 'HLXU8177720'])('accepts %s', (n) => {
    expect(isValidContainerNumber(n)).toBe(true);
  });

  // The same prefixes with the digit a human would plausibly mistype. These
  // are exactly what the check digit exists to catch — without it they would
  // be accepted as match keys and could merge two unrelated shipments.
  it.each(['MSKU6874100', 'TGHU7644428', 'HLXU8177725'])('rejects near-miss %s', (n) => {
    expect(isValidContainerNumber(n)).toBe(false);
  });

  it('accepts a number written with spaces and hyphens', () => {
    expect(isValidContainerNumber('CSQU 305438-3')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidContainerNumber('CSQU3054384')).toBe(false);
  });

  it('rejects a transposition that keeps the shape', () => {
    expect(isValidContainerNumber('CSQU3054338')).toBe(false);
  });

  it.each(['CSQ3054383', 'CSQUU054383', '1SQU3054383', ''])('rejects malformed %s', (n) => {
    expect(isValidContainerNumber(n)).toBe(false);
  });
});

describe('normalisation', () => {
  it('strips punctuation and uppercases bill of lading numbers', () => {
    expect(normaliseBl('mediu-1234 5678')).toBe('MEDIU12345678');
  });

  it('rejects a bill of lading number too short to be distinctive', () => {
    expect(normaliseBl('BL-12')).toBeNull();
  });

  it('reduces an air waybill to 11 digits', () => {
    expect(normaliseAwb('057-79606800')).toBe('05779606800');
  });

  it('rejects an air waybill of the wrong length', () => {
    expect(normaliseAwb('057-7960680')).toBeNull();
  });

  it('rejects short invoice numbers that would collide', () => {
    expect(normaliseInvoice('INV-1')).toBeNull();
    expect(normaliseInvoice('INV-2026-0044')).toBe('INV20260044');
  });

  it('rejects a container number that fails its check digit', () => {
    expect(normaliseContainer('CSQU3054384')).toBeNull();
  });
});

describe('makeIdentifier', () => {
  it('returns null for empty input', () => {
    expect(makeIdentifier('bl', null)).toBeNull();
    expect(makeIdentifier('bl', '')).toBeNull();
  });

  it('keeps the raw value alongside the normalised one', () => {
    expect(makeIdentifier('bl', ' mediu-1234 5678 ')).toEqual({
      kind: 'bl',
      value: 'MEDIU12345678',
      raw: 'mediu-1234 5678',
    });
  });

  it('normalises both sides identically, so a lookup matches its write', () => {
    const onWrite = makeIdentifier('invoice', 'INV/2026/0044');
    const onLookup = makeIdentifier('invoice', 'inv 2026 0044');
    expect(onWrite?.value).toBe(onLookup?.value);
  });
});

describe('dedupeIdentifiers', () => {
  it('collapses repeats of the same kind and value', () => {
    const ids = [
      makeIdentifier('bl', 'MEDIU12345678'),
      makeIdentifier('bl', 'mediu-1234-5678'),
      makeIdentifier('invoice', 'INV-2026-0044'),
    ].filter((x) => x !== null);
    expect(dedupeIdentifiers(ids)).toHaveLength(2);
  });
});
