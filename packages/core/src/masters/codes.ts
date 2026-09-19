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

/**
 * A container number stripped to the 11 characters ISO 6346 defines.
 *
 * B/Ls print them spaced and punctuated in every combination — `CAIU 3686895`,
 * `CAIU-3686895`, `CAIU3686895/QIN2410658` — and the same box has to compare
 * equal however it was printed, because that comparison is what stops one
 * container being written into the CONTAINERS sheet twice.
 */
export function normaliseContainerNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validates an ISO 6346 container number including its check digit.
 *
 * The check digit matters twice over. As a match key, an invalid number would
 * merge two unrelated shipments. On the CONTAINERS sheet it is the only thing
 * that can tell a misread box apart from a real one without a person looking at
 * the B/L again — `IAAU1141498` and `IAAU1141499` are both plausible strings and
 * only one of them is a container.
 */
export function isValidContainerNumber(value: string): boolean {
  const v = normaliseContainerNumber(value);
  if (!/^[A-Z]{4}[0-9]{7}$/.test(v)) return false;

  // A=10, skipping every multiple of 11.
  const letterValues: Record<string, number> = {};
  let n = 10;
  for (let c = 65; c <= 90; c++) {
    if (n % 11 === 0) n++;
    letterValues[String.fromCharCode(c)] = n;
    n++;
  }

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = v[i] as string;
    const digit = i < 4 ? (letterValues[ch] as number) : Number(ch);
    sum += digit * 2 ** i;
  }
  const check = (sum % 11) % 10;
  return check === Number(v[10]);
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

/**
 * Weight units as transport documents print them, and what each one is in kg.
 *
 * A bill of lading does not write "KGS" because a human would. `KGM` is the
 * UN/ECE Recommendation 20 code and is what an EDI-generated B/L prints —
 * `ex_job6/COPY BL EP061126-1.pdf` states "157,703.000 KGM", and reading that
 * as an unknown unit is how a gross weight goes missing. `LBS` is rarer on
 * Indian imports but it is the dangerous one: taken as kilograms it understates
 * the declared weight by more than half.
 *
 * The factor is to kilograms, which is the only unit the Bill of Entry writes —
 * `GrWtUnitCode` and `NtWtUnitCode` are `KGS` on every vendor export we hold.
 *
 * CONFIRM: KGM/KGS/KG, the IATA K, and LBS/LB are attested; L (IATA pounds), MT
 * and QTL have not been seen on a document yet. `L` is deliberately scoped to
 * this table, which is only consulted for the weight fields of a transport
 * document — it is not a general unit lookup, where L would be litres.
 */
export const WEIGHT_UNITS: Record<string, { code: string; toKg: number }> = {
  // The IATA air waybill weight box states its unit as a single letter: K for
  // kilograms, L for pounds. ex_job1's waybill reads "101.00 K". Without these
  // two the figure is refused as an unreadable unit and the gross weight goes
  // missing on every air job.
  K: { code: 'KGS', toKg: 1 },
  L: { code: 'KGS', toKg: 0.45359237 },
  KG: { code: 'KGS', toKg: 1 },
  KGS: { code: 'KGS', toKg: 1 },
  KGM: { code: 'KGS', toKg: 1 },
  KILO: { code: 'KGS', toKg: 1 },
  KILOS: { code: 'KGS', toKg: 1 },
  KILOGRAM: { code: 'KGS', toKg: 1 },
  KILOGRAMS: { code: 'KGS', toKg: 1 },
  KILOGRAMME: { code: 'KGS', toKg: 1 },
  KILOGRAMMES: { code: 'KGS', toKg: 1 },
  LB: { code: 'KGS', toKg: 0.45359237 },
  LBS: { code: 'KGS', toKg: 0.45359237 },
  POUND: { code: 'KGS', toKg: 0.45359237 },
  POUNDS: { code: 'KGS', toKg: 0.45359237 },
  MT: { code: 'KGS', toKg: 1000 },
  TON: { code: 'KGS', toKg: 1000 },
  TONS: { code: 'KGS', toKg: 1000 },
  TONNE: { code: 'KGS', toKg: 1000 },
  TONNES: { code: 'KGS', toKg: 1000 },
  TNE: { code: 'KGS', toKg: 1000 },
  // MTS is the ICES UQC for a metric tonne, and `VALID_UQC` already accepts it
  // as an item unit — so a line invoiced in MTS survives normalisation with its
  // quantity in tonnes. Without this entry it has no conversion to kilograms,
  // and SW_ADDL_INFO's standard quantity refuses a line it could have stated.
  // Not to be confused with MTR, the UQC for a metre.
  MTS: { code: 'KGS', toKg: 1000 },
  QTL: { code: 'KGS', toKg: 100 },
  QUINTAL: { code: 'KGS', toKg: 100 },
};

