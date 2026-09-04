/**
 * Global + tenant masters, seeded from the two reference jobs.
 * In production these move to Postgres tables (global vs tenant-scoped);
 * the lookup API in masters/index.ts is the stable interface.
 *
 * The four reference lists — foreign ports, Indian custom houses, airlines and
 * ISO alpha-3 country codes — and the two standing CBIC duty notifications are
 * generated from the source documents in `masters-source/` by
 * `scripts/build-masters.py` and imported below rather than typed out here.
 */

import { GENERATED_AIRLINES } from './generated/airlines.js';
import {
  GENERATED_BCD_CONDITIONS,
  GENERATED_BCD_EXEMPTIONS,
  GENERATED_BCD_UNAPPLIED,
} from './generated/bcd-exemptions.js';
import {
  GENERATED_COMP_CESS_SCHEDULE,
  GENERATED_COMP_CESS_UNAPPLIED,
} from './generated/comp-cess-schedule.js';
import { GENERATED_CUSTOM_HOUSES } from './generated/custom-houses.js';
import { GENERATED_FOREIGN_PORTS } from './generated/foreign-ports.js';
import { GENERATED_IGST_SCHEDULE } from './generated/igst-schedule.js';

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

/**
 * Column (2) of a CBIC notification: the codes an entry covers.
 *
 * It is not a code but a small language — "0207 25 00, 0207 27 00",
 * "5004 to 5006", "0910 [other than 0910 11 10, 0910 30 10]", "Any Chapter" —
 * which the build script flattens into digit prefixes. An entry covers a CTH
 * when one of its `include` prefixes opens that CTH and none of its `exclude`
 * prefixes does; the longest prefix that matches is the most specific entry.
 */
export interface TariffCodeSpec {
  /** Codes covered, digits only: '01', '0910', '01012100'. */
  include: string[];
  exclude?: string[];
  /** "Any Chapter", or "90 or any other Chapter" — the entry is not bounded by code. */
  anyChapter?: boolean;
  /** Column (2) verbatim, so a reviewer can check the flattening. */
  spec: string;
  /** Page of the source notification, for citations. */
  page: number;
}

/**
 * One entry of notification 9/2025-Integrated Tax (Rate), which since
 * 17 September 2025 is the whole IGST rate structure (it supersedes
 * 1/2017-IT(R)). Seven schedules, one rate each.
 */
export interface IgstScheduleEntry extends TariffCodeSpec {
  schedule: 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII';
  /** The schedule's rate, in per cent. */
  rate: number;
  serial: string;
  description: string;
}

/**
 * One entry of the Schedule to notification 1/2017-Compensation Cess (Rate).
 *
 * Fifty-six serials, of which fifty-five name tobacco, coal, aerated waters,
 * motor vehicles, motorcycles, aircraft and yachts. The fifty-sixth is "any
 * chapter, all other goods, Nil" — the answer for everything else, and so the
 * answer for almost every consignment this system files.
 *
 * `rate` is the number only when column (4) states a plain percentage. Cess on
 * cigarettes and coal is specific or compound ("Rs.400 per tonne", "5% +
 * Rs.2126 per thousand"), which `computeItemDuty` cannot express — it applies a
 * percentage to the IGST base and nothing else. Those entries keep `rateText`
 * and leave `rate` null rather than flatten to a percentage that is wrong.
 */
export interface CompCessEntry extends TariffCodeSpec {
  serial: string;
  description: string;
  /** Ad valorem per cent, or null for a specific or compound rate. */
  rate: number | null;
  /** Column (4) verbatim: "12%", "Nil", "Rs.400 per tonne". */
  rateText: string;
  /**
   * The entry turns on whether the goods bear a brand name (Explanation (3) of
   * the notification). Serials 5/6, 19/20 and 36/37/38 differ by nothing else,
   * so a code lookup alone cannot separate them.
   */
  brandSensitive?: boolean;
}

/**
 * One entry of notification 45/2025-Customs — the effective BCD (and where
 * stated IGST and compensation cess) rate for goods that match its
 * description, subject to its condition.
 *
 * `bcdRate` is the numeric rate when the cell states exactly one. Entries
 * whose S.No. covers several sub-items stack a rate per sub-item in the same
 * cell ("15% 35% 70% 70%"); those keep `bcdRateText` and leave `bcdRate` null
 * rather than flatten to a rate that is right for one sub-item only. A rate
 * text of "-" means no concession — the First Schedule rate stands.
 */
