/**
 * Global + tenant masters, seeded from the two reference jobs.
 * In production these move to Postgres tables (global vs tenant-scoped);
 * the lookup API in masters/index.ts is the stable interface.
 *
 * The four reference lists — foreign ports, Indian custom houses, airlines and
 * ISO alpha-3 country codes — are generated from the source documents in
 * `masters-source/` by `scripts/build-masters.py` and imported below rather
 * than typed out here.
 */

import { GENERATED_AIRLINES } from './generated/airlines.js';
import { GENERATED_CUSTOM_HOUSES } from './generated/custom-houses.js';
import { GENERATED_FOREIGN_PORTS } from './generated/foreign-ports.js';

export interface PortMaster {
  code: string;
  name: string;
  mode: 'sea' | 'air' | 'icd';
}

/**
 * Indian custom houses, the full ICEGATE list.
 *
 * This was six hand-typed rows — the stations the two reference jobs happened
 * to use. Anything filed anywhere else had no code at all, and
 * `GENERAL.CustomsHouseCode` is not a column Logi-Sys will infer.
 *
 * Names come through truncated at 30 characters in places ("Integrated Chennai
 * Business Pa"); that is the ICEGATE export's own limit, not ours, and the code
 * is what the workbook carries.
 */
export const CUSTOM_HOUSES: CustomHouseMaster[] = GENERATED_CUSTOM_HOUSES;

/**
 * @deprecated Use {@link CUSTOM_HOUSES}. Kept as a view over it so the older
 * shape still resolves; `mode` narrows to the three the old list knew.
 */
export const PORTS: PortMaster[] = CUSTOM_HOUSES.filter(
  (h): h is CustomHouseMaster & { mode: 'sea' | 'air' | 'icd' } =>
    h.mode === 'sea' || h.mode === 'air' || h.mode === 'icd',
).map((h) => ({ code: h.code, name: h.name, mode: h.mode }));

/** Airlines, keyed by the air waybill prefix. See {@link AirlineMaster}. */
export const AIRLINES: AirlineMaster[] = GENERATED_AIRLINES;

/** Foreign load ports/airports — ICES wants "Name(UNLOCODE)" and the consignment country. */
export interface ForeignPortMaster {
  name: string;
  unlocode: string;
  /** Display name, for the checklist and the job screen. */
  country: string;
  /**
   * ISO 3166-1 alpha-2, for `GENERAL.CountryOfShipmentCode`.
   *
   * Read off the UN/LOCODE rather than resolved from `country`: a LOCODE is by
   * construction `<alpha-2><locality>`, so `CNTAO` is China by definition,
   * where the name printed beside it in the source list is "Chinese Mainland"
   * and resolves to nothing.
   */
  countryCode?: string;
  aliases?: string[];
}

/**
 * An Indian custom house — the station a Bill of Entry is filed at.
 *
 * `code` is the six-character site code Logi-Sys wants in
 * `GENERAL.CustomsHouseCode` and `SHIPMENT.Port_of_Reporting` (INNSA1 for
 * Nhava Sheva). It does not go in `INVOICES.Custom_House_Code`, which Logi-Sys
 * leaves empty on its own export. `ediCode` is the
 * shorter legacy code ICEGATE also publishes; it is kept because documents and
 * older Logi-Sys screens carry it.
 */
export interface CustomHouseMaster {
  code: string;
  ediCode: string;
  name: string;
  mode?: 'sea' | 'air' | 'icd' | 'land' | 'sez';
  email?: string;
}

/**
 * An airline, keyed by the three-digit IATA accounting prefix that opens every
 * master air waybill number — `020-1234 5675` is Lufthansa.
 *
 * That is the only carrier identifier an AWB always carries, which is what
 * makes it the useful key: the issuing-carrier name on the document is free
 * text and routinely an agent's name rather than the airline's.
 */
export interface AirlineMaster {
  awbPrefix: string;
  iata: string;
  icao?: string;
  name: string;
  country: string;
}

