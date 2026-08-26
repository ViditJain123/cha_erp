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
import { COUNTRY_ALPHA3 } from './generated/country-alpha3.js';

export { COUNTRY_ALPHA3 };

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
  // Spellings the Logi-Sys organization repository uses, typos included. They
  // are in the customer's party master and cannot be corrected from here.
  'CONGO, THE DEMOCRATIC REPUBLIC': 'CD',
  'VIETNAM, DEMOCRATIC REP. OF': 'VN',
  'GAUTEMALA': 'GT',
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

  // Alpha-3. Certificates of origin print "ARE" and "CHN" far more often than
  // they print "United Arab Emirates", and before the country list was
  // imported every one of those fell through to undefined — which on
  // GENERAL.CountryOfOriginCode is a blocked export, not a blank cell.
  //
  // Guarded against the collision that makes this worth spelling out: three
  // letters is also how a few country *names* are written, and "CHN" must not
  // beat a name lookup that would have been right. It cannot — no ISO country
  // name is three letters — so alpha-3 is safe to test first.
  if (/^[A-Za-z]{3}$/.test(raw)) {
    const mapped = COUNTRY_ALPHA3[raw.toUpperCase()];
    if (mapped) return mapped;
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

/**
 * ISO 6346 size/type code for `ContainerTypeCode`.
 *
 * The workbook Logi-Sys exported for job I-10793 writes `22G1` against a
 * `ContainerSize` of `20` — an ISO 6346 code, not the two-letter group that
 * `parseContainerSizeType` returns. Both columns are filled, so the group is
 * not what that column wants.
 *
 * CONFIRM. `22G1` is the only value any vendor file has shown us; the 40- and
 * 45-foot rows below are the standard ISO codes for those size/group pairs and
 * are inferred. A wrong code here is a wrong container description on the Bill
 * of Entry, so it is one table to correct when an upload says otherwise.
 */
const ISO_6346: Record<string, Record<string, string>> = {
  '20': { GP: '22G1', HC: '25G1', RF: '22R1', OT: '22U1', FR: '22P1', TK: '22T1' },
  '40': { GP: '42G1', HC: '45G1', RF: '45R1', OT: '42U1', FR: '42P1', TK: '42T1' },
  '45': { GP: 'L5G1', HC: 'L5G1', RF: 'L5R1', OT: 'L5U1', FR: 'L5P1', TK: 'L5T1' },
};

/**
 * Combine the size and group `parseContainerSizeType()` returns into the ISO
 * 6346 code the template's `ContainerTypeCode` column asks for.
 *
 * Returns undefined when either half is unknown, rather than guessing a
 * standard box — a container we could not read is one the operator should key.
 */
export function iso6346Code(
  size: string | undefined,
  typeCode: string | undefined,
): string | undefined {
  if (!size || !typeCode) return undefined;
  return ISO_6346[size]?.[typeCode];
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
 * Invoice — the two columns that carry a vocabulary, not a value
 * ------------------------------------------------------------------ */

/**
 * `INVOICES.Valuation_Method` — the Customs Valuation Rules 2007 method.
 *
 * Logi-Sys spells these as the rule plus its title, "RULE 4 (TRANSACTION
 * VALUE)", visible on Invoice → Other Details. The draft carries the bare word
 * ("Transaction"), which was being written straight through: the accepted
 * workbook for job ce9c889d says RULE 4 where ours said `Transaction`.
 *
 * Rule 4 is the one all but a handful of filings use — a transaction value
 * between unrelated parties. The rest are the fallback ladder, in order.
 */
export const VALUATION_METHOD: Record<string, string> = {
  TRANSACTION: 'RULE 4 (TRANSACTION VALUE)',
  'RULE 4': 'RULE 4 (TRANSACTION VALUE)',
  IDENTICAL: 'RULE 5 (TRANSACTION VALUE OF IDENTICAL GOODS)',
  'RULE 5': 'RULE 5 (TRANSACTION VALUE OF IDENTICAL GOODS)',
  SIMILAR: 'RULE 6 (TRANSACTION VALUE OF SIMILAR GOODS)',
  'RULE 6': 'RULE 6 (TRANSACTION VALUE OF SIMILAR GOODS)',
  DEDUCTIVE: 'RULE 7 (DEDUCTIVE VALUE)',
  'RULE 7': 'RULE 7 (DEDUCTIVE VALUE)',
  COMPUTED: 'RULE 8 (COMPUTED VALUE)',
  'RULE 8': 'RULE 8 (COMPUTED VALUE)',
  RESIDUAL: 'RULE 9 (RESIDUAL METHOD)',
  'RULE 9': 'RULE 9 (RESIDUAL METHOD)',
};

/** The method to declare when nothing on the documents says otherwise. */
export const DEFAULT_VALUATION_METHOD = VALUATION_METHOD.TRANSACTION;

/**
 * `INVOICES.Valuation_Method` for a draft's stated method.
 *
 * Matches on the leading keyword so that "Transaction value", "transaction" and
 * "RULE 4" all land on the same string. Unknown text returns undefined rather
 * than passing through: the column is a dropdown in Logi-Sys, and free text in
 * it is what the round trip rejected.
 */
export function valuationMethod(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const raw = value.trim().toUpperCase();
  if (!raw) return undefined;

  const exact = VALUATION_METHOD[raw];
  if (exact) return exact;

  // Already in the target spelling.
  if (Object.values(VALUATION_METHOD).includes(raw)) return raw;

  const rule = /RULE\s*([4-9])/.exec(raw);
  if (rule) return VALUATION_METHOD[`RULE ${rule[1]}`];

  const keyword = Object.keys(VALUATION_METHOD).find(
    (k) => !k.startsWith('RULE ') && raw.startsWith(k),
  );
  return keyword ? VALUATION_METHOD[keyword] : undefined;
}

/**
 * `INVOICES.Terms_of_Payment` — a dropdown, with a free-text remark beside it
 * (`Other_Terms_of_Payment_Remark`) that Logi-Sys enables for OTHERS.
 *
 * What our documents carry is never one of the dropdown's words: an invoice
 * says "D/A 45 days from B/L Date", "100% advance TT", "LC at sight 90 days".
 * Writing that into the dropdown column is what the export was doing, and the
 * accepted workbook shows the operator's correction — OTHERS in the column.
 *
 * CONFIRM: only OTHERS is confirmed, from that accepted workbook. The dropdown
 * was not captured open in `logi-sys-screenshots/`, so the codes a term like
 * D/A would map to are unknown, and guessing one is exactly the class of error
 * this table exists to stop. Everything therefore routes to OTHERS with the
 * document's own wording preserved in the remark — which loses nothing, and is
 * strictly better than the free text that was going into the coded column.
 * When someone can open that dropdown, add the values here and this is the
 * only place that changes.
 */
export const TERMS_OF_PAYMENT_OTHERS = 'OTHERS';

export interface TermsOfPaymentCells {
  /** The coded column. */
  code: string;
  /** The remark column — the wording actually printed on the invoice. */
  remark?: string;
}

export function termsOfPayment(value: string | undefined | null): TermsOfPaymentCells {
  const raw = value?.trim();
  if (!raw) return { code: TERMS_OF_PAYMENT_OTHERS };
  if (raw.toUpperCase() === TERMS_OF_PAYMENT_OTHERS) return { code: TERMS_OF_PAYMENT_OTHERS };
  return { code: TERMS_OF_PAYMENT_OTHERS, remark: raw };
}

/**
 * `INVOICES.RD_Basis` — what the revenue deposit is charged on.
 *
 * "RD" is Revenue Deposit: Invoice → Other Charges reads
 * "Revenue Deposit __ % on [Assessable]". Logi-Sys writes the pair as 0.00 / A
 * on its own export even when no deposit is taken, and the column was being
 * left empty.
 */
export const RD_BASIS_ASSESSABLE = 'A';

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

/* ------------------------------------------------------------------ *
 * Single Window additional information
 * ------------------------------------------------------------------ *
 *
 * SW_ADDL_INFO's `Info_Type` and `info_Qualifier` are code columns. The draft
 * carries the prose labels the Logi-Sys UI shows — "Item Characteristics",
 * "Standard UQC" — because that is what the screenshots and the PGA rules are
 * written in. The workbook Logi-Sys exported for job I-10793 writes `CHR` and
 * `SQC` in the same two columns, so the labels have to be translated on the way
 * out. Same shape of problem as PORT/COUNTRY/TOI above, same fix: one table.
 */

/** `Info_Type` label -> code. Confirmed against the I-10793 export. */
export const SW_INFO_TYPE_CODE: Record<string, string> = {
  'Item Characteristics': 'CHR',
  'Item Category': 'CTG',
  'Item Identification': 'IDT',
  'Product Name': 'PNM',
};

/**
 * `info_Qualifier` label -> code.
 *
 * Only what the I-10793 export actually shows. The FSSAI qualifiers in
 * SINGLE_WINDOW_RULES — Storage Condition, Drug Related Category, Foods &
 * Supplement Proprietry Status, Retail Pre-pack Food Article — are deliberately
 * absent: no vendor export we hold carries a food or pharma consignment, and
 * a plausible-looking three-letter code invented here would go onto a customs
 * declaration as fact. Those rows warn and are dropped until a real export
 * names their codes.
 */
export const SW_QUALIFIER_CODE: Record<string, string> = {
  'Standard UQC': 'SQC',
  'Chemical Category (CPC)': 'CPC',
  'Chemical Abstract Service registration number.': 'CAS',
  'Name as per the IUPAC Nomenclature': 'IUP',
};

function swLookup(table: Record<string, string>, label: string | undefined): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  if (table[trimmed]) return table[trimmed];
  // A label already given as its code passes through: merge.ts writes the
  // labels today, but a hand-edited draft may hold either.
  const key = trimmed.toUpperCase();
  return Object.values(table).includes(key) ? key : undefined;
}

export function swInfoTypeCode(label: string | undefined): string | undefined {
  return swLookup(SW_INFO_TYPE_CODE, label);
}

export function swQualifierCode(label: string | undefined): string | undefined {
  return swLookup(SW_QUALIFIER_CODE, label);
}