export interface BcdExemptionEntry extends TariffCodeSpec {
  table: 'I' | 'II' | 'III' | 'IV';
  serial: string;
  description: string;
  bcdRate: number | null;
  bcdRateText: string;
  igstRate: number | null;
  igstRateText: string;
  compCessRateText?: string;
  /** Column (6)/(7) verbatim, so a reviewer can check it against the page. */
  condition: string | null;
  /**
   * The condition numbers that cell cites, in first-seen order and de-duplicated.
   *
   * Separate from `condition` because that cell is a little language, not a
   * number — "2 and 3", or "3 and 19 3 3 3" where one serial stacks four
   * sub-items. Callers need something to look up, not something to re-parse.
   */
  conditions: string[];
  /**
   * The end uses a single serial enumerates, when it carries several.
   *
   * S.No. 160 is the shape: wood pulp is Nil for newsprint, Nil for paper and
   * paperboard, Nil for adult diapers and 2.5% for the rest of heading 9619 —
   * four rates and four condition sets in one row. At the entry level that has
   * no rate (`bcdRate` is null), so the concession is unclaimable until the
   * sub-item is chosen; which one applies turns on what the goods are for.
   *
   * Absent when the entry has a single rate, and absent when the counts did
   * not reconcile — the build refuses to guess a correspondence rather than
   * risk a wrong duty rate.
   */
  subEntries?: BcdSubEntry[];
  /**
   * Amendments already folded into this entry — a sunset date moved, a rate
   * substituted. Recorded so the entry says where it differs from the base PDF.
   */
  /**
   * The date the concession lapses, from the entry's own proviso.
   *
   * A fact about the entry rather than a sentence in it, because whether it
   * has passed depends on when the Bill of Entry is filed — and because an
   * amendment moves it. 02/2026 moved 93 of these from 2026 to 2028.
   */
  validUntil?: string;
  amendedBy?: string[];
  /**
   * Amendments that touch this entry but could not be applied mechanically.
   *
   * The entry we hold is no longer what the notification says, so **its rate
   * must not be applied**: it is a prompt to read the amendment, not an answer.
   */
  staleBy?: string[];
}

/**
 * An amendment instruction that could not be applied to the masters.
 *
 * `kind` says why: `insert` and `replace` carry new text only a person can
 * read; `column3` rewrites a description; `condition` changes which conditions
 * bind; `list` amends one of the appended Lists, which are not parsed; `page`
 * is a corrigendum against a printed page and cannot be located by serial at
 * all.
 */
export interface BcdAmendmentInstruction {
  notification: string;
  /** ISO date the amendment was issued. */
  date: string;
  kind: 'insert' | 'replace' | 'column3' | 'condition' | 'list' | 'page';
  /** The serial it names, where it names one. */
  serial?: string;
}

/** One enumerated end use within an exemption entry, with its own rate. */
export interface BcdSubEntry {
  /** The roman numeral as the notification prints it: 'i', 'ii', … */
  label: string;
  /** The end use, e.g. 'paper and paperboard'. */
  text: string;
  bcdRate: number | null;
  bcdRateText: string;
  /** Conditions for this sub-item alone — empty where column (6) reads '-'. */
  conditions: string[];
}

/**
 * What a condition demands of the importer.
 *
 * A condition is prose, but it is prose about a small number of things, and
 * what it demands decides who has to do something about it: `certificate`
 * becomes a document to chase, `end-use-declaration` becomes a paragraph we
 * draft, `igcr` becomes a registration and a bond that must already exist.
 *
 * Measured over 45/2025: `igcr` reaches 120 of the 286 conditional entries,
 * `certificate` 70, `importer-type` 55 — 80% between them. `other` is the
 * long tail and is meant to be read by a person.
 */
export type ConditionKind =
  | 'igcr'
  | 'certificate'
  | 'registration'
  | 'importer-type'
  | 'end-use-declaration'
  | 'export-obligation'
  | 'time-limit'
  | 'bond'
  | 'bank-guarantee'
  | 'quantity-value-cap'
  | 'contract-registration'
  | 'payment-mode'
  | 'direct-shipment'
  | 'other';

