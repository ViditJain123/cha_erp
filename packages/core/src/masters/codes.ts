/**
 * Code normalisers for the Logi-Sys import spreadsheet.
 *
 * The template asks for *codes* in a dozen places where our documents and our
 * drafts carry *names* — `CountryOfOriginCode`, `PortOfShipmentCode`,
 * `ContainerTypeCode`, `PkgUnitCode`, `TOI`. Keying those by hand is what
 * produced `JAPAN` instead of `JP` and `YOKOHAMA` instead of `JPYOK` on the
 * first manual attempt.
 *
 * These live in @checklist/core rather than in the exporter because merge.ts
 * and checklist-html.ts need the same answers.
 *
 * ## A standing caveat on the code domains
 *
 * The vendor template does not declare its own allowed values: no sheet has a
 * `<dataValidation>` element, and the defined names that once fed its dropdowns
 * point at external workbooks that are not in the distributed file. So the
 * tables marked CONFIRM below are inferred — from the Logi-Sys UI dropdowns
 * captured in `logi-sys-screenshots/` and from the checklist Logi-Sys printed
 * for job I-13844/26-27 — and are only settled by a successful upload.
 *
 * Each is a single lookup table on purpose: when the round trip says otherwise,
 * one edit fixes every call site.
 */

import type { TermsOfInvoice } from '../types.js';
import { FOREIGN_PORTS, type ForeignPortMaster } from './data.js';

/* ------------------------------------------------------------------ *
 * Countries
 * ------------------------------------------------------------------ */

/**
 * ISO 3166-1 alpha-2. There was no country master at all before this: the only
 * country data was `ForeignPortMaster.country`, which holds a display name
 * ("Japan"), so no code could be emitted for any of the three country columns.
 */
