import { describe, expect, it } from 'vitest';
import {
  BE_TYPE_CODE,
  TRANSPORT_MODE_CODE,
  filingStatusFrom,
  isUnderSec46,
  isUnderSec48,
  lookupCustomHouse,
  resolveIndianStation,
  stationKind,
  transportModeForStation,
} from '../src/index.js';

/**
 * The GENERAL sheet's rules, as `docs/boe-mapping/01-general.md` states them.
 *
 * Every one of these columns used to be a constant in code, so each test here
 * guards a value that previously could not be wrong because it was never
 * computed.
 */

describe('station kind, from the ICES code suffix', () => {
  it('classifies the five suffixes', () => {
    expect(stationKind('INNSA1')).toBe('sea');
    expect(stationKind('INBOM4')).toBe('air');
    expect(stationKind('INTKD6')).toBe('inland');
    expect(stationKind('INASR2')).toBe('inland');
    expect(stationKind('INATQB')).toBe('inland');
  });

  it('beats the name for the stations whose names lie', () => {
    // "Gangavaram ICD" is a sea station; the name pattern that generated the
    // master's `mode` says icd.
    expect(stationKind('INGGV1')).toBe('sea');
    // "Pipavav (Victor) Port" is the inland one of the two Pipavavs.
    expect(stationKind('INPAV6')).toBe('inland');
    expect(stationKind('INPAV1')).toBe('sea');
  });

  it('classifies the stations the master could not name-match at all', () => {
    // 65 rows carry no `mode`; every suffix-6 one of them is inland.
    expect(stationKind('ININD6')).toBe('inland'); // Pithampur
    expect(stationKind('INJUC6')).toBe('inland'); // Jalandhar
    expect(stationKind('INGNC6')).toBe('inland'); // GIFT CITY
  });
});

describe('TransportModeCode', () => {
  it('is L for an inland station, S for a sea port, A for air cargo', () => {
    expect(transportModeForStation('INTKD6')).toBe('L');
    expect(transportModeForStation('INNSA1')).toBe('S');
    expect(transportModeForStation('INBOM4')).toBe('A');
  });

  it('has an L in its code domain at all', () => {
    // The whole reason an ICD job could not be expressed: this map had two keys.
    expect(TRANSPORT_MODE_CODE.Land).toBe('L');
    expect(TRANSPORT_MODE_CODE.Sea).toBe('S');
    expect(TRANSPORT_MODE_CODE.Air).toBe('A');
  });
});

describe('resolving a bill of lading place of delivery', () => {
  it('matches an ICES code as typed', () => {
    expect(resolveIndianStation('INNSA1')?.code).toBe('INNSA1');
    expect(resolveIndianStation('NSA')?.code).toBe('INNSA1');
  });

  it('matches the aliases a bill of lading actually prints', () => {
    expect(resolveIndianStation('NHAVA SHEVA')?.code).toBe('INNSA1');
    expect(resolveIndianStation('JNPT, INDIA')?.code).toBe('INNSA1');
    expect(resolveIndianStation('Nhava Sheva (JNPT), Maharashtra')?.code).toBe('INNSA1');
  });

  it('matches across the ICD/CFS noise and the spelling of Tughlakabad', () => {
    // The master spells it "Tuglakabad ICD"; a bill of lading types
    // "ICD TUGHLAKABAD". Vowel-insensitive matching is what bridges that.
    expect(resolveIndianStation('ICD TUGHLAKABAD')?.code).toBe('INTKD6');
    expect(resolveIndianStation('Tuglakabad ICD')?.code).toBe('INTKD6');
    expect(resolveIndianStation('ICD Dadri')?.code).toBe('INDER6');
    expect(resolveIndianStation('Patparganj')?.code).toBe('INPPG6');
  });

  it('answers nothing rather than guessing', () => {
    expect(resolveIndianStation('')).toBeUndefined();
    expect(resolveIndianStation(null)).toBeUndefined();
    expect(resolveIndianStation('SOMEWHERE NOBODY FILES')).toBeUndefined();
  });

  it('refuses the places that have both a sea station and an ICD', () => {
    // These are the dangerous ones, and there are seventeen of them. Mundra,
    // Cochin and Tuticorin each name a sea port AND an inland container depot,
    // so the place alone decides S or L — and getting that wrong files the Bill
    // of Entry at the wrong custom house, which is rejected outright.
    //
    // Undefined here is the resolver working: the job screen asks.
    expect(resolveIndianStation('MUNDRA')).toBeUndefined();
    expect(resolveIndianStation('COCHIN')).toBeUndefined();
    expect(resolveIndianStation('TUTICORIN')).toBeUndefined();
    expect(resolveIndianStation('CHENNAI')).toBeUndefined();

    // Qualified, they resolve — and to opposite transport modes.
    expect(transportModeForStation(resolveIndianStation('Mundra Sea')!)).toBe('S');
    expect(transportModeForStation(resolveIndianStation('Cochin ICD')!)).toBe('L');
    expect(transportModeForStation(resolveIndianStation('Chennai Air Cargo')!)).toBe('A');
  });

  it('lets the document that printed the place break the tie', () => {
    // "KOLKATA" names a sea port, an air cargo complex and an ICD, so the word
    // alone cannot say which — and ex_job13's bill of lading prints exactly
    // that, which left the job with no custom house at all. What the *document*
    // is settles it: a port of discharge on a B/L is a sea station, an airport
    // of destination on an air waybill is an air one.
    expect(resolveIndianStation('KOLKATA')).toBeUndefined();
    expect(resolveIndianStation('KOLKATA', 'sea')?.code).toBe('INCCU1');
    expect(transportModeForStation(resolveIndianStation('KOLKATA', 'air')!)).toBe('A');

    // It only breaks ties. A place that already resolves ignores it, and one
    // that is still ambiguous with it stays unresolved.
    expect(resolveIndianStation('NHAVA SHEVA', 'air')?.code).toBe('INNSA1');
    expect(resolveIndianStation('SOMEWHERE NOBODY FILES', 'sea')).toBeUndefined();
  });

  it('resolves a custom house named in prose to its code', () => {
    // What the mail-instruction path does with "file at Nhava Sheva".
    expect(resolveIndianStation('Nhava Sheva')?.code).toBe(lookupCustomHouse('INNSA1')?.code);
  });
});