/**
 * The unit as printed -> the code the Bill of Entry writes, always `KGS`.
 *
 * Returns undefined for a unit that is not a weight at all — `MTQ` (cubic
 * metres) sits in the same column as the weight on some B/Ls, and answering
 * "KGS" for a volume would declare a measurement as a weight.
 */
export function normalizeWeightUnit(unit: string | undefined | null): string | undefined {
  return lookupWeightUnit(unit)?.code;
}

/** The full entry, for callers that need the conversion factor as well. */
export function lookupWeightUnit(
  unit: string | undefined | null,
): { code: string; toKg: number } | undefined {
  if (!unit) return undefined;
  const key = normaliseKey(unit);
  if (!key) return undefined;
  const firstToken = key.split(' ')[0] ?? key;
  return WEIGHT_UNITS[key] ?? WEIGHT_UNITS[firstToken];
}

/**
 * A weight stated in `unit`, in kilograms.
 *
 * Returns undefined rather than the input when the unit is unrecognised: a
 * number whose unit nobody could read is not a weight in kilograms, and
 * passing it through is exactly the silent mis-declaration this exists to stop.
 */
export function weightToKg(
  value: number | undefined | null,
  unit: string | undefined | null,
): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  // No unit printed: documents that omit it are stating kilograms.
  if (!unit || !unit.trim()) return value;
  const entry = lookupWeightUnit(unit);
  if (!entry) return undefined;
  return value * entry.toKg;
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
/**
 * `S` sea, `A` air, `L` land.
 *
 * `Land` is not a third kind of vessel — it is a sea or air consignment whose
 * carriage into the customs station is inland, which is every consignment
 * delivered to an ICD, CFS or land customs station. The station decides it, not
 * the transport document: see `transportModeForStation()` in `stations.ts`.
 */
export const TRANSPORT_MODE_CODE: Record<'Sea' | 'Air' | 'Land', string> = {
  Sea: 'S',
  Air: 'A',
  Land: 'L',
};

/**
 * `H` home consumption, `W` into-bond (warehousing), `EX` ex-bond.
 *
 * Which one is the customer's instruction, not something the shipping documents
 * say — the same goods are warehoused or cleared home on the importer's word.
 * `W` and `EX` both make the INBOND_EXBOND sheet mandatory.
 */
