import { describe, expect, it } from 'vitest';
import { hsLookupKeys, hsMatchesPrefix, hsPrefixes, normaliseHsCode } from '../src/hs.js';

describe('normaliseHsCode', () => {
  it('strips the formatting people type', () => {
    expect(normaliseHsCode('3304.99.90')).toBe('33049990');
    expect(normaliseHsCode('3304 9990')).toBe('33049990');
  });

  it('caps at the 8 digits India uses', () => {
    expect(normaliseHsCode('330499901234')).toBe('33049990');
  });

  it('rejects anything too coarse to act on', () => {
    // A two-digit chapter is not enough to attach a requirement to a shipment.
    expect(normaliseHsCode('33')).toBeNull();
    expect(normaliseHsCode('')).toBeNull();
    expect(normaliseHsCode('abc')).toBeNull();
  });

  it('accepts a four-digit heading', () => {
    expect(normaliseHsCode('3304')).toBe('3304');
  });
});

describe('hsPrefixes', () => {
  it('lists every prefix, longest first', () => {
    expect(hsPrefixes('33049990')).toEqual([
      '33049990',
      '3304999',
      '330499',
      '33049',
      '3304',
      '330',
      '33',
    ]);
  });

  it('honours the minimum length', () => {
    expect(hsPrefixes('3304', 4)).toEqual(['3304']);
  });
});

describe('hsLookupKeys', () => {
  it('deduplicates prefixes shared between codes', () => {
    // Two codes in the same heading share everything from 3304 down.
    const keys = hsLookupKeys(['33049990', '33041000']);
    expect(keys.filter((k) => k === '3304')).toHaveLength(1);
    expect(keys).toContain('33049990');
    expect(keys).toContain('33041000');
  });

  it('skips codes too short to be meaningful', () => {
    expect(hsLookupKeys(['33'])).toEqual([]);
  });
});

describe('hsMatchesPrefix', () => {
  it('matches a heading-level requirement against a full code', () => {
    expect(hsMatchesPrefix('33049990', '3304')).toBe(true);
  });

  it('does not match a neighbouring heading', () => {
    // The case worth being sure about: 3305 must not pick up 3304's rules.
    expect(hsMatchesPrefix('33059990', '3304')).toBe(false);
  });

  it('does not match a longer requirement against a shorter code', () => {
    expect(hsMatchesPrefix('3304', '33049990')).toBe(false);
  });

  it('ignores formatting on either side', () => {
    expect(hsMatchesPrefix('3304.99.90', '33.04')).toBe(true);
  });

  it('never matches on an empty prefix', () => {
    expect(hsMatchesPrefix('33049990', '')).toBe(false);
  });
});
