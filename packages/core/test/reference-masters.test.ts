import { describe, expect, it } from 'vitest';
import {
  AIRLINES,
  COUNTRY_ALPHA3,
  CUSTOM_HOUSES,
  DEFAULT_VALUATION_METHOD,
  FOREIGN_PORTS,
  foreignPortByUnlocode,
  iso2,
  lookupAirline,
  lookupCustomHouse,
  lookupForeignPortLoose,
  termsOfPayment,
  unlocodeOf,
  valuationMethod,
} from '../src/masters/index.js';

/**
 * The four reference lists imported from the CHA's own documents, and the
 * lookups over them.
 *
 * These exist because job ce9c889d went out with four header columns empty and
 * two carrying free text where Logi-Sys wanted a coded value, and every one of
 * those was a master that had six hand-typed rows or did not exist at all.
 */
describe('foreign ports', () => {
  it('covers the whole source list, not the two reference jobs', () => {
    // Was 27 hand-typed rows.
    expect(FOREIGN_PORTS.length).toBeGreaterThan(350);
  });

  it('takes the country from the UN/LOCODE rather than the printed name', () => {
    // The source spells this country "Chinese Mainland", which resolves to
    // nothing through iso2(). The code says CN by construction.
    const qingdao = foreignPortByUnlocode('CNTAO');
    expect(qingdao?.countryCode).toBe('CN');
    expect(qingdao?.country).toBe('China');
  });

  it('corrects a misspelling in the source document but still matches it', () => {
    // The PDF prints "Ingdao", filed between Pusan and Qinhuangdao.
    const qingdao = foreignPortByUnlocode('CNTAO');
    expect(qingdao?.name).toBe('Qingdao');
    expect(qingdao?.aliases).toContain('Ingdao');
    expect(lookupForeignPortLoose('Ingdao')?.unlocode).toBe('CNTAO');
  });

  it('keeps the curated airports and aliases the sea-port list has not got', () => {
    // A house air waybill prints "NRT", never "Tokyo".
    expect(lookupForeignPortLoose('NRT')?.unlocode).toBe('JPTYO');
    expect(foreignPortByUnlocode('DEFRA')?.name).toBe('Frankfurt');
  });

  it('resolves a port under either spelling once both lists know it', () => {
    // The source says Pusan; the documents say Busan.
    expect(lookupForeignPortLoose('Busan')?.unlocode).toBe('KRPUS');
    expect(lookupForeignPortLoose('Pusan')?.unlocode).toBe('KRPUS');
  });

  it('reads a UN/LOCODE out of document text', () => {
    expect(unlocodeOf('SHANGHAI, CHINA')).toBe('CNSHA');
    expect(unlocodeOf('Qingdao(CNTAO)')).toBe('CNTAO');
  });

  it('matches on an exact code, never a substring of one', () => {
    expect(foreignPortByUnlocode('CNTA')).toBeUndefined();
    expect(foreignPortByUnlocode('Qingdao')).toBeUndefined();
  });

  it('gives every port a real ISO country', () => {
    for (const port of FOREIGN_PORTS) {
      if (port.countryCode) expect(iso2(port.countryCode)).toBe(port.countryCode);
    }
  });
});

describe('custom houses', () => {
  it('covers the ICEGATE list, not the two stations the reference jobs used', () => {
    expect(CUSTOM_HOUSES.length).toBeGreaterThan(250);
  });

  it('resolves the stations the exporter defaults to', () => {
    expect(lookupCustomHouse('INNSA1')?.name).toBe('Nhava Sheva Sea');
    expect(lookupCustomHouse('INBOM4')?.name).toBe('Sahar Air Cargo');
  });

  it('resolves the legacy EDI code as well as the site code', () => {
    expect(lookupCustomHouse('NSA')?.code).toBe('INNSA1');
  });

  it('refuses an ambiguous partial name rather than picking one', () => {
    // A Bill of Entry filed at the wrong custom house is rejected, so a name
    // that matches several stations is not an answer.
    const partial = CUSTOM_HOUSES.filter((h) => h.name.toLowerCase().includes('sea'));
    expect(partial.length).toBeGreaterThan(1);
    expect(lookupCustomHouse('sea')).toBeUndefined();
  });

  it('reads the mode off the station name', () => {
    expect(lookupCustomHouse('INNSA1')?.mode).toBe('sea');
    expect(lookupCustomHouse('INBOM4')?.mode).toBe('air');
  });
});

describe('airlines', () => {
  it('is keyed by the air waybill prefix', () => {
    expect(AIRLINES.length).toBeGreaterThan(50);
    expect(lookupAirline('020')?.iata).toBe('LH');
  });

  it('reads the prefix off a whole master air waybill number', () => {
    // The prefix is the only carrier identifier a MAWB always carries; the
    // issuing-agent line beside it is free text.
    expect(lookupAirline('020-1234 5675')?.iata).toBe('LH');
    expect(lookupAirline('176-98765432')?.iata).toBe('EK');
  });

  it('resolves by IATA, ICAO and name', () => {
    expect(lookupAirline('EK')?.name).toContain('EMIRATES');
    expect(lookupAirline('UAE')?.iata).toBe('EK');
    expect(lookupAirline('AIR CANADA')?.iata).toBe('AC');
  });

  it('carries the one airline the source lists without an ICAO code', () => {
    const shanghai = AIRLINES.find((a) => a.awbPrefix === '774');
    expect(shanghai?.iata).toBe('FM');
    expect(shanghai?.icao).toBeUndefined();
  });

  it('is undefined rather than a guess', () => {
    expect(lookupAirline('ZZZ')).toBeUndefined();
    expect(lookupAirline('')).toBeUndefined();
  });
});