export const BE_TYPE_CODE: Record<'Home Consumption' | 'Warehousing' | 'Ex-Bond', string> = {
  'Home Consumption': 'H',
  Warehousing: 'W',
  'Ex-Bond': 'EX',
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
 * `INVOICES.Valuation_Method` — the rule the value was determined under.
 *
 * Logi-Sys spells these as the rule plus its title and takes the whole string.
 *
 * **The dropdown and the export disagree, and both are here on purpose.** The
 * dropdown photographed on the customer's workbook (`INVOICES!BD9`) is the
 * Customs Valuation Rules **2007** ladder — Rule 3 determination of method,
 * Rule 4 identical goods, Rule 5 similar goods, up to Rule 12 rejection, plus
 * OTH. It contains no transaction-value entry, because under CVR 2007
 * transaction value is Rule 3(1) itself. Logi-Sys' own export of job I-10793
 * nonetheless writes `RULE 4 (TRANSACTION VALUE)` — the **1988** numbering —
 * and so does the hand-corrected `final (1).xlsx`.
 *
 * So `TRANSACTION` is the string that round-trips and stays the default, and
 * the eleven dropdown strings are what an operator may choose instead. See
 * docs/boe-mapping/open-questions.md.
 */
export const VALUATION_METHOD = {
  TRANSACTION: 'RULE 4 (TRANSACTION VALUE)',
  METHOD_DETERMINATION: 'RULE 3 (DETERMINATION OF METHOD OF VALUATION)',
  IDENTICAL: 'RULE 4 (TRANS. VALUE OF IDENTICAL GOODS)',
  SIMILAR: 'RULE 5 (TRANS. VALUE OF SIMILAR GOODS)',
  DETERMINATION_OF_VALUE: 'RULE 6 (DETERMINATION OF VALUE)',
  DEDUCTIVE: 'RULE 7 (DEDUCTIVE VALUE)',
  COMPUTED: 'RULE 8 (COMPUTED VALUE)',
  RESIDUAL: 'RULE 9 (RESIDUAL METHOD)',
  COST_AND_SERVICES: 'RULE 10 (COST AND SERVICES)',
  DECLARATION_BY_IMPORTER: 'RULE 11 (DECLARATION BY IMPORTER)',
  REJECTION: 'RULE 12 (REJECTION OF DECLARED VALUE)',
  OTHERS: 'OTH (OTHERS)',
} as const;

/** Every string the column accepts, for the operator's dropdown. */
export const VALUATION_METHODS: readonly string[] = Object.values(VALUATION_METHOD);

/** The method to declare when nothing on the documents says otherwise. */
export const DEFAULT_VALUATION_METHOD: string = VALUATION_METHOD.TRANSACTION;

/**
 * `INVOICES.Valuation_Method` for a stated method.
 *
 * Exact match against the eleven strings first, then a small keyword table.
 * **There is deliberately no `RULE n` regex.** The two numbering schemes above
 * disagree about what Rule 4 and Rule 5 are, so a bare rule number identifies
 * nothing: "RULE 5" is the transaction value of identical goods under one and
 * of similar goods under the other. Unknown text returns undefined rather than
 * passing through — the column is a dropdown, and free text in it is what the
 * round trip rejected.
 */
const VALUATION_KEYWORDS: Record<string, string> = {
  TRANSACTION: VALUATION_METHOD.TRANSACTION,
  'TRANSACTION VALUE': VALUATION_METHOD.TRANSACTION,
  IDENTICAL: VALUATION_METHOD.IDENTICAL,
  SIMILAR: VALUATION_METHOD.SIMILAR,
  DEDUCTIVE: VALUATION_METHOD.DEDUCTIVE,
  COMPUTED: VALUATION_METHOD.COMPUTED,
  RESIDUAL: VALUATION_METHOD.RESIDUAL,
  REJECTION: VALUATION_METHOD.REJECTION,
  REJECTED: VALUATION_METHOD.REJECTION,
  OTHERS: VALUATION_METHOD.OTHERS,
  OTH: VALUATION_METHOD.OTHERS,
};

export function valuationMethod(value: string | undefined | null): string | undefined {
  const raw = value?.trim().toUpperCase();
  if (!raw) return undefined;

  // Already in the target spelling.
  const exact = VALUATION_METHODS.find((v) => v === raw);
  if (exact) return exact;

  const keyword = Object.keys(VALUATION_KEYWORDS)
    .sort((a, b) => b.length - a.length)
    .find((k) => raw.startsWith(k));
  return keyword ? VALUATION_KEYWORDS[keyword] : undefined;
}

/**
 * `INVOICES.Nature_of_Trans` — the nine labels of the Logi-Sys dropdown,
 * photographed open on the customer's annotated workbook (`INVOICES!BC8`).
 *
 * ICES codes these `S|C|H|F|O|R|P|G|M` (BE JSON schema `natureOfTransaction`);
 * Logi-Sys takes the label and does the coding itself, so the label is what the
 * column holds — `Sale` on every vendor workbook, `Free of cost` on the two
 * free-of-cost re-imports `ex_job3` and `ex_job4`.
 */
export const NATURE_OF_TRANSACTION: Record<string, string> = {
  SALE: 'Sale',
  SALE_ON_CONSIGNMENT: 'Sale on Consignment basis',
  HIRE: 'Hire',
  RENT: 'Rent',
  GIFT: 'Gift',
  SAMPLE: 'Sample',
  FREE_OF_COST: 'Free of cost',
  REPLACEMENT: 'Replacement',
  OTHER: 'Others',
  // The document did not say. Every golden but the two FOC re-imports is a sale.
  UNKNOWN: 'Sale',
};

/** Every label the column accepts, for the operator's dropdown. */
export const NATURE_OF_TRANSACTIONS: readonly string[] = [
  ...new Set(Object.values(NATURE_OF_TRANSACTION)),
];

/**
 * `INVOICES.Terms_of_Payment` — a dropdown of six, photographed open on the
 * customer's annotated workbook (`INVOICES!AX8`), with a remark column beside
 * it that Logi-Sys enables only for OTHERS.
 *
 * ICES itself carries fewer: `DP/DA`, `FoC`, `LC` and `OTH` (BE Message format
 * 2.25, Payment terms). Logi-Sys splits DP from DA and adds SD, and takes its
 * own labels.
 */
export const TERMS_OF_PAYMENT = {
  LC: 'LC',
  FOC: 'FOC',
  DP: 'DP',
  DA: 'DA',
  SD: 'SD',
  OTHERS: 'OTHERS',
} as const;

export const TERMS_OF_PAYMENT_OTHERS = TERMS_OF_PAYMENT.OTHERS;

/** Every code the column accepts, for the operator's dropdown. */
export const TERMS_OF_PAYMENT_CODES: readonly string[] = Object.values(TERMS_OF_PAYMENT);

export interface TermsOfPaymentCells {
  /** The coded column. */
  code: string;
  /** The remark column — `OTHERS` beside an OTHERS code, blank beside any other. */
  remark: string;
}

/**
 * The dropdown code an invoice's own payment wording maps to.
 *
 * Invoices write prose: "D/A 45 days from B/L Date", "100% advance TT",
 * "Irrevocable LC at sight", "CAD". Only the unambiguous shapes are coded; a
 * term that names no instrument stays OTHERS, because a wrong code here is a
 * statement to Customs about how the goods were paid for.
 *
 * The remark carries `OTHERS` beside an OTHERS code — Logi-Sys' own export
 * writes the word in both columns — and is blank beside every other code, which
 * is the customer's rule for the column (`INVOICES!AZ10`): the remark exists to
 * qualify OTHERS and means nothing next to a code that already says the thing.
 */
export function termsOfPayment(value?: string | null): TermsOfPaymentCells {
  const code = termsOfPaymentCode(value);
  return { code, remark: code === TERMS_OF_PAYMENT.OTHERS ? TERMS_OF_PAYMENT_OTHERS : '' };
}

function termsOfPaymentCode(value?: string | null): string {
  // "D/A", "D.A.", "D / A" and "DA" are one term. Separators collapse to a
  // single space so the patterns below need only one spelling each.
  const raw = value?.toUpperCase().replace(/[./\-\s]+/g, ' ').trim();
  if (!raw) return TERMS_OF_PAYMENT.OTHERS;

  // Already a code.
  const asCode = TERMS_OF_PAYMENT_CODES.find((c) => c === raw);
  if (asCode) return asCode;

  if (/\bFREE OF (COST|CHARGE)\b|\bF ?O ?C\b|\bNO COMMERCIAL VALUE\b/.test(raw)) return TERMS_OF_PAYMENT.FOC;
  // "LC", "L/C", "LETTER OF CREDIT", "IRREVOCABLE LC AT SIGHT".
  if (/\bL ?C\b|\bLETTER OF CREDIT\b/.test(raw)) return TERMS_OF_PAYMENT.LC;
  // Documents against acceptance / payment. "CAD" (cash against documents) is
  // the same instrument as D/P.
  if (/\bD ?A\b|\bDOCUMENTS? AGAINST ACCEPTANCE\b/.test(raw)) return TERMS_OF_PAYMENT.DA;
  if (/\bD ?P\b|\bDOCUMENTS? AGAINST PAYMENT\b|\bCAD\b|\bCASH AGAINST DOCUMENTS?\b/.test(raw))
    return TERMS_OF_PAYMENT.DP;
  if (/\bS ?D\b|\bSIGHT DRAFT\b/.test(raw)) return TERMS_OF_PAYMENT.SD;

  // Advance payment, open account, "net 30", "TT" — real terms, none of which
  // is one of the six. OTHERS is the honest answer.
  return TERMS_OF_PAYMENT.OTHERS;
}

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

/**
 * `Info_Type` label -> code. ICES field 9, `d_info_type`.
 *
 * The spec names six values; the three below it does not name appear only in
 * later sections of the same document (`DTY` for the SEZ anti-dumping
 * declaration, `SEZ` for authorised person and bonded-warehouse movement, `HAC`
 * for hand carriage) and are listed so an unknown label is a lookup miss rather
 * than a silent omission. We file `CHR`, `CTG`, `IDT` and `PNM` today.
 */
export const SW_INFO_TYPE_CODE: Record<string, string> = {
  'Item Characteristics': 'CHR',
  'Item Category': 'CTG',
  'Item Identification': 'IDT',
  'Product Name': 'PNM',
  'PGA Exception Category': 'PEC',
  'Origin Criteria': 'ORC',
};

/**
 * `info_Qualifier` label -> code. ICES field 10, `d_info_qfr`.
 *
 * `d_info_qfr` is not published as a file anywhere reachable. **Annexure A of
 * Circular 55/2020-Customs dated 17.12.2020** is the closest thing that exists
 * in the open — 35 entries, and the source Logi-Sys took its own UI labels
 * from, verbatim down to the trailing full stop in "…registration number.".
 * It is a floor and not a ceiling: `CPC` (Circular 23/2023) and `HZRDS`
 * (Circular 24/2026) postdate it and are both in the corpus.
 *
 * Every label below is CBIC's own wording or the Logi-Sys screen's. Nothing
 * here is invented — an unmapped label is dropped with a warning rather than
 * written through, because a plausible-looking three-letter code would go onto
 * a customs declaration as fact (ICES 454, *Invalid Info Qualifier Code*).
 */
export const SW_QUALIFIER_CODE: Record<string, string> = {
  // CHR — item characteristics
  'Standard UQC': 'SQC',
  'Statistical Unit Quantity Code for Customs': 'SQC',
  Sex: 'SEX',
  Breed: 'BRD',
  Colour: 'CLR',
  'Plant Variety': 'PLV',
  'Storage Temperature': 'STT',
  'Storage Condition': 'STC',
  // Circular 24/2026: hazardous cargo. Not in Annexure A.
  Hazardous: 'HZRDS',
  // CTG — item category
  'Grade of the Product': 'GRA',
  'Plant Category': 'PLC',
  'Plant Parts': 'PLP',
  'Drug Related Category': 'DRC',
  'Foods & Supplement Proprietry Status': 'FSP',
  // Circular 23/2023: the chemical category. Not in Annexure A.
  'Chemical Category (CPC)': 'CPC',
  // IDT — item identification
  'Animal Passport Number': 'PAS',
  'Electronic Component Identification Number': 'ECI',
  'Global Trade Item Number': 'GTI',
  'Vehicle Identification Number': 'VIN',
  'Microchips numbers inserted into animals for identifification purposes': 'MIC',
  'Chemical Abstract Service registration number.': 'CAS',
  // ORC — origin criteria, mandatory whenever an FTA notification is claimed
  'Country of Origin': 'COO',
  'Origin Criteria': 'ORG',
  Accumulation: 'ACM',
  'Wholly Obtained or Produced': 'WP',
  'Value Added': 'VA',
  'Product Specific Rules': 'PS',
  // PNM — product name
  'Pet Name': 'PET',
  'Scientific Name': 'SCI',
  'Common Name': 'COM',
  'Trade or Commercial Name': 'CON',
  'Name of the model': 'MOD',
  'Name as per the IUPAC Nomenclature': 'IUP',
  'Name as contained in a Pharmacopeia': 'PHA',
  'International Non-proprietary Name': 'INN',
  'Plant Commodity Name': 'PCN',
  'Name of the Livestock product': 'LSP',
  'SIMS Unique Reference Number': 'SIU',
  // Printed on Logi-Sys checklists but absent from Annexure A, so their
  // three-letter codes are unknown and a row carrying one is dropped with a
  // warning rather than guessed at. `ex_job2`, `ex_job3` and `ex_job24` all
  // file "Retail Pre-pack Food Article" (info code RFAN); `ex_job3` files
  // "Re-Import Reason". See docs/boe-mapping/open-questions.md#sw-fssai-codes.
  //   'Retail Pre-pack Food Article': '???',
  //   'Re-Import Reason': '???',
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

/* ------------------------------------------------------------------ *
 * ITEMS — the per-item code columns
 * ------------------------------------------------------------------ *
 *
 * Read off Logi-Sys' own product screens (`logi-sys-screenshots/`
 * 15.04.07–15.07.00: General, Cust. Duty, GST, Oth. Duties, FTA Info) and
 * checked against the ICES BE message (`BE Message format 2.25`, Part 6 ITEMS
 * and Part 14 SBEDUTY) and JNCH Public Notice 80/2017. Contract:
 * docs/boe-mapping/06-items.md.
 */

/**
 * `Exim_Code` — the "Exim Scheme" dropdown (ICES Part 6 field 14, "Item
 * category (Scheme Code)"), and the same domain as `LICENSE` field 15
 * ("License Code").
 *
 * The full directory, from the Scheme Code table in
 * `data/customs-corpus/icegate-specs/ICES 1 5 Customs - DGFT Message Formats
 * Version 1 9 (21 07 08).pdf` — the list Customs and DGFT exchange, which is
 * where the Logi-Sys dropdown gets its entries. The dropdown was photographed
 * scrolled, which is why `10`, `16` and `19` were missing and the list appeared
 * to stop at `20`; the wording for `01`–`20` is kept as the screenshot shows it
 * because that is what the vendor's own UI says.
 *
 * Blank — no scheme — is the normal import and what most goldens file. An
 * unknown code is refused rather than passed through: ICES rejects a wrong one
 * outright (error 329 "Wrong Licence Code", 406 "Wrong Licence Code in LIC
 * Details"), and a scheme code that does not match the licence is error 426.
 *
 * `48` and `49` are reconstructed: the source PDF wraps "DRAWBACK" across two
 * lines there and prints `49` twice.
 */
export const EXIM_SCHEME: Record<string, string> = {
  '00': 'Free shipping bill involving remittance of foreign exchange',
  '01': 'Advance Licence with actual user condition',
  '02': 'Advance licence for intermediate supplies',
  '03': 'Advance licence',
  '04': 'Advance Release order',
  '05': 'Advance Licence for deemed exports',
  '06': 'DEPB-post exports',
  '07': 'DEPB-pre exports',
  '08': 'Replenishment licence',
  '09': 'Diamond imprest licence',
  '10': 'Bulk licence',
  '11': 'Concessional duty EPCG scheme',
  '12': 'Zero duty EPCG scheme',
  '13': 'CCP',
  '14': 'Import licence for restricted items of imports',
  '15': 'Special Import licence',
  '16': 'Export licence',
  '17': 'Advance Licence for annual requirement',
  '18': 'Duty Free Replenishment Certificate',
  '19': 'Drawback',
  '20': 'Jobbing (JBG)',
  '21': 'EOU/EPZ/SEZ/EHTP/STP',
  '22': 'Duty Free Credit Entitlement Certificate',
  '23': 'Target Plus Scheme',
  '24': 'Vishesh Krishi Upaj Yojana (VKUY)',
  '25': 'DFCE for status holder',
  '26': 'DFIA',
  '27': 'Focus Market',
  '28': 'Focus Product',
  '29': 'High Tech Product EPS',
  '41': 'Drawback and Advance Licence',
  '42': 'Drawback and DFRC',
  '43': 'Drawback and zero duty EPCG',
  '44': 'Drawback and concessional duty EPCG',
  '45': 'Drawback and pre-export DEPB',
  '46': 'Drawback and post-export DEPB',
  '47': 'Drawback and JBG',
  '48': 'Drawback and Diamond Imprest Licence',
  '49': 'Drawback and EOU/EPZ/SEZ',
  '50': 'EPCG and Advance Licence',
  '51': 'EPCG and DFRC',
  '52': 'EPCG and JBG',
  '53': 'EPCG and Diamond Imprest Licence',
  '54': 'EPCG and Replenishment Licence',
  '55': 'EPCG and DEPB (post exports)',
  '56': 'EPCG and DEPB (pre-exports)',
  '59': 'EPCG and DFIA',
  '71': 'EPCG, drawback and DEEC',
  '72': 'EPCG, drawback and DFRC',
  '73': 'EPCG, drawback and jobbing',
  '74': 'EPCG, drawback and Diamond Imprest Licence',
  '75': 'EPCG, drawback and DEPB post export',
  '76': 'EPCG, drawback and DEPB (pre-export)',
  '79': 'EPCG, DFIA and DBK',
  '99': 'NFEI (no foreign exchange involved)',
};

/**
 * Scheme codes Logi-Sys writes that are not in the ICES directory.
 *
 * Duty-credit scrips issued after the directory was published have no ICES
 * scheme code of their own, and Logi-Sys files a letter code instead. Each
 * entry names the vendor export that proves it, because nothing else does —
 * these are not in any published list and must not be invented.
 */
export const VENDOR_EXIM_SCHEME: Record<string, string> = {
  // ex_job27, job I-14222: the Logi-Sys checklist prints `EximCode:32` beside
  // `EXIM Notn (TQ) 022/2022 III2`, against DGFT Tariff Rate Quota
  // authorisation 0111032798 (`ex_job27/14222 TRQ LIC.pdf`). TRQ postdates the
  // 2008 ICES directory, which is why it is in neither that nor the dropdown.
  '32': 'Tariff Rate Quota',
  // ex_job20/JobData_I-14225_26-27_20260907_162112.xlsx: two RoDTEP scrips
  // debited on one line, with `Exim_Code RD` and `Exim_Notn RODTEP`. The only
  // non-numeric scheme code seen, and the reason `eximSchemeCode` cannot be
  // digits-only.
  RD: 'RoDTEP scrip',
};

/**
 * `Exim_Code` for a stated scheme: a code as-is, or a name matched exactly.
 *
 * A non-numeric code resolves only through `VENDOR_EXIM_SCHEME`, so an
 * unrecognised one still refuses rather than reaching the Bill of Entry.
 */
export function eximSchemeCode(value: string | undefined | null): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const code = raw.match(/^(\d{1,2})\b/)?.[1]?.padStart(2, '0');
  if (code && (EXIM_SCHEME[code] || VENDOR_EXIM_SCHEME[code])) return code;
  const upper = raw.toUpperCase();
  if (VENDOR_EXIM_SCHEME[upper]) return upper;
  const byName = Object.entries(EXIM_SCHEME).find(([, name]) => name.toUpperCase() === upper);
  if (byName) return byName[0];
  return Object.entries(VENDOR_EXIM_SCHEME).find(([, name]) => name.toUpperCase() === upper)?.[0];
}

/** The scheme's name, whether it is an ICES code or one only Logi-Sys writes. */
export function eximSchemeName(code: string | undefined | null): string | undefined {
  const raw = code?.trim();
  if (!raw) return undefined;
  return EXIM_SCHEME[raw] ?? VENDOR_EXIM_SCHEME[raw.toUpperCase()];
}

/**
 * `*_NotnFlag` — the Plus/Minus/Higher/Lower dropdown beside every duty line
 * on the Cust. Duty, GST and Oth. Duties screens.
 *
 * A notification rate can have an ad valorem part (`%`) and a specific part
 * (amount per unit). The flag says how the two combine: `+` adds them, `-`
 * subtracts the specific from the ad valorem, `H` takes the higher and `L` the
 * lower. With no specific part every flag gives the same duty, which is why
 * the screen defaults to Plus and liv_job1's export writes `+` on every levy
 * line. Other Duties (Section 3(3)) defaults to Higher.
 */
export const NOTN_FLAG = {
  PLUS: '+',
  MINUS: '-',
  HIGHER: 'H',
  LOWER: 'L',
} as const;
export type NotnFlag = (typeof NOTN_FLAG)[keyof typeof NOTN_FLAG];
export const NOTN_FLAGS: readonly NotnFlag[] = Object.values(NOTN_FLAG);

export function notnFlag(value: string | undefined | null): NotnFlag | undefined {
  const raw = value?.trim().toUpperCase();
  if (!raw) return undefined;
  const words: Record<string, NotnFlag> = { PLUS: '+', MINUS: '-', HIGHER: 'H', LOWER: 'L' };
  if (words[raw]) return words[raw];
  return (NOTN_FLAGS as readonly string[]).includes(raw) ? (raw as NotnFlag) : undefined;
}

/**
 * Duty on one line under a notification with an ad valorem and a specific part.
 * `specific` is already converted to rupees for the whole quantity.
 */
export function combineNotnRate(flag: NotnFlag, adValorem: number, specific: number): number {
  switch (flag) {
    case '+':
      return adValorem + specific;
    case '-':
      return Math.max(0, adValorem - specific);
    case 'H':
      return Math.max(adValorem, specific);
    case 'L':
      return Math.min(adValorem, specific);
  }
}

/**
 * `IGST_ExemptionNotnType` / `IGST_CompCessExemptionNotnType` — the
 * "Customs Notn." / "GST Notn." dropdown on the GST screen.
 *
 * ICES SBEDUTY "Customs Notn exempting IGST flag (G/C)". JNCH PN 80/2017 §4:
 * "Exmp. Notfn. Type — G by Default; C – customs Notfn." An IGST exemption is
 * granted either under section 6 of the IGST Act (a GST notification, `G`) or
 * by a Customs notification such as 45/2025's IGST column (`C`).
 */
export const EXEMPTION_NOTN_TYPE = {
  CUSTOMS: 'C',
  GST: 'G',
} as const;
export type ExemptionNotnType = (typeof EXEMPTION_NOTN_TYPE)[keyof typeof EXEMPTION_NOTN_TYPE];

/**
 * The type a notification number implies, from its own suffix: "-Customs" is
 * `C`, "-Integrated Tax (Rate)" / "-Compensation Cess (Rate)" is `G`. Undefined
 * when the number carries no suffix — the caller must know the source.
 */
export function exemptionNotnType(notification: string | undefined | null): ExemptionNotnType | undefined {
  const raw = notification?.toUpperCase() ?? '';
  if (/CUS/.test(raw)) return 'C';
  if (/INTEGRATED|COMPENSATION|IGST|CESS|\bIT\b|RATE/.test(raw)) return 'G';
  return undefined;
}

/**
 * `Accessories_Status` — ICES Part 6 field 92 (mandatory).
 *
 * `0` nothing imported with the item; `1` accessories compulsorily supplied
 * free with it (Accessories (Condition) Rules, 1963 rule 2) — then
 * `Accessories_Details` must describe them; `2` accessories imported but
 * declared as separate items.
 */
export const ACCESSORY_STATUS = {
  NONE: '0',
  SUPPLIED_WITH_ITEM: '1',
  DECLARED_SEPARATELY: '2',
} as const;

/**
 * `ADD_Basis` — the anti-dumping "Calc. Method" dropdown. The screen default
 * "%age of Assbl. Value" is what liv_job1 exports as `AV`. A specific duty
 * (amount per unit) has no basis letter on the screen; it is carried by
 * `ADD_AmountPerUnit` / `ADD_AmountUnit` instead.
 */
export const ADD_BASIS_ASSESSABLE = 'AV';

/**
 * `CVD_CalculatedOn` — the Customs CVD "Calc. Method" dropdown. The screen
 * default "%age of Landed Value" is what liv_job1 exports as `1`.
 */
export const CVD_CALCULATED_ON_LANDED = '1';

/**
 * Logi-Sys' notification-number spelling: three-digit serial, slash, year —
 * `011/2021`, `009/2025`, `069/2011`. Every golden writes it this way, and CBIC
 * titles never do ("11/2021-Customs", "69/2011 - Customs").
 */
export function logisysNotn(value: string | undefined | null): string | undefined {
  const m = value?.match(/(\d{1,3})\s*\/\s*(\d{4})/);
  if (!m) return undefined;
  return `${m[1]!.padStart(3, '0')}/${m[2]!}`;
}

/**
 * An end-use code for what an importer's mail says the goods are for.
 *
 * Only the purposes a customer actually writes in plain words; anything else
 * is left for the operator rather than rounded to trading. "For our factory"
 * and "actual use" are manufacture — GNX200; "for sale", "trading" and
 * "resale" are GNX100.
 */
export function endUseCodeFromText(text: string | null | undefined): string | undefined {
  const t = (text ?? '').toUpperCase();
  if (!t.trim()) return undefined;
  const direct = t.match(/\b([A-Z]{3}\d{3})\b/)?.[1];
  if (direct) return direct;
  if (/\bR\s*&\s*D\b|RESEARCH|DEVELOPMENT/.test(t)) return /MEDICAL|BIOMEDICAL|CLINICAL/.test(t) ? 'GNX815' : 'GNX810';
  if (/REPAIR|REFURBISH/.test(t)) return 'GNX600';
  if (/RECYCL|RECOVERY/.test(t)) return 'GNX650';
  if (/EXHIBITION|DISPLAY/.test(t)) return 'GNX700';
  if (/ACTUAL\s+USE|MANUFACTUR|PROCESSING|CAPTIVE|OWN\s+USE|FACTORY|PRODUCTION|ASSEMBL/.test(t)) return 'GNX200';
  if (/TRADING|RESALE|RE-SALE|FOR\s+SALE|WHOLESALE|RETAIL|DISTRIBUTION/.test(t)) return 'GNX100';
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Bonds and certificates
 * ------------------------------------------------------------------ */

/**
 * The 25 ICES bond codes, from `<TABLE>BOND` field 8.
 *
 * Source: `BE Message format 2.25 (16Feb2026).pdf` p.31 — a published list, so
 * this table is settled rather than CONFIRM. `BONDS_CERTIFICATES.Bond_Cert_Type`
 * takes one of these on a `B` row; ICES error 501 is anything else.
 *
 * `EB` is deliberately absent. An eBond declares its **purpose code** in this
 * column instead (`EBOND_PURPOSE_CODES`), which ICES 553 says in as many
 * words: "Invalid Bond code EB, instead use purpose code".
 */
export const BOND_CODES: Record<string, string> = {
  PD: 'Provisional Duty Bond',
  EU: 'End Use Bond',
  RE: 'Re-Export Bond',
  TB: 'Test Bond',
  LG: 'Letter of Guarantee',
  UT: 'Undertaking',
  TP: 'Transshipment Bond',
  IT: 'ITC Bond',
  WH: 'Warehouse Bond',
  EC: 'EPCG Bond',
  EZ: 'EPZ Bond',
  DE: 'DEEC Bond',
  PJ: 'Project Bond',
  CD: 'Cash Deposit',
  EO: 'EOU Bond',
  JB: 'Jobbing',
  PI: 'Project Import Bond',
  NB: 'Common Bond for EP Schemes',
  EI: 'IGCR Bond',
  SZ: 'SEZ Bond',
  PG: 'Provisional Duty Bond Global for SEZ',
};

/**
 * The eBond purpose codes, which stand in for a bond code when the security is
 * an eBond. Spec p.31, the same table as above.
 *
 * They carry no published expansions — the spec prints the grid and nothing
 * else — so this is a set, not a lookup.
 */
export const EBOND_PURPOSE_CODES: readonly string[] = [
  'D1', 'D2',
  'E1', 'E2', 'E3', 'E4', 'EZ',
  'M1', 'MZ',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'PA', 'PB', 'PZ',
  'R1', 'R2', 'RZ',
  'S1', 'SW',
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'WA', 'WZ',
];

/** Whether a value may appear in `Bond_Cert_Type` on a `B` row. */
export function isBondCode(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toUpperCase();
  return v in BOND_CODES || EBOND_PURPOSE_CODES.includes(v);
}

/**
 * Certificate types, from `<TABLE>CERT` field 9. `C(2)`.
 *
 * **CONFIRM.** Unlike the bond codes there is no published list: the spec names
 * exactly one value, `EI` for IGCR, and scopes the table to "BEs having EOU and
 * job items only" where a Central Excise certificate stands in for a bond.
 *
 * `MS` is here because `ex_job31` filed four of them — the DGCA import NOCs for
 * I-20271, numbered NOC/2026/000004873..876. Nothing says what it expands to;
 * "Miscellaneous" is a guess and is recorded as one. It is accepted when an
 * operator chooses it and is never proposed.
 * See docs/boe-mapping/open-questions.md#cert-type-ms.
 */
export const CERTIFICATE_TYPES: Record<string, string> = {
  EI: 'IGCR — the IIN issued against Form IGCR-1',
  MS: 'Observed on ex_job31 against a DGCA import NOC; expansion unknown',
};

/** Whether a value may appear in `Bond_Cert_Type` on a `C` row. */
export function isCertificateType(value: string | null | undefined): boolean {
  return !!value && value.trim().toUpperCase() in CERTIFICATE_TYPES;
}