export const COUNTRIES: Record<string, string> = {
  AF: 'Afghanistan', AX: 'Åland Islands', AL: 'Albania', DZ: 'Algeria',
  AS: 'American Samoa', AD: 'Andorra', AO: 'Angola', AI: 'Anguilla',
  AQ: 'Antarctica', AG: 'Antigua and Barbuda', AR: 'Argentina', AM: 'Armenia',
  AW: 'Aruba', AU: 'Australia', AT: 'Austria', AZ: 'Azerbaijan',
  BS: 'Bahamas', BH: 'Bahrain', BD: 'Bangladesh', BB: 'Barbados',
  BY: 'Belarus', BE: 'Belgium', BZ: 'Belize', BJ: 'Benin', BM: 'Bermuda',
  BT: 'Bhutan', BO: 'Bolivia', BQ: 'Bonaire', BA: 'Bosnia and Herzegovina',
  BW: 'Botswana', BV: 'Bouvet Island', BR: 'Brazil',
  IO: 'British Indian Ocean Territory', BN: 'Brunei Darussalam',
  BG: 'Bulgaria', BF: 'Burkina Faso', BI: 'Burundi', CV: 'Cabo Verde',
  KH: 'Cambodia', CM: 'Cameroon', CA: 'Canada', KY: 'Cayman Islands',
  CF: 'Central African Republic', TD: 'Chad', CL: 'Chile', CN: 'China',
  CX: 'Christmas Island', CC: 'Cocos Islands', CO: 'Colombia', KM: 'Comoros',
  CG: 'Congo', CD: 'Congo, Democratic Republic of the', CK: 'Cook Islands',
  CR: 'Costa Rica', CI: "Côte d'Ivoire", HR: 'Croatia', CU: 'Cuba',
  CW: 'Curaçao', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', DJ: 'Djibouti',
  DM: 'Dominica', DO: 'Dominican Republic', EC: 'Ecuador', EG: 'Egypt',
  SV: 'El Salvador', GQ: 'Equatorial Guinea', ER: 'Eritrea', EE: 'Estonia',
  SZ: 'Eswatini', ET: 'Ethiopia', FK: 'Falkland Islands', FO: 'Faroe Islands',
  FJ: 'Fiji', FI: 'Finland', FR: 'France', GF: 'French Guiana',
  PF: 'French Polynesia', TF: 'French Southern Territories', GA: 'Gabon',
  GM: 'Gambia', GE: 'Georgia', DE: 'Germany', GH: 'Ghana', GI: 'Gibraltar',
  GR: 'Greece', GL: 'Greenland', GD: 'Grenada', GP: 'Guadeloupe', GU: 'Guam',
  GT: 'Guatemala', GG: 'Guernsey', GN: 'Guinea', GW: 'Guinea-Bissau',
  GY: 'Guyana', HT: 'Haiti', HM: 'Heard Island and McDonald Islands',
  VA: 'Holy See', HN: 'Honduras', HK: 'Hong Kong', HU: 'Hungary',
  IS: 'Iceland', IN: 'India', ID: 'Indonesia', IR: 'Iran', IQ: 'Iraq',
  IE: 'Ireland', IM: 'Isle of Man', IL: 'Israel', IT: 'Italy',
  JM: 'Jamaica', JP: 'Japan', JE: 'Jersey', JO: 'Jordan', KZ: 'Kazakhstan',
  KE: 'Kenya', KI: 'Kiribati', KP: 'North Korea', KR: 'South Korea',
  KW: 'Kuwait', KG: 'Kyrgyzstan', LA: 'Laos', LV: 'Latvia', LB: 'Lebanon',
  LS: 'Lesotho', LR: 'Liberia', LY: 'Libya', LI: 'Liechtenstein',
  LT: 'Lithuania', LU: 'Luxembourg', MO: 'Macao', MG: 'Madagascar',
  MW: 'Malawi', MY: 'Malaysia', MV: 'Maldives', ML: 'Mali', MT: 'Malta',
  MH: 'Marshall Islands', MQ: 'Martinique', MR: 'Mauritania',
  MU: 'Mauritius', YT: 'Mayotte', MX: 'Mexico', FM: 'Micronesia',
  MD: 'Moldova', MC: 'Monaco', MN: 'Mongolia', ME: 'Montenegro',
  MS: 'Montserrat', MA: 'Morocco', MZ: 'Mozambique', MM: 'Myanmar',
  NA: 'Namibia', NR: 'Nauru', NP: 'Nepal', NL: 'Netherlands',
  NC: 'New Caledonia', NZ: 'New Zealand', NI: 'Nicaragua', NE: 'Niger',
  NG: 'Nigeria', NU: 'Niue', NF: 'Norfolk Island', MK: 'North Macedonia',
  MP: 'Northern Mariana Islands', NO: 'Norway', OM: 'Oman', PK: 'Pakistan',
  PW: 'Palau', PS: 'Palestine', PA: 'Panama', PG: 'Papua New Guinea',
  PY: 'Paraguay', PE: 'Peru', PH: 'Philippines', PN: 'Pitcairn',
  PL: 'Poland', PT: 'Portugal', PR: 'Puerto Rico', QA: 'Qatar',
  RE: 'Réunion', RO: 'Romania', RU: 'Russia', RW: 'Rwanda',
  BL: 'Saint Barthélemy', SH: 'Saint Helena', KN: 'Saint Kitts and Nevis',
  LC: 'Saint Lucia', MF: 'Saint Martin', PM: 'Saint Pierre and Miquelon',
  VC: 'Saint Vincent and the Grenadines', WS: 'Samoa', SM: 'San Marino',
  ST: 'Sao Tome and Principe', SA: 'Saudi Arabia', SN: 'Senegal',
  RS: 'Serbia', SC: 'Seychelles', SL: 'Sierra Leone', SG: 'Singapore',
  SX: 'Sint Maarten', SK: 'Slovakia', SI: 'Slovenia', SB: 'Solomon Islands',
  SO: 'Somalia', ZA: 'South Africa',
  GS: 'South Georgia and the South Sandwich Islands', SS: 'South Sudan',
  ES: 'Spain', LK: 'Sri Lanka', SD: 'Sudan', SR: 'Suriname',
  SJ: 'Svalbard and Jan Mayen', SE: 'Sweden', CH: 'Switzerland',
  SY: 'Syria', TW: 'Taiwan', TJ: 'Tajikistan', TZ: 'Tanzania',
  TH: 'Thailand', TL: 'Timor-Leste', TG: 'Togo', TK: 'Tokelau',
  TO: 'Tonga', TT: 'Trinidad and Tobago', TN: 'Tunisia', TR: 'Türkiye',
  TM: 'Turkmenistan', TC: 'Turks and Caicos Islands', TV: 'Tuvalu',
  UG: 'Uganda', UA: 'Ukraine', AE: 'United Arab Emirates',
  GB: 'United Kingdom', US: 'United States',
  UM: 'United States Minor Outlying Islands', UY: 'Uruguay',
  UZ: 'Uzbekistan', VU: 'Vanuatu', VE: 'Venezuela', VN: 'Vietnam',
  VG: 'Virgin Islands, British', VI: 'Virgin Islands, U.S.',
  WF: 'Wallis and Futuna', EH: 'Western Sahara', YE: 'Yemen',
  ZM: 'Zambia', ZW: 'Zimbabwe',
};