const CURATED_FOREIGN_PORTS: ForeignPortMaster[] = [
  { name: 'Boston', unlocode: 'USBOS', country: 'United States' },
  { name: 'Chicago', unlocode: 'USCHI', country: 'United States', aliases: ["Chicago O'Hare", 'ORD'] },
  { name: 'New York', unlocode: 'USNYC', country: 'United States', aliases: ['JFK'] },
  { name: 'Mombasa', unlocode: 'KEMBA', country: 'Kenya' },
  { name: 'Dar Es Salaam', unlocode: 'TZDAR', country: 'Tanzania' },
  { name: 'Shanghai', unlocode: 'CNSHA', country: 'China' },
  { name: 'Ningbo', unlocode: 'CNNGB', country: 'China' },
  { name: 'Shenzhen', unlocode: 'CNSZX', country: 'China' },
  { name: 'Singapore', unlocode: 'SGSIN', country: 'Singapore' },
  { name: 'Jebel Ali', unlocode: 'AEJEA', country: 'United Arab Emirates' },
  { name: 'Dubai', unlocode: 'AEDXB', country: 'United Arab Emirates' },
  { name: 'Hamburg', unlocode: 'DEHAM', country: 'Germany' },
  { name: 'Frankfurt', unlocode: 'DEFRA', country: 'Germany' },
  { name: 'Rotterdam', unlocode: 'NLRTM', country: 'Netherlands' },
  { name: 'Antwerp', unlocode: 'BEANR', country: 'Belgium' },
  { name: 'Hong Kong', unlocode: 'HKHKG', country: 'Hong Kong' },
  { name: 'Busan', unlocode: 'KRPUS', country: 'South Korea' },
  { name: 'Colombo', unlocode: 'LKCMB', country: 'Sri Lanka' },
  { name: 'Kampala', unlocode: 'UGKLA', country: 'Uganda' },
  { name: 'Yokohama', unlocode: 'JPYOK', country: 'Japan' },
  { name: 'Tokyo', unlocode: 'JPTYO', country: 'Japan', aliases: ['Narita', 'NRT'] },
  { name: 'Nagoya', unlocode: 'JPNGO', country: 'Japan' },
  { name: 'Kobe', unlocode: 'JPUKB', country: 'Japan' },
  { name: 'Osaka', unlocode: 'JPOSA', country: 'Japan', aliases: ['Kansai', 'KIX'] },
  { name: 'Shimizu', unlocode: 'JPSMZ', country: 'Japan' },
  { name: 'Hakata', unlocode: 'JPHKT', country: 'Japan', aliases: ['Fukuoka'] },
  { name: 'Moji', unlocode: 'JPMOJ', country: 'Japan' },
];

/**
 * Foreign load ports and airports.
 *
 * The curated rows win over the generated ones. Two reasons they have to: the
 * source list is a sea-port list, so it has no airports and none of the
 * three-letter IATA aliases a house air waybill actually prints ("NRT", "JFK");
 * and where both know a port they may name it differently — the source says
 * Pusan, the documents say Busan. Aliases from both sides are kept, so either
 * spelling resolves.
 */
export const FOREIGN_PORTS: ForeignPortMaster[] = (() => {
  const byCode = new Map<string, ForeignPortMaster>();

  for (const port of GENERATED_FOREIGN_PORTS) byCode.set(port.unlocode, port);

  for (const port of CURATED_FOREIGN_PORTS) {
    const generated = byCode.get(port.unlocode);
    if (!generated) {
      byCode.set(port.unlocode, port);
      continue;
    }
    const aliases = new Set([...(port.aliases ?? []), ...(generated.aliases ?? [])]);
    // The generated name is a second way to say the same place once the
    // curated name has replaced it.
    if (generated.name.toLowerCase() !== port.name.toLowerCase()) aliases.add(generated.name);
    const merged: ForeignPortMaster = { ...generated, ...port };
    if (aliases.size) merged.aliases = [...aliases];
    else delete merged.aliases;
    byCode.set(port.unlocode, merged);
  }

  return [...byCode.values()].sort((a, b) => a.unlocode.localeCompare(b.unlocode));
})();

/**
 * ICES-standard UQC normalization: packaging units seen on invoices map to
 * the unit codes customs accepts. Unknown packaging units default to NOS.
 */