describe('BETypeCode', () => {
  it('can express warehousing and ex-bond, not just home consumption', () => {
    expect(BE_TYPE_CODE['Home Consumption']).toBe('H');
    expect(BE_TYPE_CODE.Warehousing).toBe('W');
    expect(BE_TYPE_CODE['Ex-Bond']).toBe('EX');
  });
});

describe('AdvancePriorNormal', () => {
  it('is Advance when no IGM has been filed against the BL', () => {
    expect(filingStatusFrom({ igmChecked: true })).toBe('Advance');
  });

  it('is Prior when the IGM is filed but entry inwards is not granted', () => {
    expect(filingStatusFrom({ igmNo: '2381234', igmChecked: true })).toBe('Prior');
  });

  it('is Normal once entry inwards is granted', () => {
    expect(
      filingStatusFrom({ igmNo: '2381234', inwardDate: '2026-09-01', igmChecked: true }),
    ).toBe('Normal');
  });

  it('refuses to answer when nobody has checked for an IGM', () => {
    // The distinction the old `Air ? Prior : Normal` could not make: an absent
    // IGM number means "Advance" only if someone actually looked.
    expect(filingStatusFrom({})).toBeUndefined();
    expect(filingStatusFrom({ igmChecked: false })).toBeUndefined();
  });
});

describe('Sections 46 and 48', () => {
  const inward = '2026-09-01';

  it('flags a BE presented after entry inwards under Section 46', () => {
    expect(isUnderSec46({ inwardDate: inward, beFilingDate: '2026-09-02' })).toBe(true);
  });

  it('does not flag one presented on or before the inward date', () => {
    expect(isUnderSec46({ inwardDate: inward, beFilingDate: inward })).toBe(false);
    expect(isUnderSec46({ inwardDate: inward, beFilingDate: '2026-08-28' })).toBe(false);
  });

  it('flags Section 48 only past thirty days', () => {
    expect(isUnderSec48({ inwardDate: inward, beFilingDate: '2026-10-01' })).toBe(false); // day 30
    expect(isUnderSec48({ inwardDate: inward, beFilingDate: '2026-10-02' })).toBe(true); // day 31
  });

  it('is undefined, not false, when either date is missing', () => {
    // Blank on the sheet either way, but "we do not know" is what makes the job
    // screen ask for the filing date instead of quietly asserting compliance.
    expect(isUnderSec46({ inwardDate: inward })).toBeUndefined();
    expect(isUnderSec46({ beFilingDate: '2026-09-02' })).toBeUndefined();
    expect(isUnderSec48({})).toBeUndefined();
  });
});