/** Names our documents actually use that are not the ISO short name. */
const COUNTRY_ALIASES: Record<string, string> = {
  'USA': 'US', 'U.S.A.': 'US', 'U.S.': 'US', 'UNITED STATES OF AMERICA': 'US',
  'AMERICA': 'US', 'UK': 'GB', 'U.K.': 'GB', 'GREAT BRITAIN': 'GB',
  'ENGLAND': 'GB', 'SCOTLAND': 'GB', 'WALES': 'GB',
  'UAE': 'AE', 'U.A.E.': 'AE', 'EMIRATES': 'AE',
  'KOREA': 'KR', 'KOREA, REPUBLIC OF': 'KR', 'REPUBLIC OF KOREA': 'KR',
  'SOUTH KOREA': 'KR', 'KOREA SOUTH': 'KR',
  "KOREA, DEMOCRATIC PEOPLE'S REPUBLIC OF": 'KP', 'NORTH KOREA': 'KP',
  'RUSSIAN FEDERATION': 'RU', 'CZECH REPUBLIC': 'CZ', 'SLOVAK REPUBLIC': 'SK',
  'TURKEY': 'TR', 'TURKIYE': 'TR', 'HOLLAND': 'NL', 'THE NETHERLANDS': 'NL',
  'IVORY COAST': 'CI', 'COTE DIVOIRE': 'CI', "COTE D'IVOIRE": 'CI',
  'BURMA': 'MM', 'SWAZILAND': 'SZ', 'MACEDONIA': 'MK', 'CAPE VERDE': 'CV',
  'EAST TIMOR': 'TL', 'VATICAN': 'VA', 'VATICAN CITY': 'VA',
  'HONG KONG SAR': 'HK', 'MACAU': 'MO', 'MACAO SAR': 'MO',
  'CHINESE TAIPEI': 'TW', 'TAIWAN, PROVINCE OF CHINA': 'TW',
  'IRAN, ISLAMIC REPUBLIC OF': 'IR', 'SYRIAN ARAB REPUBLIC': 'SY',
  'LAO PEOPLE’S DEMOCRATIC REPUBLIC': 'LA', 'VIET NAM': 'VN',
  'TANZANIA, UNITED REPUBLIC OF': 'TZ', 'BOLIVIA, PLURINATIONAL STATE OF': 'BO',
  'VENEZUELA, BOLIVARIAN REPUBLIC OF': 'VE', 'MOLDOVA, REPUBLIC OF': 'MD',
  'BRUNEI': 'BN', 'CONGO, THE DEMOCRATIC REPUBLIC OF THE': 'CD', 'DRC': 'CD',
  // The two Congos and the two Chinas are never inferred from a stem (see
  // AMBIGUOUS_STEMS), so every form we accept for them is spelled out here.
  'DEMOCRATIC REPUBLIC OF THE CONGO': 'CD', 'DEMOCRATIC REPUBLIC OF CONGO': 'CD',
  'CONGO KINSHASA': 'CD', 'REPUBLIC OF THE CONGO': 'CG', 'CONGO BRAZZAVILLE': 'CG',
  "PEOPLE'S REPUBLIC OF CHINA": 'CN', "CHINA, PEOPLE'S REPUBLIC OF": 'CN',
  'PRC': 'CN', 'P.R. CHINA': 'CN', 'PR CHINA': 'CN', 'MAINLAND CHINA': 'CN',
  "DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA": 'KP',
};