export const UQC_NORMALIZATION: Record<string, string> = {
  PAIL: 'NOS', PAILS: 'NOS', CASE: 'NOS', CASES: 'NOS', DRUM: 'NOS', DRUMS: 'NOS',
  CARTON: 'NOS', CARTONS: 'NOS', CTN: 'NOS', CTNS: 'NOS', BOX: 'NOS', BOXES: 'NOS',
  PC: 'NOS', PCS: 'NOS', PIECE: 'NOS', PIECES: 'NOS', EA: 'NOS', EACH: 'NOS',
  UNIT: 'NOS', UNITS: 'NOS', SET: 'SET', SETS: 'SET', PAIR: 'PRS', PAIRS: 'PRS',
  BAG: 'BGS', BAGS: 'BGS', ROLL: 'ROL', ROLLS: 'ROL',
  KG: 'KGS', KGS: 'KGS', LB: 'KGS', LBS: 'KGS', MT: 'KGS', MTS: 'KGS', MTON: 'KGS',
  MTONS: 'KGS', TON: 'KGS', TONS: 'KGS', TONNE: 'KGS', TONNES: 'KGS',
  LTR: 'LTR', L: 'LTR', LITRE: 'LTR', LITRES: 'LTR', M: 'MTR', MTR: 'MTR', MTRS: 'MTR',
  SQM: 'SQM', M2: 'SQM', M3: 'CBM', CBM: 'CBM', NOS: 'NOS', NO: 'NOS',
};

export const VALID_UQC = new Set(['NOS', 'KGS', 'GMS', 'LTR', 'MTR', 'SQM', 'CBM', 'SET', 'PRS', 'BGS', 'ROL', 'TON', 'MTS']);

export interface TariffMaster {
  /** 8-digit CTH/RITC */
  cth: string;
  description: string;
  bcdRate: number;
  unit: string;
  igstRate: number;
  igstNotification: string;
  aidcRate: number;
  aidcNotification: string;
  compCessRate: number;
  compCessNotification: string;
  /** chapter-level flags for Single Window / PGA requirements */
  pga?: 'FSSAI' | 'CDSCO' | 'PQ' | 'AQ';
}

export const TARIFF: TariffMaster[] = [
  {
    cth: '34039900',
    description: 'Lubricating preparations — other',
    bcdRate: 7.5,
    unit: 'KGS',
    igstRate: 18,
    igstNotification: '009/2025',
    aidcRate: 0,
    aidcNotification: '011/2021',
    compCessRate: 0,
    compCessNotification: '001/2017',
  },
  {
    cth: '17021110',
    description: 'Lactose, containing >=99% lactose by weight',
    bcdRate: 25,
    unit: 'KGS',
    igstRate: 5,
    igstNotification: '009/2025',
    aidcRate: 0,
    aidcNotification: '011/2021',
    compCessRate: 0,
    compCessNotification: '001/2017',
    pga: 'FSSAI',
  },
  {
    // Seeded from job I-13844/26-27. Standard BCD is 7.5%; that job paid 0%
    // because it claimed India-Japan CEPA, which is an exemption on top of
    // this row rather than a different rate.
    cth: '39021000',
    description: 'Polypropylene, in primary forms',
    bcdRate: 7.5,
    unit: 'KGS',
    igstRate: 18,
    igstNotification: '009/2025',
    aidcRate: 0,
    aidcNotification: '011/2021',
    compCessRate: 0,
    compCessNotification: '001/2017',
  },
];

export interface FtaSchemeMaster {
  scheme: string;
  /** Matching hints found on COO headings. */
  cooHeadingPattern: string;
  notification: string;
  serial: string;
  bcdExemptionPercent: number;
  /** ISO-ish country names this scheme covers (subset seeded). */
  countries: string[];
  /** COO-form origin-criterion letter -> ICES criterion code (e.g. DFTP "A" -> COWO). */
  criterionMap?: Record<string, string>;
}