export interface BcdConditionMaster {
  table: 'I' | 'II' | 'III' | 'IV';
  no: string;
  /** What it demands. A condition can demand several things at once. */
  kinds: ConditionKind[];
  text: string;
}

/**
 * Notification 9/2025-Integrated Tax (Rate) in the ICES "009/2025" form, the
 * shape a Bill of Entry files it as. In force from 22 September 2025.
 */
export const IGST_RATE_NOTIFICATION = '009/2025';

/**
 * Notification 45/2025-Customs in the ICES "045/2025" form. In force from
 * 1 November 2025; a corrigendum of 31 October 2025 corrects one condition
 * code (C-140 to C-130) and is not otherwise reflected here.
 */
export const BCD_EXEMPTION_NOTIFICATION = '045/2025';

/** Every entry of the seven IGST schedules, in notification order. */
export const IGST_SCHEDULE: IgstScheduleEntry[] = GENERATED_IGST_SCHEDULE;

/** Every entry of Tables I to IV of the BCD exemption notification. */
export const BCD_EXEMPTIONS: BcdExemptionEntry[] = GENERATED_BCD_EXEMPTIONS;

/** The conditions in the annexures, cited by column (6)/(7) of the tables. */
export const BCD_CONDITIONS: BcdConditionMaster[] = GENERATED_BCD_CONDITIONS;

/**
 * Amendments to 45/2025 that these masters do not carry.
 *
 * Not a backlog to feel bad about — a published gap. The base notification is
 * wrong about a third of its entries within four months of issue, so the
 * honest position is to say which parts we have not caught up with rather than
 * to present the base text as current.
 */
export const BCD_UNAPPLIED_AMENDMENTS: BcdAmendmentInstruction[] = GENERATED_BCD_UNAPPLIED;

/**
 * Schedule II's residual entry: "Goods which are not specified in Schedule I,
 * III, IV, V, VI or VII". A CTH that no other entry names is taxed at 18% by
 * this one, so a lookup that finds nothing has still found the answer.
 */
export const IGST_RESIDUAL_ENTRY: IgstScheduleEntry =
  IGST_SCHEDULE.find(
    (e) => e.schedule === 'II' && /^Goods which are not specified in Schedule/i.test(e.description),
  ) ?? { schedule: 'II', rate: 18, serial: '639', include: [], anyChapter: true, spec: 'Any Chapter', description: 'Goods which are not specified in Schedule I, III, IV, V, VI or VII', page: 0 };

/**
 * Notification 1/2017-Compensation Cess (Rate) in the ICES "001/2017" form.
 * In force from 1 July 2017.
 */
export const COMP_CESS_NOTIFICATION = '001/2017';

/** All 56 entries of its Schedule, in notification order. */
export const COMP_CESS_SCHEDULE: CompCessEntry[] = GENERATED_COMP_CESS_SCHEDULE;

/**
 * S.No. 56: "Any chapter — All goods other than those mentioned at S. Nos. 1 to
 * 55 above — Nil". A CTH that none of the other fifty-five names bears no cess
 * by this entry, so a lookup that finds nothing has still found the answer, and
 * `001/2017` / `56` is what the Bill of Entry declares.
 */
export const COMP_CESS_RESIDUAL_ENTRY: CompCessEntry =
  COMP_CESS_SCHEDULE.find((e) => e.serial === '56' && e.anyChapter === true) ?? {
    serial: '56',
    include: [],
    anyChapter: true,
    spec: 'Any chapter',
    description: 'All goods other than those mentioned at S. Nos. 1 to 55 above',
    rate: 0,
    rateText: 'Nil',
    page: 4,
  };

/**
 * Amendments to 1/2017 that these masters do not carry.
 *
 * Published as a gap for the same reason `BCD_UNAPPLIED_AMENDMENTS` is: every
 * one of the nineteen moves a rate on tobacco, coal or motor vehicles, so any
 * named entry this master returns is a candidate to check rather than a rate to
 * file. None of them touches S.No. 56 — an amendment cannot make unlisted goods
 * cessable without adding a fifty-seventh serial, which the build would catch.
 */
export const COMP_CESS_UNAPPLIED_AMENDMENTS: string[] = GENERATED_COMP_CESS_UNAPPLIED;

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