/**
 * State forms a document may wrap a country's short name in.
 *
 * Certificates of origin and commercial invoices tend to print the full formal
 * name — "The People's Republic of China", "Kingdom of Thailand", "Federative
 * Republic of Brazil" — where the master holds the short one. Written as
 * normalised keys (apostrophes are already spaces by then), longest first so
 * "People's Republic of" is tried before "Republic of".
 */
const STATE_FORMS = [
  'DEMOCRATIC PEOPLE S REPUBLIC OF',
  'PEOPLE S DEMOCRATIC REPUBLIC OF',
  'CO OPERATIVE REPUBLIC OF',
  'BOLIVARIAN REPUBLIC OF',
  'PLURINATIONAL STATE OF',
  'FEDERATIVE REPUBLIC OF',
  'SOCIALIST REPUBLIC OF',
  'ISLAMIC REPUBLIC OF',
  'FEDERAL REPUBLIC OF',
  'PEOPLE S REPUBLIC OF',
  'ORIENTAL REPUBLIC OF',
  'UNITED REPUBLIC OF',
  'ARAB REPUBLIC OF',
  'GRAND DUCHY OF',
  'COMMONWEALTH OF',
  'PRINCIPALITY OF',
  'SULTANATE OF',
  'REPUBLIC OF',
  'KINGDOM OF',
  'STATE OF',
  'UNION OF',
];

/**
 * Stems where the state form *is* the distinction, so stripping it would name a
 * different country: Republic of China is Taiwan and the People's Republic is
 * not; Republic of Korea and the Democratic People's Republic are two states;
 * the Congos differ only by "Democratic". These fall through to the alias list
 * above, and anything it does not cover ends up unmapped — which the exporter
 * turns into a blocker rather than a guess.
 */
const AMBIGUOUS_STEMS = new Set(['CHINA', 'KOREA', 'CONGO']);

/** "Kingdom of Thailand" -> "THAILAND". Undefined when nothing was stripped. */
function stripStateForm(key: string): string | undefined {
  const prefix = STATE_FORMS.find((form) => key.startsWith(`${form} `));
  const suffix = prefix ? undefined : STATE_FORMS.find((form) => key.endsWith(` ${form}`));

  let stem: string;
  if (prefix) stem = key.slice(prefix.length + 1);
  else if (suffix) stem = key.slice(0, -(suffix.length + 1));
  else return undefined;

  // "Republic of the Sudan", "Republic of the Philippines".
  if (stem.startsWith('THE ')) stem = stem.slice(4);

  if (!stem || AMBIGUOUS_STEMS.has(stem)) return undefined;
  return stem;
}

let countryIndex: Map<string, string> | null = null;

function countryLookup(): Map<string, string> {
  if (countryIndex) return countryIndex;
  const index = new Map<string, string>();
  for (const [iso, name] of Object.entries(COUNTRIES)) {
    index.set(iso, iso);
    index.set(normaliseKey(name), iso);
  }
  for (const [alias, iso] of Object.entries(COUNTRY_ALIASES)) {
    index.set(normaliseKey(alias), iso);
  }
  countryIndex = index;
  return index;
}

function normaliseKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: "Türkiye" -> "Turkiye"
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Country name (or an already-valid alpha-2 code) to ISO 3166-1 alpha-2.
 *
 * Returns undefined rather than guessing: a wrong country code on a Bill of
 * Entry is a misdeclaration, so the caller must decide whether to leave the
 * cell blank or fail the export.
 */
export function iso2(nameOrCode: string | undefined | null): string | undefined {
  if (!nameOrCode) return undefined;
  const raw = nameOrCode.trim();
  if (!raw) return undefined;
  // Bare alpha-2 passthrough, but only when it is a real code.
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const upper = raw.toUpperCase();
    return upper in COUNTRIES ? upper : undefined;
  }

  const index = countryLookup();
  const key = normaliseKey(raw);
  const direct = index.get(key);
  if (direct) return direct;

  // A leading article is never part of a name in the master, and dropping it
  // may expose an alias: "The People's Republic of China".
  const bare = key.startsWith('THE ') ? key.slice(4) : key;
  const withoutArticle = bare === key ? undefined : index.get(bare);
  if (withoutArticle) return withoutArticle;

  const stem = stripStateForm(bare);
  return stem ? index.get(stem) : undefined;
}

/* ------------------------------------------------------------------ *
 * Ports
 * ------------------------------------------------------------------ */

/**
 * UN/LOCODE for a port, accepting the several shapes the value arrives in.
 *
 * `draft.shipment.portOfLoading` stores the ICES *display* string produced by
 * `formatForeignPort()` — "Yokohama(JPYOK)" — not the code, so the common case
 * is parsing the code back out of the parentheses. Falls back to a master
 * lookup for raw document text like "YOKOHAMA, JAPAN".
 */
export function unlocodeOf(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const parenthesised = /\(([A-Za-z]{5})\)\s*$/.exec(raw);
  if (parenthesised?.[1]) return parenthesised[1].toUpperCase();

  if (/^[A-Za-z]{5}$/.test(raw)) return raw.toUpperCase();

  return lookupForeignPortLoose(raw)?.unlocode;
}

/**
 * Looser than `lookupForeignPort`: also matches when the document text carries
 * a trailing country ("YOKOHAMA, JAPAN") or extra punctuation.
 */
export function lookupForeignPortLoose(text: string): ForeignPortMaster | undefined {
  const key = normaliseKey(text);
  if (!key) return undefined;

  const candidates = FOREIGN_PORTS.map((port) => ({
    port,
    names: [port.name, ...(port.aliases ?? [])].map(normaliseKey),
  }));

  const exact = candidates.find((c) => c.names.includes(key));
  if (exact) return exact.port;

  // "YOKOHAMA JAPAN" contains "YOKOHAMA". Prefer the longest match so that
  // "NEW YORK" never loses to a hypothetical "YORK".
  const partial = candidates
    .filter((c) => c.names.some((n) => key === n || key.startsWith(`${n} `) || key.includes(` ${n} `) || key.endsWith(` ${n}`)))
    .sort((a, b) => Math.max(...b.names.map((n) => n.length)) - Math.max(...a.names.map((n) => n.length)));

  return partial[0]?.port;
}

/* ------------------------------------------------------------------ *
 * Containers
 * ------------------------------------------------------------------ */

export interface ContainerSizeType {
  /** "20" | "40" | "45" */
  size?: string;
  /** ICES container type code, e.g. GP, HC, RF, OT, FR, TK */
  typeCode?: string;
}

/** Suffixes seen on B/Ls and in the Logi-Sys UI, mapped to a type code. */
const CONTAINER_TYPE_TOKENS: Record<string, string> = {
  GP: 'GP', DV: 'GP', SD: 'GP', STANDARD: 'GP', DRY: 'GP',
  HC: 'HC', HQ: 'HC', HIGHCUBE: 'HC', 'HIGH CUBE': 'HC',
  RF: 'RF', REEFER: 'RF', RH: 'RF',
  OT: 'OT', OPENTOP: 'OT', 'OPEN TOP': 'OT',
  FR: 'FR', FLATRACK: 'FR', 'FLAT RACK': 'FR',
  TK: 'TK', TANK: 'TK',
};