export const FTA_SCHEMES: FtaSchemeMaster[] = [
  {
    scheme: 'DFTP',
    cooHeadingPattern: 'Duty Free Tariff Preference',
    notification: '096/2008',
    serial: '(i)',
    bcdExemptionPercent: 100,
    countries: ['Uganda', 'Tanzania', 'Ethiopia', 'Rwanda', 'Malawi', 'Mozambique', 'Zambia', 'Benin'],
    criterionMap: { A: 'COWO', B: 'PSR' },
  },
  {
    // India-Japan CEPA. Notification/serial transcribed from the Logi-Sys
    // checklist for job I-13844/26-27, where it carried BCD to 0% on 39021000.
    scheme: 'India-Japan CEPA',
    cooHeadingPattern: 'Comprehensive Economic Partnership Agreement',
    notification: '069/2011',
    serial: '295',
    bcdExemptionPercent: 100,
    countries: ['Japan'],
    criterionMap: { A: 'COWO', B: 'CTH', C: 'PSR', CTH: 'CTH', WO: 'COWO', PSR: 'PSR' },
  },
];

export interface DeclarationMaster {
  code: string;
  text: string;
  /** When the code applies. */
  rule: 'always' | 'invoice' | 'fta' | 'chemical-no-cas' | 'food' | 'manual';
}

export const DECLARATIONS: DeclarationMaster[] = [
  {
    code: 'CUG00',
    rule: 'always',
    text: 'I/We declare that the contents of this Bill of Entry for goods imported against above mentioned Bill of Lading/ Airway Bill /Lorry Receipt/Railway Receipt numbers are in accordance with the above mentioned invoice(s) No(s)and other documents presented herewith.',
  },
  {
    code: 'CUG01',
    rule: 'always',
    text: 'I/We declare that the contents of the above mentioned invoice(s) and documents are true and correct in every respect.I/We have not received and do not know of any other documents or information showing a different description, quantity, price, value, of the said goods and that if at any time hereafter I/We discover any document / information showing different facts, I/We will immediately make the same known to the Commissioner of Customs.',
  },
  {
    code: 'CUV01',
    rule: 'invoice',
    text: 'I/We declare that all conditions or restrictions, if any, imposed by the seller of any third party on the disposition or use of the imported goods [as per proviso to Rule 3(2)) of the Customs Valuation Rules, 2007] are specified above.',
  },
  {
    code: 'CUV02',
    rule: 'invoice',
    text: 'I/We declare that the price paid or payable by the importer is as per the details provided above, and any price paid or payable in addition to the above will be settled with the seller at the end of a defined period by means of debit note / credit note (post – import price adjustment), which are as per the contract attached as a supporting document.',
  },
  {
    code: 'CUV03',
    rule: 'invoice',
    text: 'I/We declare that there are no payments actually paid or payable for the imported goods by way of cost and services [in terms of Rules 10(1)(a)(i), Rule 10(1)(a)(ii), Rule 10 (1) (a) (iii) and Rule 10 (1) (b) of Customs Valuation Rules, 2007], Royalty / Licence Fee / subsequent resale or use of goods /other payment as a condition of sale [(Please see Rule 10 (1) (c), (d) & (e) of Customs Valuation Rules, 2007] other than those declared in the invoice which are mentioned as miscellaneous charges in this Bill of Entry.',
  },
  {
    code: 'PC002',
    rule: 'chemical-no-cas',
    text: 'I certify that the information related to IUPAC & CAS number is not in my possession as the same is not provided by my supplier due to confidentiality',
  },
  {
    code: 'CUF02',
    rule: 'fta',
    text: 'I/We declare that these goods qualify as originating goods for preferential rate of duty under the Customs (Administration of Rules of Origin under Trade Agreements) Rules, 2020 notified vide Customs Notification No. 81/2020 - Customs (N.T.) dated 21.08.2020.',
  },
  {
    code: 'DC007',
    rule: 'food',
    text: 'I/We the importer of this consignment undertake that the drug/cosmetic packages seal for this item is intact, the packaging is not damaged/broken/destroyed and the content of drug/cosmetic has not deteriorated.',
  },
];

export interface ExchangeRateMaster {
  effectiveFrom: string; // ISO date
  rates: { [currency: string]: number };
}

