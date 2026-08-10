import { describe, expect, it } from 'vitest';
import {
  BE_TYPE_CODE,
  FILING_CODE,
  TOI_CODE,
  TRANSPORT_MODE_CODE,
  iso2,
  normalizePackageUnit,
  pad8,
  parseContainerSizeType,
  unlocodeOf,
} from '../src/index.js';

/**
 * These normalisers exist because of a specific failure: job EP061126-1 was
 * keyed into the Logi-Sys template by hand and every one of them was wrong in
 * the same way — a name written where the template wanted a code. Each block
 * below pins the value that job actually needed.
 */

describe('iso2', () => {
  it('resolves the country names our documents use', () => {
    expect(iso2('Japan')).toBe('JP');
    expect(iso2('JAPAN')).toBe('JP');
    expect(iso2('japan')).toBe('JP');
  });

  it('passes through a valid alpha-2 code', () => {
    expect(iso2('JP')).toBe('JP');
    expect(iso2('jp')).toBe('JP');
  });

  it('rejects a two-letter string that is not a country code', () => {
    // Guards against "AS PER BL" style noise silently becoming American Samoa.
    expect(iso2('XX')).toBeUndefined();
    expect(iso2('QQ')).toBeUndefined();
  });

  it('handles the aliases that appear on real invoices', () => {
    expect(iso2('U.S.A.')).toBe('US');
    expect(iso2('United States of America')).toBe('US');
    expect(iso2('UAE')).toBe('AE');
    expect(iso2('Korea, Republic of')).toBe('KR');
    expect(iso2('Viet Nam')).toBe('VN');
    expect(iso2('Turkey')).toBe('TR');
  });

  it('strips accents rather than failing on them', () => {
    expect(iso2('Türkiye')).toBe('TR');
    expect(iso2('Curaçao')).toBe('CW');
  });

  it('returns undefined rather than guessing', () => {
    expect(iso2(undefined)).toBeUndefined();
    expect(iso2('')).toBeUndefined();
    expect(iso2('   ')).toBeUndefined();
    expect(iso2('Notacountry')).toBeUndefined();
  });
});

describe('unlocodeOf', () => {
  it('parses the code back out of the ICES display form', () => {
    // This is the common case: draft.shipment.portOfLoading stores the
    // formatted string from formatForeignPort(), not the code.
    expect(unlocodeOf('Yokohama(JPYOK)')).toBe('JPYOK');
    expect(unlocodeOf('Mombasa(KEMBA)')).toBe('KEMBA');
  });

  it('resolves raw document text against the ports master', () => {
    expect(unlocodeOf('YOKOHAMA, JAPAN')).toBe('JPYOK');
    expect(unlocodeOf('Yokohama')).toBe('JPYOK');
  });

  it('passes through a bare locode', () => {
    expect(unlocodeOf('JPYOK')).toBe('JPYOK');
  });

  it('does not let a short name outrank a longer one', () => {
    expect(unlocodeOf('NEW YORK')).toBe('USNYC');
  });

  it('returns undefined for an unknown port', () => {
    expect(unlocodeOf('Nowhere')).toBeUndefined();
    expect(unlocodeOf(undefined)).toBeUndefined();
  });
});

describe('parseContainerSizeType', () => {
  it('reads the form the Interasia B/L uses', () => {
    // "40SD96": 40ft, standard, 9'6" high — i.e. a high cube.
    expect(parseContainerSizeType('40SD96')).toEqual({ size: '40', typeCode: 'HC' });
  });

  it('reads the form the Logi-Sys UI shows', () => {
    expect(parseContainerSizeType('40 High Cube')).toEqual({ size: '40', typeCode: 'HC' });
    expect(parseContainerSizeType('HC40')).toEqual({ size: '40', typeCode: 'HC' });
    expect(parseContainerSizeType('40HC')).toEqual({ size: '40', typeCode: 'HC' });
  });

  it('reads plain general-purpose containers', () => {
    expect(parseContainerSizeType('20GP')).toEqual({ size: '20', typeCode: 'GP' });
    expect(parseContainerSizeType("40'GP")).toEqual({ size: '40', typeCode: 'GP' });
  });

  it('reads reefers and open tops', () => {
    expect(parseContainerSizeType('40RF')).toEqual({ size: '40', typeCode: 'RF' });
    expect(parseContainerSizeType('20 Open Top')).toEqual({ size: '20', typeCode: 'OT' });
  });

  it('reads ISO 6346 codes', () => {
    expect(parseContainerSizeType('22G1')).toEqual({ size: '20', typeCode: 'GP' });
    expect(parseContainerSizeType('45G1')).toEqual({ size: '40', typeCode: 'HC' });
  });

  it('returns an empty object rather than a wrong guess', () => {
    expect(parseContainerSizeType(undefined)).toEqual({});
    expect(parseContainerSizeType('')).toEqual({});
  });
});

describe('normalizePackageUnit', () => {
  it('keeps bags as bags', () => {
    // normalizeUqc() would collapse packaging to NOS, which is right for an
    // item quantity and wrong for a package count.
    expect(normalizePackageUnit('BAG')).toBe('BAG');
    expect(normalizePackageUnit('BAGS')).toBe('BAG');
    expect(normalizePackageUnit('BAG(S)')).toBe('BAG');
  });

  it('maps the other packagings we see', () => {
    expect(normalizePackageUnit('CARTON')).toBe('CTN');
    expect(normalizePackageUnit('Pallets')).toBe('PLT');
    expect(normalizePackageUnit('DRUM')).toBe('DRM');
  });

  it('returns undefined for unknown packaging', () => {
    expect(normalizePackageUnit(undefined)).toBeUndefined();
    expect(normalizePackageUnit('sackful')).toBeUndefined();
  });
});

describe('TOI_CODE', () => {
  it('collapses C&F to CFR', () => {
    // The manual attempt wrote CIF here. CIF includes insurance and CFR does
    // not, so the two produce different assessable values.
    expect(TOI_CODE['C&F']).toBe('CFR');
    expect(TOI_CODE.CFR).toBe('CFR');
    expect(TOI_CODE.CIF).toBe('CIF');
  });
});

describe('enumerated header codes', () => {
  it('covers every value the draft can hold', () => {
    expect(TRANSPORT_MODE_CODE.Sea).toBe('SEA');
    expect(TRANSPORT_MODE_CODE.Air).toBe('AIR');
    expect(BE_TYPE_CODE['Home Consumption']).toBe('HOME');
    expect(FILING_CODE.Advance).toBe('ADVANCE');
    expect(FILING_CODE.Normal).toBe('NORMAL');
    expect(FILING_CODE.Prior).toBe('PRIOR');
  });
});

describe('pad8', () => {
  it('pads rightward, because HS codes extend rightward', () => {
    // The invoice says "HS CODE : 3902.10"; the Bill of Entry says 39021000.
    // Padding on the left would give 00390210, which is not a tariff line.
    expect(pad8('3902.10')).toBe('39021000');
    expect(pad8('390210')).toBe('39021000');
    expect(pad8('3902')).toBe('39020000');
  });

  it('leaves a full 8-digit code alone', () => {
    expect(pad8('39021000')).toBe('39021000');
    expect(pad8('3403.99.00')).toBe('34039900');
  });

  it('refuses codes that are too long to be a tariff line', () => {
    expect(pad8('390210001')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(pad8(undefined)).toBeUndefined();
    expect(pad8('')).toBeUndefined();
    expect(pad8('n/a')).toBeUndefined();
  });
});