/**
 * Split the free text a container size/type arrives as into the template's two
 * separate columns.
 *
 * The same physical container is described three different ways across our
 * sources: "40SD96" on the Interasia B/L, "40 High Cube" in the Logi-Sys UI,
 * and ISO codes like "45G1"/"22G1" elsewhere. All three must land as
 * ContainerSize + ContainerTypeCode.
 */
export function parseContainerSizeType(value: string | undefined | null): ContainerSizeType {
  if (!value) return {};
  const raw = value.trim().toUpperCase();
  if (!raw) return {};

  // ISO 6346 size/type: first char is the length code, third is the group.
  const iso = /^([2394L])([0-9CDEF])([GHRUPTNSB])([0-9])$/.exec(raw);
  if (iso) {
    const isoSize: Record<string, string> = { '2': '20', '4': '40', L: '45', '9': '45', '3': '40' };
    const isoGroup: Record<string, string> = { G: 'GP', H: 'RF', R: 'RF', U: 'OT', P: 'FR', T: 'TK', N: 'GP', S: 'GP', B: 'GP' };
    const size = isoSize[iso[1]!];
    const typeCode = isoGroup[iso[3]!];
    // 4x "G1" with a height digit of 5 or 6 is a high cube.
    const highCube = typeCode === 'GP' && /^[56]/.test(iso[2]!);
    return {
      ...(size !== undefined ? { size } : {}),
      ...(typeCode !== undefined ? { typeCode: highCube ? 'HC' : typeCode } : {}),
    };
  }

  const sizeMatch = /(20|40|45)/.exec(raw);
  const size = sizeMatch?.[1];

  // "40SD96" -> SD (standard) but the 96 is the height in inches: 9'6" = high cube.
  const rest = raw.replace(/(20|40|45)/, ' ').replace(/[^A-Z ]/g, ' ').trim();
  let typeCode: string | undefined;
  for (const [token, code] of Object.entries(CONTAINER_TYPE_TOKENS)) {
    if (rest === token || rest.includes(token)) {
      typeCode = code;
      break;
    }
  }
  if (/96|9'6|HIGH CUBE|HIGHCUBE|\bHC\b|\bHQ\b/.test(raw) && (typeCode === 'GP' || typeCode === undefined)) {
    typeCode = 'HC';
  }

  return {
    ...(size !== undefined ? { size } : {}),
    ...(typeCode !== undefined ? { typeCode } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Package units
 * ------------------------------------------------------------------ */

/**
 * Package unit for `SHIPMENT.PkgUnitCode`.
 *
 * Deliberately *not* `normalizeUqc()`: that one is the item UQC and collapses
 * CARTON to NOS, which is right for a line item's quantity and wrong for a
 * package count — "6258 NOS" loses the fact that they are bags.
 *
 * CONFIRM: values follow what Logi-Sys printed on its own checklist for job
 * I-13844/26-27 ("No Of Pkgs 6258 BAG"), which is the only direct evidence we
 * have of its package-unit vocabulary. ICES elsewhere uses the three-letter
 * form (BGS); if the upload rejects these, switch this table wholesale.
 */
export const PACKAGE_UNITS: Record<string, string> = {
  BAG: 'BAG', BAGS: 'BAG', BG: 'BAG', BGS: 'BAG',
  BALE: 'BAL', BALES: 'BAL',
  BOX: 'BOX', BOXES: 'BOX',
  BUNDLE: 'BDL', BUNDLES: 'BDL',
  CARTON: 'CTN', CARTONS: 'CTN', CTN: 'CTN', CTNS: 'CTN',
  CASE: 'CAS', CASES: 'CAS',
  COIL: 'COL', COILS: 'COL',
  CRATE: 'CRT', CRATES: 'CRT',
  DRUM: 'DRM', DRUMS: 'DRM',
  JUMBO: 'JBG', 'JUMBO BAG': 'JBG', 'JUMBO BAGS': 'JBG',
  PACKAGE: 'PKG', PACKAGES: 'PKG', PKG: 'PKG', PKGS: 'PKG', PACKET: 'PKG',
  PAIL: 'PAL', PAILS: 'PAL',
  PALLET: 'PLT', PALLETS: 'PLT', PLT: 'PLT',
  PIECE: 'PCS', PIECES: 'PCS', PCS: 'PCS', PC: 'PCS',
  ROLL: 'ROL', ROLLS: 'ROL',
};

export function normalizePackageUnit(unit: string | undefined | null): string | undefined {
  if (!unit) return undefined;
  const key = normaliseKey(unit);
  if (!key) return undefined;
  // "6,258 BAG(S)" normalises to "BAG S"; try the bare first token too.
  const firstToken = key.split(' ')[0] ?? key;
  return PACKAGE_UNITS[key] ?? PACKAGE_UNITS[firstToken];
}

/* ------------------------------------------------------------------ *
 * Enumerated header fields
 * ------------------------------------------------------------------ */

/**
 * `INVOICES.TOI` — terms of invoice.
 *
 * Logi-Sys accepts exactly four values: "Expected values are FOB / CIF / C&F /
 * C&I." So CFR is written as C&F — they are the same Incoterm and our documents
 * use both spellings. The distinction that matters is against CIF, which the
 * first manual attempt wrote instead: CIF includes insurance and C&F does not,
 * so the two produce different assessable values.
 *
 * `null` means "no value Logi-Sys would accept". EXW is a real Incoterm the
 * import file has no slot for, so it blocks the export rather than being
 * silently rounded to the nearest term.
 */
export const TOI_CODE: Record<TermsOfInvoice, string | null> = {
  FOB: 'FOB',
  CIF: 'CIF',
  CFR: 'C&F',
  'C&F': 'C&F',
  // Cost-and-insurance, no freight. Previously collapsed to CIF, which added
  // freight to the declaration; Logi-Sys has a distinct value for it.
  CI: 'C&I',
  EXW: null,
};

/**
 * The single-letter ICES forms, as stated by the Logi-Sys upload validator:
 *
 *   TransportModeCode  — 'A' for Air and 'S' for Sea
 *   BETypeCode         — 'H' Home, 'I' Inbond, 'E' Exbond, 'Z'/'M'/'T'/'V'/'S' SEZ
 *   AdvancePriorNormal — 'A' Advance, 'P' Prior, 'N' Normal
 *
 * These were previously the labels the Logi-Sys *UI* shows ("SEA", "HOME",
 * "PRIOR"), which is the vocabulary of its screens rather than of its import
 * file; the file was rejected on all three.
 */
export const TRANSPORT_MODE_CODE: Record<'Sea' | 'Air', string> = {
  Sea: 'S',
  Air: 'A',
};

/** Only home consumption is modelled; the SEZ and bonded forms are unused. */
export const BE_TYPE_CODE: Record<'Home Consumption', string> = {
  'Home Consumption': 'H',
};

export const FILING_CODE: Record<'Normal' | 'Prior' | 'Advance', string> = {
  Normal: 'N',
  Prior: 'P',
  Advance: 'A',
};

/* ------------------------------------------------------------------ *
 * Tariff codes
 * ------------------------------------------------------------------ */

/**
 * Normalise an HS/CTH/RITC code to the 8 digits the Bill of Entry wants.
 *
 * HS codes extend *rightward* — heading, then subheading, then national
 * tariff line — so "3902.10" is 3902.10.00, not 0039.0210. Padding on the
 * wrong side turns polypropylene into a code that does not exist.
 */
export function pad8(hs: string | undefined | null): string | undefined {
  if (!hs) return undefined;
  const digits = hs.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.length > 8) return undefined;
  return digits.padEnd(8, '0');
}