describe('country alpha-3', () => {
  it('resolves the form certificates of origin actually print', () => {
    // Every one of these used to fall through to undefined, which on
    // GENERAL.CountryOfOriginCode is a blocked export rather than a blank cell.
    expect(iso2('ARE')).toBe('AE');
    expect(iso2('CHN')).toBe('CN');
    expect(iso2('SGP')).toBe('SG');
    expect(iso2('IND')).toBe('IN');
  });

  it('still resolves names and alpha-2 codes', () => {
    expect(iso2('United Arab Emirates')).toBe('AE');
    expect(iso2('JP')).toBe('JP');
  });

  it('maps only to countries the ISO master already knows', () => {
    for (const alpha2 of Object.values(COUNTRY_ALPHA3)) {
      expect(iso2(alpha2)).toBe(alpha2);
    }
  });

  it('is undefined for three letters that are not a country', () => {
    expect(iso2('XXX')).toBeUndefined();
  });
});

describe('valuation method', () => {
  it('spells the rule the way Logi-Sys does', () => {
    // The draft carries "Transaction", which was being written straight
    // through; the accepted workbook says RULE 4.
    expect(valuationMethod('Transaction')).toBe('RULE 4 (TRANSACTION VALUE)');
    expect(DEFAULT_VALUATION_METHOD).toBe('RULE 4 (TRANSACTION VALUE)');
  });

  it('takes a rule string already in the dropdown spelling', () => {
    expect(valuationMethod('RULE 4 (TRANSACTION VALUE)')).toBe('RULE 4 (TRANSACTION VALUE)');
    expect(valuationMethod('rule 7 (deductive value)')).toBe('RULE 7 (DEDUCTIVE VALUE)');
    expect(valuationMethod('OTH (OTHERS)')).toBe('OTH (OTHERS)');
  });

  it('refuses a bare rule number, because the two numberings disagree', () => {
    // Logi-Sys' dropdown is Customs Valuation Rules 2007 — Rule 4 is identical
    // goods, Rule 5 is similar goods — while its own export writes the 1988
    // "RULE 4 (TRANSACTION VALUE)". So "RULE 5" names the transaction value of
    // identical goods under one and of similar goods under the other, and the
    // old regex that mapped rule numbers was silently picking one.
    expect(valuationMethod('RULE 5')).toBeUndefined();
    expect(valuationMethod('RULE 4')).toBeUndefined();
  });

  it('maps the words the documents use', () => {
    expect(valuationMethod('identical')).toBe('RULE 4 (TRANS. VALUE OF IDENTICAL GOODS)');
    expect(valuationMethod('similar goods')).toBe('RULE 5 (TRANS. VALUE OF SIMILAR GOODS)');
    expect(valuationMethod('residual method')).toBe('RULE 9 (RESIDUAL METHOD)');
  });

  it('is undefined for text that is not one of the rules', () => {
    expect(valuationMethod('negotiated')).toBeUndefined();
    expect(valuationMethod(undefined)).toBeUndefined();
  });
});

describe('terms of payment', () => {
  it('codes the instrument the invoice names', () => {
    // The dropdown is LC / FOC / DP / DA / SD / OTHERS. An invoice writes prose
    // — "D/A 45 days from B/L Date" — and the instrument in it is D/A.
    expect(termsOfPayment('D/A 45 days from B/L Date')).toEqual({ code: 'DA', remark: '' });
    expect(termsOfPayment('Irrevocable L/C at sight')).toEqual({ code: 'LC', remark: '' });
    expect(termsOfPayment('CAD')).toEqual({ code: 'DP', remark: '' });
    expect(termsOfPayment('FREE OF COST')).toEqual({ code: 'FOC', remark: '' });
  });

  it('falls back to OTHERS, in both columns, when no instrument is named', () => {
    // The remark exists to qualify OTHERS; Logi-Sys' own export writes the word
    // in both columns, and prints them "OTHERS (OTHERS)".
    expect(termsOfPayment('100% advance TT')).toEqual({ code: 'OTHERS', remark: 'OTHERS' });
    expect(termsOfPayment('NET 30')).toEqual({ code: 'OTHERS', remark: 'OTHERS' });
    expect(termsOfPayment('OTHERS')).toEqual({ code: 'OTHERS', remark: 'OTHERS' });
    expect(termsOfPayment(undefined)).toEqual({ code: 'OTHERS', remark: 'OTHERS' });
  });

  it('leaves the remark blank beside a real code', () => {
    // A remark next to DA would be qualifying a term that already says the
    // thing — the customer's rule for the column.
    expect(termsOfPayment('DA').remark).toBe('');
  });

  it('does not find a code inside an ordinary word', () => {
    expect(termsOfPayment('30 days from B/L date')).toEqual({ code: 'OTHERS', remark: 'OTHERS' });
  });
});