/** CBIC customs exchange rates (ERAM). Refreshed fortnightly — Phase 2 automates this. */
export const EXCHANGE_RATES: ExchangeRateMaster[] = [
  {
    effectiveFrom: '2026-06-01',
    rates: { USD: 95.3, EUR: 103.15, GBP: 121.4, JPY: 0.6412, CNY: 13.25, AED: 26.1, SGD: 71.2, CHF: 105.9 },
  },
];

export interface ImporterMaster {
  name: string;
  /** Names as they appear on shipping docs, for matching. */
  aliases: string[];
  iec: string;
  pan: string;
  gstin: string;
  gstStateCode: string;
  gstStateName: string;
  adCode: string;
  branchSno: string;
  address: string[];
  city: string;
  state: string;
  /**
   * Importer's marine open-policy insurance rate (% of C&F value), applied
   * when TOI is not CIF and no actual insurance figure is provided.
   */
  marineOpenPolicyRatePercent?: number;
  /** Default end-use code: GNX100 trading, GNX200 manufacture/actual use. */
  defaultEndUseCode?: string;
}

/**
 * Retired. The importer master is now `public.organizations` — the
 * Organization Repository each company exports out of Logi-Sys and uploads,
 * resolved by apps/web/lib/parties.ts. Party names have to be the exact
 * strings Logi-Sys holds, and a list in this file could never be that for more
 * than one tenant.
 *
 * The type and the overlay store stay for `/legacy`, the retired
 * single-tenant generator, which still reads them. The seed is empty: nothing
 * in the tenant app consults it.
 */
export const IMPORTERS: ImporterMaster[] = [];

/** End-use codes printed in the BE End Use Information table. */
export const END_USE_CODES: Record<string, string> = {
  GNX100: 'Generic -For Consumer use under commercial distribution (for Trading - wholesale or retail)',
  GNX200: 'Generic -For Commercial Assembly or processing (For Manufacture/Actual use)',
};

/** eSanchit document-type codes for the supporting-documents table. */
export const ESANCHIT_DOC_CODES: Record<string, { code: string; name: string }> = {
  invoice: { code: '380000', name: 'Commercial Invoice' },
  bill_of_lading: { code: '705000', name: 'Bill of Lading' },
  air_waybill: { code: '740000', name: 'Air Waybill' },
  packing_list: { code: '271000', name: 'Packing List' },
  certificate_of_origin: { code: '861013', name: 'Certificate of Origin (preferential)' },
  certificate_of_analysis: { code: '001000', name: 'Certificate of Analysis' },
  other: { code: '', name: 'Other' },
};

/** Single Window additional-product-information rules by tariff chapter. */
export interface SingleWindowRule {
  chapters: [number, number];
  pga: string;
  infoRows: { infoType: string; qualifier: string; code?: string }[];
  /** documents customs/PGA expects for these chapters */
  expectedDocs: string[];
}

export const SINGLE_WINDOW_RULES: SingleWindowRule[] = [
  {
    chapters: [2, 22],
    pga: 'FSSAI',
    infoRows: [
      { infoType: 'Item Characteristics', qualifier: 'Storage Condition', code: 'STCNR' },
      { infoType: 'Item Category', qualifier: 'Drug Related Category', code: 'MSC' },
      { infoType: 'Item Category', qualifier: 'Foods & Supplement Proprietry Status', code: 'FC0102' },
      { infoType: 'Item Identification', qualifier: 'Retail Pre-pack Food Article', code: 'RFAN' },
    ],
    expectedDocs: ['FSSAI licence', 'test report'],
  },
];

export interface ChaProfile {
  tenantId: string;
  name: string;
  licence: string;
  icegateId: string;
  address: string[];
}

export const CHA_PROFILE: ChaProfile = {
  tenantId: 'kuberr',
  name: 'KUBERR INDIA EXIM LLP',
  licence: 'AAPFK6460KCH001',
  icegateId: 'KUBERR007',
  address: [
    '302, K. P. Aurum, K.P. Engineering Compound,',
    'Marol Maroshi Rd, Marol, Andheri East,',
    'Mumbai, Maharashtra 400059',
  ],
};
