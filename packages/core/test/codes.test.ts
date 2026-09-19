import { describe, expect, it } from 'vitest';
import {
  BE_TYPE_CODE,
  FILING_CODE,
  TOI_CODE,
  TRANSPORT_MODE_CODE,
  iso2,
  normalizePackageUnit,
  normalizeWeightUnit,
  pad8,
  parseContainerSizeType,
  unlocodeOf,
  weightToKg,
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

  it('sees through the formal state names on a certificate of origin', () => {
    // "The People's Republic of China" blocked a real export.
    expect(iso2("The People's Republic of China")).toBe('CN');
    expect(iso2("People's Republic of China")).toBe('CN');
    expect(iso2('Kingdom of Thailand')).toBe('TH');
    expect(iso2('Federal Republic of Germany')).toBe('DE');
    expect(iso2('Socialist Republic of Viet Nam')).toBe('VN');
    expect(iso2('Republic of the Philippines')).toBe('PH');
    expect(iso2('State of Israel')).toBe('IL');
    expect(iso2('United Republic of Tanzania')).toBe('TZ');
    // The ISO comma-inverted form, which some masters print.
    expect(iso2('Indonesia, Republic of')).toBe('ID');
  });

  it('refuses to infer a country whose state form is the whole distinction', () => {
    // Republic of China is Taiwan; the People's Republic is not. Same trap for
    // the two Koreas and the two Congos. Unmapped becomes an export blocker,
    // which is the right outcome — a wrong origin is a misdeclaration.
    expect(iso2('Republic of China')).toBeUndefined();
    expect(iso2('Republic of Korea')).toBe('KR'); // spelled out in the aliases
    expect(iso2("Democratic People's Republic of Korea")).toBe('KP');
    expect(iso2('Republic of the Congo')).toBe('CG');
    expect(iso2('Democratic Republic of the Congo')).toBe('CD');
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
  it('collapses CFR to C&F', () => {
    // The manual attempt wrote CIF here. CIF includes insurance and C&F does
    // not, so the two produce different assessable values. Logi-Sys accepts
    // only FOB / CIF / C&F / C&I, and rejected CFR.
    expect(TOI_CODE['C&F']).toBe('C&F');
    expect(TOI_CODE.CFR).toBe('C&F');
    expect(TOI_CODE.CIF).toBe('CIF');
  });

  it('keeps cost-and-insurance distinct from CIF', () => {
    // C&I carries no freight. Collapsing it to CIF declared freight that the
    // invoice never billed.
    expect(TOI_CODE.CI).toBe('C&I');
  });

  it('has no value for Ex-Works, so the export can refuse', () => {
    // Not one of the four Logi-Sys accepts. mergeDraft normally rewrites EXW to
    // FOB before this point; if one ever reaches the exporter it blocks.
    expect(TOI_CODE.EXW).toBeNull();
  });
});

describe('enumerated header codes', () => {
  it('uses the single letters the Logi-Sys validator asks for', () => {
    // "Expected values are 'A' for Air and 'S' for Sea", and so on. These were
    // the labels its UI shows (SEA/HOME/ADVANCE) until an upload rejected all
    // three.
    expect(TRANSPORT_MODE_CODE.Sea).toBe('S');
    expect(TRANSPORT_MODE_CODE.Air).toBe('A');
    expect(BE_TYPE_CODE['Home Consumption']).toBe('H');
    expect(FILING_CODE.Advance).toBe('A');
    expect(FILING_CODE.Normal).toBe('N');
    expect(FILING_CODE.Prior).toBe('P');
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

describe('weight units', () => {
  it('reads KGM as kilograms', () => {
    // The UN/ECE Recommendation 20 code. An EDI-generated bill of lading prints
    // it and a human never would — ex_job6's B/L says "157,703.000 KGM" — and a
    // unit nobody recognised is how a gross weight went missing.
    expect(normalizeWeightUnit('KGM')).toBe('KGS');
    expect(weightToKg(157703, 'KGM')).toBe(157703);
  });

  it('accepts the spellings documents actually use', () => {
    for (const unit of ['KG', 'KGS', 'Kgs', 'kilograms', 'KILOGRAMME']) {
      expect(normalizeWeightUnit(unit)).toBe('KGS');
    }
  });

  it('reads the IATA single-letter unit off an air waybill', () => {
    // The weight box on ex_job1's waybill reads "101.00 K". K is kilograms and
    // L is pounds; refusing them lost the gross weight on every air job.
    expect(weightToKg(101, 'K')).toBe(101);
    expect(weightToKg(100, 'L')).toBeCloseTo(45.359237, 5);
  });

  it('converts pounds rather than relabelling them', () => {
    // The dangerous one: 1000 LBS taken as kilograms overstates the declared
    // weight by more than double.
    expect(weightToKg(1000, 'LBS')).toBeCloseTo(453.59237, 5);
    expect(weightToKg(1, 'MT')).toBe(1000);
  });

  it('refuses a volume', () => {
    // MTQ is cubic metres and sits in the same column as the weight on some
    // bills of lading. Answering "KGS" for it would declare a measurement as a
    // weight.
    expect(normalizeWeightUnit('MTQ')).toBeUndefined();
    expect(normalizeWeightUnit('CBM')).toBeUndefined();
    expect(weightToKg(270, 'MTQ')).toBeUndefined();
  });

  it('treats an unstated unit as kilograms, and no figure as no weight', () => {
    // Documents that omit the unit are stating kilograms; a figure with an
    // unreadable unit is not a weight at all.
    expect(weightToKg(500, null)).toBe(500);
    expect(weightToKg(500, '')).toBe(500);
    expect(weightToKg(null, 'KGS')).toBeUndefined();
  });
});
