import { describe, expect, it } from 'vitest';
import {
  describeWarehouseCodeError,
  parseWarehouseCode,
  parseWarehouseCodeResult,
} from '../src/index.js';

/**
 * The eight-character bonded warehouse code.
 *
 * Worth testing hard because it is the one part of the INBOND_EXBOND sheet that
 * can be checked without asking anybody: the port prefix is an ICES site code,
 * so a warehouse code that names no real station is a typo we can catch before
 * Customs does.
 */

describe('parseWarehouseCode', () => {
  it('decodes the example from ICEGATE’s own manual', () => {
    // MAA1U001 — M/S APM TERMINAL(I) PVT. LTD, a public warehouse under
    // Chennai Sea. ICEGATE 2.0 Public Enquiries user manual v1.01, §5.5.
    const parsed = parseWarehouseCode('MAA1U001');
    expect(parsed).toBeDefined();
    expect(parsed!.stationCode).toBe('INMAA1');
    expect(parsed!.station.name).toBe('Chennai Sea');
    expect(parsed!.stationKind).toBe('sea');
    expect(parsed!.type).toBe('public');
    expect(parsed!.serial).toBe('001');
  });

  it('reads the three licence types', () => {
    expect(parseWarehouseCode('NSA1U001')?.type).toBe('public'); // s.57
    expect(parseWarehouseCode('NSA1R001')?.type).toBe('private'); // s.58
    expect(parseWarehouseCode('NSA1P001')?.type).toBe('special'); // s.58A
  });

  it('accepts lower case and surrounding space', () => {
    expect(parseWarehouseCode('  maa1u001 ')?.code).toBe('MAA1U001');
  });

  it('carries the station kind through, so an inland warehouse is knowable', () => {
    // TKD6 is ICD Tuglakabad — a warehouse there is inland, whatever route the
    // goods took to reach it.
    expect(parseWarehouseCode('TKD6R014')?.stationKind).toBe('inland');
    expect(parseWarehouseCode('BOM4U002')?.stationKind).toBe('air');
  });

  it('keeps a serial’s leading zeros', () => {
    // Not a number: 001 and 1 are different warehouses.
    expect(parseWarehouseCode('MAA1U007')?.serial).toBe('007');
  });
});

describe('rejecting a code that is not one', () => {
  it('says which character is wrong rather than "invalid"', () => {
    const cases: [string, RegExp][] = [
      ['', /No warehouse code/],
      ['MAA1U01', /8 characters/],
      ['MAA1U0011', /8 characters/],
      ['ZZZZU001', /not an ICES port code/],
      ['MAA1X001', /not a warehouse type/],
      ['MAA1U0O1', /three-digit serial/],
    ];
    for (const [code, expected] of cases) {
      const result = parseWarehouseCodeResult(code);
      expect(result.ok, `"${code}" should not parse`).toBe(false);
      if (!result.ok) expect(describeWarehouseCodeError(result.error)).toMatch(expected);
    }
  });

  it('returns undefined from the plain form', () => {
    expect(parseWarehouseCode('ZZZZU001')).toBeUndefined();
    expect(parseWarehouseCode(null)).toBeUndefined();
    expect(parseWarehouseCode(undefined)).toBeUndefined();
  });

  it('does not accept a customs station code on its own', () => {
    // INNSA1 is a station, not a warehouse. Six characters, and no type letter.
    expect(parseWarehouseCode('INNSA1')).toBeUndefined();
  });
});
