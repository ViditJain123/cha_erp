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

  /* ---------- from the printed tariff book (BDP 2026-27), all optional ---------- */

  /**
   * First Schedule statutory BCD, before any notification.
   *
   * `bcdRate` mirrors this rather than the effective rate on purpose: a
   * concession sits ON TOP of the tariff rate, and packages/extraction applies
   * 45/2025 itself. Seeding `bcdRate` with the post-exemption figure would
   * apply the concession twice.
   */
  basicBcdRate?: number;
  /** BCD left after the exemption notification `notificationRefs` names. */
  effectiveBcdRate?: number;
  /** The book's PRE. column: preferential BCD, where one is printed. */
  prefBcdRate?: number;
  /**
   * Social Welfare Surcharge as a *rate on BCD* — 10, or 0 where the goods are
   * surcharge-exempt. Never the book's printed SWS column, which is already a
   * percentage of assessable value (0.75 against a 7.5% BCD) and would
   * understate the surcharge by 92.5% if used as a rate.
   */
  swsRate?: number;
  /** The printed SWS column, kept only so the checksum can be re-run. */
  swsOfAv?: number;
  /** The printed TOTAL: whole duty incidence as a percentage of AV. */
  totalIncidencePercent?: number;
  /** Rate expressed in words where it is not a single ad-valorem figure —
   *  "20% or Rs.X per piece, whichever is higher". No number is invented. */
  rateText?: string;
  /** DGFT ITC(HS) policy. Anything but 'Free' needs an authorisation to file. */
  impPolicy?: string;
  expPolicy?: string;
  /** The REMARKS column verbatim, so a reviewer can check the parse. */
  remarks?: string;
  /** Exemption notifications the row cites, the join from Vol I into Vol II. */
  notificationRefs?: TariffNotificationRef[];
  /**
   * Concessional rates the book prints beneath the row for a narrower
   * description of the goods ("SPF Polychaete worms"), each under the
   * notification it comes from. A candidate list, not a rate that applies.
   */
  concessions?: TariffConcession[];
  /**
   * Other rates printed against the same code. 03069100 carries both nil and
   * 5% IGST, and both reconcile — the state of the goods decides. Present
   * means the description has to settle it.
   */
  variants?: TariffVariant[];
  provenance?: TariffProvenance;
}

export interface TariffNotificationRef {
  /** As printed: '45/2025-Cus.' */
  printed: string;
  /** Normalised to the form the masters use: '045/2025', or '044/2025-26' for DGFT. */
  notification: string;
  serial?: string;
  /** CBIC or DGFT — they share numbers and years, so this is what tells them apart. */
  authority?: 'CBIC' | 'DGFT';
}

export interface TariffConcession {
  notification: string;
  printed: string;
  description: string;
  effectiveBcdRate?: number;
  igstRate?: number;
  remarks?: string;
}

export interface TariffVariant {
  description: string;
  basicBcdRate?: number;
  effectiveBcdRate?: number;
  igstRate?: number;
  totalIncidencePercent?: number;
  page: number;
}

/** Where a tariff row came from, and how far it can be trusted. */
export interface TariffProvenance {
  /**
   * 'seed' is hand-typed in this file, 'book' the printed tariff, 'learned'
   * written back from an approved job, 'reviewer' an admin edit.
   */
  source: 'seed' | 'book' | 'learned' | 'reviewer';
  /** Printed page, so a citation opens on the right page. */
  page?: number;
  edition?: string;
  /**
   * 'verified' — the row's rates reconcile against its printed TOTAL.
   * 'repaired' — they reconcile once a lost decimal point is restored.
   * 'unverified' — nothing reconciled. Propose it; never apply it silently.
   */
  confidence?: 'verified' | 'repaired' | 'unverified';
  /** The job a 'learned' row was taken from. */
  learnedFrom?: string;
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

/**
 * What makes a declaration apply, and so which rows of the STATEMENT table it
 * becomes. Each trigger is read off the Logi-Sys checklists of ex_job1–6 and
 * liv_job1; docs/boe-mapping/07-statement.md carries the evidence per code.
 *
 *   - `job`           once for the whole Bill of Entry, at (0,0)
 *   - `invoice`       once per invoice, at (inv,0)
 *   - `chemical`      per line whose CTH is in a chemical chapter
 *   - `drug-category` per line carrying a Single Window "Drug Related Category"
 *   - `fta`           per line claiming a preferential (FTA) notification
 */
export type DeclarationTrigger = 'job' | 'invoice' | 'chemical' | 'drug-category' | 'fta';

export interface DeclarationMaster {
  code: string;
  text: string;
  trigger: DeclarationTrigger;
}

/**
 * The scope of the chemical declaration: chapters 28, 29, 32 and 39, and
 * heading 3808.
 *
 * **Circular 15/2023-Customs dated 07.06.2023**, as amended by **Circular
 * 23/2023-Customs dated 30.09.2023** para 4.1, mandatory for every bill of
 * entry filed on or after **15.10.2023**. The original said "chapters 28, 29,
 * 32, 38 and 39"; the amendment narrowed chapter 38 to heading 3808 alone, so
 * a line in 38170011 or 38249900 is *not* in scope and must not carry the
 * rows — ICES 877 / 931 (*Invalid declaration of mandatory additional
 * qualifier*).
 *
 * This decides two things at once, which is why it is one master and not two:
 * the `CTG/CPC` + `IDT/CAS` + `PNM/IUP` rows on SW_ADDL_INFO, and `PC002` on
 * STATEMENT.
 *
 * It replaces a `[28, 40]` range inferred from three checklists. The eight
 * Logi-Sys workbooks settle it: `PC002` is filed on exactly the lines that
 * carry a `CPC` row and on no others, eight for eight, and `ex_job21`
 * (chapter 34) files neither — which is the direct counter-example to 28–40.
 * `ex_job1`, also chapter 34, filed `PC002` on item 1 and not on item 2 of the
 * same CTH, so the checklist contradicts itself and the workbooks win.
 *
 * Contract: docs/boe-mapping/11-sw-addl-info.md.
 */
export const CHEMICAL_CHAPTERS: number[] = [28, 29, 32, 39];

/** The one heading of chapter 38 that is in scope, and the only one. */
export const CHEMICAL_HEADINGS: string[] = ['3808'];

/** Whether a line's tariff code carries the chemical declaration. */
export function isChemicalDeclarationCth(ritc: string | undefined | null): boolean {
  const digits = (ritc ?? '').replace(/\D/g, '');
  if (digits.length < 4) return false;
  if (CHEMICAL_HEADINGS.includes(digits.slice(0, 4))) return true;
  return CHEMICAL_CHAPTERS.includes(Number(digits.slice(0, 2)));
}

/**
 * `CTG` / `CPC` — the chemical category, and what declaring it then obliges.
 *
 * Codes from the DG Systems advisory reproduced in JNCH Public Notice 95/2023
 * (F.No. S/22-GEN-133/2017-18/AM(I)), which is the only document that states
 * the info_type / info_qfr / info_code triple outright. The obligations are
 * Circular 23/2023 para 4.1(b), verbatim.
 *
 * `CPCBB` and `CPCPR` are both in the corpus. `CPCFM` is attested only by the
 * advisory — no filing we hold uses it.
 */
export interface ChemicalCategory {
  code: string;
  label: string;
  /** Whether both CAS and IUPAC are required, or either one will do. */
  requires: 'both' | 'either';
  /** Whether the requirement is per constituent rather than for the article. */
  perIngredient: boolean;
}

export const CHEMICAL_CATEGORIES: ChemicalCategory[] = [
  { code: 'CPCBB', label: 'Bulk and Basic Chemicals', requires: 'both', perIngredient: false },
  { code: 'CPCFM', label: 'Formulations and Mixtures', requires: 'both', perIngredient: true },
  {
    code: 'CPCPR',
    label: 'Proprietary component, R&D or Others',
    requires: 'either',
    perIngredient: true,
  },
];

/**
 * `CHR` / `HZRDS` — the 51 tariff items of Annexure-A to **Circular
 * 24/2026-Customs dated 14.05.2026**, implemented across all customs
 * formations by **01.07.2026**.
 *
 * The annexure lists 68 goods and 51 distinct CTHs; several trade descriptions
 * share a heading (four different nitriles sit in 29269090) and two are the
 * same description twice. Chapters 28 and 29, plus heading 3808.
 *
 * **Per CTH, not per chapter.** The circular's own wording — "if the goods
 * being imported fall under the corresponding Chapters mentioned in
 * Annexure-A" — reads as though it were chapter-wide, and the corpus says
 * otherwise: three chapter-29 Bills of Entry filed after the mandate, and only
 * `ex_job17` (29269090, acetonitrile, sl. 19) carries the row. `ex_job15`
 * (29091990) and `ex_job23` (29321100) are not on the list and carry none.
 * A chapter-wide rule would have put a spurious row on two accepted filings.
 */
export const HAZARDOUS_CTHS: ReadonlySet<string> = new Set([
  '28013020', '28152000', '28251020', '28251090',
  '29011000', '29032200', '29032900', '29032990', '29036900', '29039110', '29039990',
  '29041090', '29049090', '29049990', '29051210', '29051490', '29051990', '29052900',
  '29055990', '29093090', '29094990', '29121990', '29122100', '29141300', '29151100',
  '29154010', '29161100', '29161290', '29171400', '29209090', '29211190', '29211990',
  '29212910', '29212990', '29215110', '29222913', '29222990', '29252990', '29269000',
  '29269090', '29280090', '29291090', '29309099', '29319090', '29321300', '29321990',
  '29335990', '29339990', '29349990',
  '38089199', '38089399',
]);

/** Whether a line's tariff code is on Annexure-A of Circular 24/2026. */
export function isHazardousCth(ritc: string | undefined | null): boolean {
  const digits = (ritc ?? '').replace(/\D/g, '');
  return digits.length === 8 && HAZARDOUS_CTHS.has(digits);
}

/** In the order Logi-Sys prints them within one scope. */
export const DECLARATIONS: DeclarationMaster[] = [
  {
    code: 'CUG00',
    trigger: 'job',
    text: 'I/We declare that the contents of this Bill of Entry for goods imported against above mentioned Bill of Lading/ Airway Bill /Lorry Receipt/Railway Receipt numbers are in accordance with the above mentioned invoice(s) No(s)and other documents presented herewith.',
  },
  {
    code: 'CUG01',
    trigger: 'job',
    text: 'I/We declare that the contents of the above mentioned invoice(s) and documents are true and correct in every respect.I/We have not received and do not know of any other documents or information showing a different description, quantity, price, value, of the said goods and that if at any time hereafter I/We discover any document / information showing different facts, I/We will immediately make the same known to the Commissioner of Customs.',
  },
  {
    code: 'CUV01',
    trigger: 'invoice',
    text: 'I/We declare that all conditions or restrictions, if any, imposed by the seller of any third party on the disposition or use of the imported goods [as per proviso to Rule 3(2)) of the Customs Valuation Rules, 2007] are specified above.',
  },
  {
    code: 'CUV02',
    trigger: 'invoice',
    text: 'I/We declare that the price paid or payable by the importer is as per the details provided above, and any price paid or payable in addition to the above will be settled with the seller at the end of a defined period by means of debit note / credit note (post – import price adjustment), which are as per the contract attached as a supporting document.',
  },
  {
    code: 'CUV03',
    trigger: 'invoice',
    text: 'I/We declare that there are no payments actually paid or payable for the imported goods by way of cost and services [in terms of Rules 10(1)(a)(i), Rule 10(1)(a)(ii), Rule 10 (1) (a) (iii) and Rule 10 (1) (b) of Customs Valuation Rules, 2007], Royalty / Licence Fee / subsequent resale or use of goods /other payment as a condition of sale [(Please see Rule 10 (1) (c), (d) & (e) of Customs Valuation Rules, 2007] other than those declared in the invoice which are mentioned as miscellaneous charges in this Bill of Entry.',
  },
  {
    code: 'PC002',
    // Filed even when the CAS number is declared (ex_job6, liv_job1).
    trigger: 'chemical',
    text: 'I certify that the information related to IUPAC & CAS number is not in my possession as the same is not provided by my supplier due to confidentiality',
  },
  {
    code: 'DC007',
    // Not food in general: ex_job3's sesame carried FSSAI rows and no DC007.
    trigger: 'drug-category',
    text: 'I/We the importer of this consignment undertake that the drug/cosmetic packages seal for this item is intact, the packaging is not damaged/broken/destroyed and the content of drug/cosmetic has not deteriorated.',
  },
  {
    code: 'CUF02',
    trigger: 'fta',
    text: 'I/We declare that these goods qualify as originating goods for preferential rate of duty under the Customs (Administration of Rules of Origin under Trade Agreements) Rules, 2020 notified vide Customs Notification No. 81/2020 - Customs (N.T.) dated 21.08.2020.',
  },
];

/**
 * How the goods left India, as the shipping bill's Part-I summary declares it.
 *
 * Each one selects an entry of the re-import notification, and the entry is
 * what decides how much duty comes back with the goods. The names are ours; the
 * shipping bill prints `DBK`, `RoDTEP`, `MEIS`, `LICENCE`, `DFRC`, `RE-EXP` and
 * `LUT` across one row of Y/N boxes.
 */
export type ReImportExportScheme =
  /** DBK on the shipping bill — drawback of Union customs or excise duty. */
  | 'drawback'
  /** Drawback of a State excise duty. */
  | 'stateDrawback'
  /** Exported on payment of IGST with a refund claimed. */
  | 'igstRefund'
  /** Exported under bond or LUT without paying IGST. */
  | 'bond'
  /** Rebate of Central excise duty — the 46/2017 and 94/96 counterpart of `igstRefund`. */
  | 'exciseRebate'
  /** Bond without payment of Central excise duty — the counterpart of `bond`. */
  | 'exciseBond'
  /** DEEC, Advance Authorisation, DFIA or EPCG: the SB's LICENCE and DFRC flags. */
  | 'dutyExemptionScheme'
  /** Duty Entitlement Passbook. Only 94/96 has an entry for it. */
  | 'depb'
  | 'rodtep'
  | 'roSctl'
  /** Sent out to be repaired abroad, now coming back repaired. */
  | 'repairsAbroad'
  | 'stonesTreatedAbroad'
  | 'sezAircraftParts'
  /** 158/95: coming back to be repaired here, then re-exported. */
  | 'repairsInIndia'
  | 'reprocessingInIndia'
  /** Nothing was claimed at export — the residuary entry. */
  | 'none';

/**
 * One entry of a re-import notification — a row of its Table.
 *
 * `serial` is what `RE-IMPORT.Notn_SrNo` carries, and it is a string because
 * Sl. No. 1 is sub-divided: Logi-Sys writes clause (e) as `1E`
 * (`ex_job29/JobData_I-14385_26-27_20260907_165024.xlsx`, corroborated by the
 * `ex_job3` and `ex_job4` checklists).
 *
 * `exportFreightInsurance` and `incentiveRepayment` are not presentation: ICES
 * validates the money columns against the entry in both directions, and
 * rejects the filing either way (errors 353/355 for freight and insurance,
 * 354/356/357 for the duty amounts).
 */
export interface ReImportEntry {
  /** `NNN/YYYY`, the form `logisysNotn()` produces. */
  notification: string;
  serial: string;
  /** The notification's own words, column (2) of its Table. */
  description: string;
  /** The notification's own words, column (3) — what is payable on re-import. */
  amountPayable: string;
  /** The export this entry answers to. */
  scheme: ReImportExportScheme;
  /** RE-IMPORT columns 10 and 11. */
  exportFreightInsurance: 'required' | 'forbidden';
  /** RE-IMPORT columns 12, 13 and 15. */
  incentiveRepayment: 'required' | 'forbidden';
  /** Months from the shipping bill's date within which the goods must return. */
  timeLimitMonths: number;
  /** Further months a Principal Commissioner or Commissioner may allow. */
  extensionMonths: number;
  /** Earliest s.51 LEO date the notification covers, when it is time-bounded. */
  leoFrom?: string;
  /** Latest s.51 LEO date the notification covers. */
  leoUntil?: string;
  source: string;
}

/**
 * The re-import notifications, entry by entry.
 *
 * Transcribed from the notification texts in
 * `data/customs-corpus/text/notification.jsonl`. This is a small table of legal
 * wording that changes a few times a decade, so it is maintained here rather
 * than parsed out of a PDF like the tariff schedules — but every entry names
 * the notification and Sl. No. it came from, and the wording is the
 * notification's own.
 *
 * Which notification applies is decided before the entry is, and it is not a
 * preference:
 *
 *   - **45/2017** is the integrated-tax side: the export claimed drawback, an
 *     IGST refund, went under bond without paying IGST, went under a duty
 *     exemption scheme, or claimed RoDTEP or RoSCTL.
 *   - **46/2017** is the same table on the Central Excise side — its clauses
 *     (c) and (d) are rebate of Central excise duty and bond without payment of
 *     Central excise duty. It is the one to use where the export leg's
 *     incentive was excise-based, which after July 2017 means Fourth Schedule
 *     goods. It supersedes 94/96.
 *   - **94/96** governs exports from before that supersession. 45/2017's own
 *     paragraph 2 says it applies only where the order permitting clearance
 *     under section 51 was given on or after 1 July 2017, so an older shipping
 *     bill cannot use it.
 *   - **158/95** is the other direction entirely: Indian goods coming back *to
 *     be* repaired or reprocessed here and then re-exported, against a bond.
 *
 * And 45/2017 and 46/2017 do not apply at all — their second proviso — to goods
 * that were exported by a 100% EOU or a unit in a Free Trade Zone, exported
 * from a warehouse, or that fall under the Fourth Schedule to the Central
 * Excise Act.
 */
export const RE_IMPORT_NOTIFICATIONS: ReImportEntry[] = [
  // --------------------------------------------------------- 45/2017 ----
  // Clauses (a)-(e) are the 2017 original; (f) and (g) were inserted by
  // 46/2023-Customs. 36/2021-Customs replaced "Duty of customs" with "Said
  // duty, tax or cess" in Sl. 2 and 3 — those two carry IGST and compensation
  // cess on the repair value as well as BCD. Circular 16/2021 explains why.
  {
    notification: '045/2017',
    serial: '1A',
    description:
      'Goods exported under claim for drawback of any customs or excise duties levied by the Union',
    amountPayable:
      'Amount of drawback of customs or excise duties allowed at the time of export',
    scheme: 'drawback',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 1(a)',
  },
  {
    notification: '045/2017',
    serial: '1B',
    description:
      'Goods exported under claim for drawback of any excise duty levied by a State',
    amountPayable:
      'Amount of excise duty leviable by State at the time and place of importation of the goods',
    scheme: 'stateDrawback',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 1(b)',
  },
  {
    notification: '045/2017',
    serial: '1C',
    description:
      'Goods exported under claim for refund of integrated tax paid on export goods',
    amountPayable:
      'Amount of refund of integrated tax availed at the time of export',
    scheme: 'igstRefund',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 1(c)',
  },
  {
    notification: '045/2017',
    serial: '1D',
    description:
      'Goods exported under bond without payment of integrated tax',
    amountPayable:
      'Amount of integrated tax not paid',
    scheme: 'bond',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 1(d)',
  },
  // The twelve months come from the proviso's clause (c), which names DEEC,
  // Advance Authorisation, DFIA, EPCG, DEPB and any Chapter-3 reward scheme.
  //
  // `incentiveRepayment` is 'forbidden' even though an amount is payable,
  // because the amount is the integrated tax and cess *leviable at the time and
  // place of importation* — the ordinary duty on this Bill of Entry, which the
  // duty engine computes and ITEMS carries. It is not a figure repaid out of
  // the export. ex_job29 is exactly this entry and writes 0.00 in all six of
  // RE-IMPORT's money columns while its checklist charges IGST on the goods.
  {
    notification: '045/2017',
    serial: '1E',
    description:
      'Goods exported under duty exemption scheme (DEEC/ Advance Authorisation/ DFIA) or Export Promotion Capital Goods Scheme (EPCG)',
    amountPayable:
      'Amount of integrated tax and compensation cess leviable at the time and place of importation of goods, subject to the DEEC book not being finally closed and the export being de-logged, the Advance Authorisation or DFIA not redeemed, the EPCG export performance period not expired, the re-import being intimated to the jurisdictional Assistant or Deputy Commissioner and to the licensing authority, and a transit bond where the goods clear without payment',
    scheme: 'dutyExemptionScheme',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 12,
    extensionMonths: 12,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 1(e)',
  },
  // RoDTEP and RoSCTL are remission schemes, not the Chapter-3 reward schemes
  // (MEIS, SEIS) the one-year proviso names, so the general three years applies.
  {
    notification: '045/2017',
    serial: '1F',
    description:
      'Goods exported under claim for Remission of Duties and Taxes on Exported Products (RoDTEP)',
    amountPayable:
      'Amount of RoDTEP allowed at the time of export',
    scheme: 'rodtep',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs as amended by 46/2023-Customs, Table Sl. No. 1(f)',
  },
  {
    notification: '045/2017',
    serial: '1G',
    description:
      'Goods exported under claim for Rebate of State and Central Taxes and Levies (RoSCTL)',
    amountPayable:
      'Amount of RoSCTL allowed at the time of export',
    scheme: 'roSctl',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs as amended by 46/2023-Customs, Table Sl. No. 1(g)',
  },
  // The entry the customer's note about freight and insurance certificates is
  // about. Its proviso adds a condition of its own: no change in ownership of
  // the goods between export and re-import.
  {
    notification: '045/2017',
    serial: '2',
    description:
      'Goods, other than those falling under Sl. No. 1, exported for repairs abroad',
    amountPayable:
      'Said duty, tax or cess which would be leviable if the value of the re-imported goods after repairs were made up of the fair cost of repairs carried out including cost of materials used in repairs (whether such costs are actually incurred or not), insurance and freight charges, both ways',
    scheme: 'repairsAbroad',
    exportFreightInsurance: 'required',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs as amended by 36/2021-Customs, Table Sl. No. 2',
  },
  {
    notification: '045/2017',
    serial: '3',
    description:
      'Cut and polished precious and semi-precious stones exported for treatment abroad as referred to in Paragraph 4A.20.1 of the Foreign Trade Policy, other than those falling under Sl. No. 1',
    amountPayable:
      'Said duty, tax or cess which would be leviable if the value of the re-imported stones after treatment were made up of the fair cost of treatment carried out including cost of materials used, whether actually incurred or not, insurance and freight charges, both ways',
    scheme: 'stonesTreatedAbroad',
    exportFreightInsurance: 'required',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs as amended by 36/2021-Customs, Table Sl. No. 3',
  },
  {
    notification: '045/2017',
    serial: '4',
    description:
      'Parts and components of aircraft replaced or removed during the course of maintenance, repair or overhaul of the aircraft in a Special Economic Zone and brought to any other place in India',
    amountPayable:
      'Nil, provided the goods are returned to the owner of the aircraft without any sale',
    scheme: 'sezAircraftParts',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 4',
  },
  // Circular 21/2019-Customs puts exhibition and consignment returns here rather
  // than under 1(d), even though they went out under a LUT: taking them out of
  // India was never a supply, so no integrated tax was ever payable.
  {
    notification: '045/2017',
    serial: '5',
    description:
      'Goods other than those falling under Sl. No. 1, 2, 3 and 4',
    amountPayable:
      'Nil',
    scheme: 'none',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '45/2017-Customs, 30 June 2017, Table Sl. No. 5',
  },

  // --------------------------------------------------------- 46/2017 ----
  // The same table on the Central Excise side, in supersession of 94/96.
  // Only clauses (c) and (d) differ from 45/2017 — rebate of Central excise
  // duty, and bond without payment of Central excise duty — and it has no
  // RoDTEP or RoSCTL clause. 37/2021-Customs made the Sl. 2 and 3 amendment.
  {
    notification: '046/2017',
    serial: '1A',
    description:
      'Goods exported under claim for drawback of any customs or excise duties levied by the Union',
    amountPayable:
      'Amount of drawback of customs or excise duties allowed at the time of export',
    scheme: 'drawback',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 1(a)',
  },
  {
    notification: '046/2017',
    serial: '1B',
    description:
      'Goods exported under claim for drawback of any excise duty levied by a State',
    amountPayable:
      'Amount of excise duty leviable by State at the time and place of importation of the goods',
    scheme: 'stateDrawback',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 1(b)',
  },
  {
    notification: '046/2017',
    serial: '1C',
    description:
      'Goods exported under claim for rebate of Central excise duty',
    amountPayable:
      'Amount of rebate of Central Excise duty availed at the time of export',
    scheme: 'exciseRebate',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 1(c)',
  },
  {
    notification: '046/2017',
    serial: '1D',
    description:
      'Goods exported under bond without payment of Central Excise duty',
    amountPayable:
      'Amount of Central Excise duty not paid',
    scheme: 'exciseBond',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 1(d)',
  },
  {
    notification: '046/2017',
    serial: '1E',
    description:
      'Goods exported under duty exemption scheme (DEEC/ Advance Authorisation/ DFIA) or Export Promotion Capital Goods Scheme (EPCG)',
    amountPayable:
      'Amount of excise duty, or integrated tax and compensation cess, leviable at the time and place of importation of goods, subject to the same DEEC, Advance Authorisation, EPCG, intimation and transit bond conditions as 45/2017',
    scheme: 'dutyExemptionScheme',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 12,
    extensionMonths: 12,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 1(e)',
  },
  {
    notification: '046/2017',
    serial: '2',
    description:
      'Goods, other than those falling under Sl. No. 1, exported for repairs abroad',
    amountPayable:
      'Said duty, tax or cess which would be leviable if the value of the re-imported goods after repairs were made up of the fair cost of repairs carried out including cost of materials used in repairs (whether such costs are actually incurred or not), insurance and freight charges, both ways',
    scheme: 'repairsAbroad',
    exportFreightInsurance: 'required',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs as amended by 37/2021-Customs, Table Sl. No. 2',
  },
  {
    notification: '046/2017',
    serial: '3',
    description:
      'Cut and polished precious and semi-precious stones exported for treatment abroad as referred to in Paragraph 4A.20.1 of the Foreign Trade Policy, other than those falling under Sl. No. 1',
    amountPayable:
      'Said duty, tax or cess which would be leviable if the value of the re-imported stones after treatment were made up of the fair cost of treatment carried out, whether actually incurred or not, insurance and freight charges, both ways',
    scheme: 'stonesTreatedAbroad',
    exportFreightInsurance: 'required',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs as amended by 37/2021-Customs, Table Sl. No. 3',
  },
  {
    notification: '046/2017',
    serial: '4',
    description:
      'Parts and components of aircraft replaced or removed during the course of maintenance, repair or overhaul of the aircraft in a Special Economic Zone and brought to any other place in India',
    amountPayable:
      'Nil',
    scheme: 'sezAircraftParts',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 4',
  },
  {
    notification: '046/2017',
    serial: '5',
    description:
      'Goods other than those falling under Sl. No. 1, 2, 3 and 4',
    amountPayable:
      'Nil',
    scheme: 'none',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoFrom: '2017-07-01',
    source: '46/2017-Customs, 30 June 2017, Table Sl. No. 5',
  },

  // ---------------------------------------------------------- 94/96 ----
  // For exports whose section 51 clearance predates the supersession by
  // 46/2017. Its Sl. 2A, the DEPB entry, has no successor in either 2017
  // notification.
  {
    notification: '094/1996',
    serial: '1A',
    description:
      'Goods exported under claim for drawback of any customs or excise duties levied by the Union',
    amountPayable:
      'Amount of drawback of customs or excise duties allowed at the time of export',
    scheme: 'drawback',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 1(a)',
  },
  {
    notification: '094/1996',
    serial: '1B',
    description:
      'Goods exported under claim for drawback of any excise duty levied by a State',
    amountPayable:
      'Amount of excise duty leviable by State at the time and place of importation of the goods',
    scheme: 'stateDrawback',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 1(b)',
  },
  {
    notification: '094/1996',
    serial: '1C',
    description:
      'Goods exported under claim for rebate of Central excise duty',
    amountPayable:
      'Amount of rebate of Central Excise duty availed at the time of export',
    scheme: 'exciseRebate',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 1(c)',
  },
  {
    notification: '094/1996',
    serial: '1D',
    description:
      'Goods exported under bond without payment of Central excise duty',
    amountPayable:
      'Amount of Central Excise duty not paid',
    scheme: 'exciseBond',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 1(d)',
  },
  {
    notification: '094/1996',
    serial: '1E',
    description:
      'Goods exported under duty exemption scheme (DEEC) or Export Promotion Capital Goods Scheme (EPCG)',
    amountPayable:
      'Amount of excise duty leviable at the time and place of importation of goods, subject to the DEEC book not being finally closed, the EPCG export performance period not having expired, and the re-import being intimated to the jurisdictional Central Excise authority and the licensing authority',
    scheme: 'dutyExemptionScheme',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 12,
    extensionMonths: 12,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 1(e)',
  },
  {
    notification: '094/1996',
    serial: '2',
    description:
      'Goods, other than those falling under Sl. No. 1, exported for repairs abroad',
    amountPayable:
      'Duty of customs which would be leviable if the value of the re-imported goods after repairs were made up of the fair cost of repairs carried out including cost of materials used in repairs (whether actually incurred or not), insurance and freight charges, both ways',
    scheme: 'repairsAbroad',
    exportFreightInsurance: 'required',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 2',
  },
  {
    notification: '094/1996',
    serial: '2A',
    description:
      'Goods exported under the Duty Entitlement Passbook (DEPB) Scheme',
    amountPayable:
      'Amount of Central Excise duty leviable at the time and place of importation plus the drawback of excise duties allowed at export, subject to the importer producing the Duty Entitlement Passbook for debit of the DEPB credit permitted for the products exported',
    scheme: 'depb',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'required',
    timeLimitMonths: 12,
    extensionMonths: 12,
    leoUntil: '2017-06-30',
    source: '94/96-Customs as amended by 135/99-Customs, Table Sl. No. 2A',
  },
  {
    notification: '094/1996',
    serial: '3',
    description:
      'Goods other than those falling under Sl. Nos. 1 and 2',
    amountPayable:
      'Nil',
    scheme: 'none',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 24,
    leoUntil: '2017-06-30',
    source: '94/96-Customs, 16 December 1996, Table Sl. No. 3',
  },

  // --------------------------------------------------------- 158/95 ----
  // Goods that come back to be worked on here and then go out again.
  // Duty-free, against a bond — so these entries also mean a
  // BONDS_CERTIFICATES row, and the clock that matters afterwards is the
  // six months to re-export, not the limit for coming in.
  {
    notification: '158/1995',
    serial: '1',
    description:
      'Goods manufactured in India, and parts of such goods whether of Indian or foreign manufacture, re-imported into India for repairs or for reconditioning',
    amountPayable:
      'Nil, subject to re-importation within 3 years of export, re-export within 6 months of re-import (extendable by a further 6 months), the proper officer being satisfied as to the identity of the goods, and a bond undertaking to re-export and to pay the duty difference on failure',
    scheme: 'repairsInIndia',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 36,
    extensionMonths: 0,
    source: '158/95-Customs, 14 November 1995, Table Sl. No. 1',
  },
  {
    notification: '158/1995',
    serial: '2',
    description:
      'Goods manufactured in India and re-imported for reprocessing, refining, re-making or any similar process',
    amountPayable:
      'Nil, subject to re-importation within 1 year of export, re-export within 6 months of re-import (extendable by a further 6 months), the proper officer being satisfied as to the identity of the goods, and a bond covering the process, the accounting of the goods and any waste arising',
    scheme: 'reprocessingInIndia',
    exportFreightInsurance: 'forbidden',
    incentiveRepayment: 'forbidden',
    timeLimitMonths: 12,
    extensionMonths: 0,
    source: '158/95-Customs, 14 November 1995, Table Sl. No. 2',
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

/**
 * ICES intended end-use directory (`d_intend_enduse`) — the codes the BE's
 * "End use of the item" field (ICES Part 6 field 20, mandatory) takes.
 *
 * Full list as JNCH Public Notice 80/2017 prints it (§18, "List of End Use
 * Codes and their description"). Descriptions are verbatim from that notice
 * with the line-wrapped suffixes rejoined; checklist-html.ts prints them in the
 * End Use Information table, which is why GNX100's wording matches what
 * Logi-Sys prints on every golden checklist.
 */
export const END_USE_CODES: Record<string, string> = {
  DCA100: 'For Veterinary Medical Use as a Non-Food Product under Controlled Distribution (Trading)',
  DCH100: 'For Human Medical Use as a Non-Food Product under Controlled Distribution (Trading)',
  DCH300: 'For Human Medical Use as a Transplanted Organ, Tissue, or Fluid',
  DCH400: 'For Human Medical Use as a Non-Food Product under Controlled Distribution',
  DCH800: 'For Research use a human medicine',
  DCX200: 'For manufacture/processing as a human or veterinary medicine (Manufacture/Actual Use)',
  DCX900: 'Drugs & Cosmetics -For personal consumption',
  FSA100: 'For Animal Food or Feed (Trading/ commercial distribution)',
  FSA200: 'For manufacture/processing as a Animal Food/Feed (Manufacture/Actual Use)',
  FSA800: 'For use research use as animal Food',
  FSA900: 'Foods & Supplements -For Personal use',
  FSH100: 'Food - For Consumer use under commercial distribution (Trading)- Retail or wholesale',
  FSH200: 'Food - For manufacture/ commercial Processing (Manufacture/Actual Use)',
  FSH700: 'Food -For Internal use in Hotels-Restaurant',
  FSH710: 'Food -For Public Display or Exhibition',
  FSH750: 'Food -For use in International Sports Events',
  FSH800: 'Food -For Research Use',
  FSH900: 'Food - For personal consumption',
  FSH910: 'Food - For distribution in a natural disaster (if received gratis)',
  FSH920: 'Food -For Charitable Use',
  FSH930: 'Food -For use in a Diplomatic Establishment',
  GNX100: 'Generic -For Consumer use under commercial distribution (for Trading - wholesale or retail)',
  GNX200: 'Generic -For Commercial Assembly or processing (For Manufacture/Actual use)',
  GNX300: 'Generic -For use as Fertilizers or soil promoters',
  GNX600: 'Generic -For Repair or Refurbishing as defective or second hand goods',
  GNX650: 'Generic-For Recycling or Recovery',
  GNX680: 'Generic -For Disposal as waste',
  GNX700: 'Generic -For Public Display or Exhibition',
  GNX810: 'Generic -For Research & Development (note: other than Biomedical Research)',
  GNX815: 'Generic -For Medical Or Biomedical Research',
  GNX915: 'Generic -For display as a Trophy (hunting or other trophy)',
  LVA100: 'Live Animal -For Breeding in Captivity or Artificial Propagation',
  LVA200: 'Live Animal -For Grow-Out or Increase',
  LVA300: 'Live Animal -For re-introduction into the wild',
  LVA400: 'Live Animal -For Immediate Slaughter',
  LVA500: 'Live Animal -For use as Fertilizers or soil promoters',
  LVA710: 'Live Animal -For display in Zoo',
  LVA760: 'live Animal -For Circus or Travelling Exhibition or games or show',
  LVA800: 'Live Animal -For Research Purposes',
  LVA900: 'Live Animal -For Personal use',
  LVA950: 'Live Animal -For Re Export',
  LVP100: 'Live Plants -For Propagation',
  LVP400: 'live Plants -For Germplasm',
  LVP500: 'Live Plants -For use as Fertilizers or soil promoters',
  LVP730: 'Live Plants -For a display in a Botanical Garden',
};

/** eSanchit document-type codes for the supporting-documents table. */
export const ESANCHIT_DOC_CODES: Record<string, { code: string; name: string }> = {
  invoice: { code: '380000', name: 'Commercial Invoice' },
  bill_of_lading: { code: '705000', name: 'Bill of Lading' },
  air_waybill: { code: '740000', name: 'Air Waybill' },
  packing_list: { code: '271000', name: 'Packing List' },
  certificate_of_origin: { code: '861013', name: 'Certificate of Origin (preferential)' },
  certificate_of_analysis: { code: '001000', name: 'Certificate of Analysis' },
  // Observed in Logi-Sys' own exports, which is the only place these codes are
  // written down for us — ICEGATE's directory is not in the corpus.
  // `861000` is the non-preferential certificate of origin, beside the `861013`
  // preferential one above (ex_job20, ex_job28).
  shipping_bill: { code: '022CO1', name: 'Shipping Bill / NOC' },
  gst_tax_invoice: { code: '380000', name: 'GST Tax Invoice' },
  // `other` has no code on purpose: a document we cannot type is not referenced
  // on the workbook at all, because a wrong six-digit code tells Customs the
  // document is something it is not.
  other: { code: '', name: 'Other' },
};

/**
 * Document-type codes seen in Logi-Sys' own exports but with no `DocType` of
 * ours yet. Kept so the next person does not have to re-derive them from the
 * workbooks, and so an operator-chosen type has somewhere to resolve.
 *
 * Source: `ex_job20`, `ex_job25`, `ex_job26`, `ex_job28`, `ex_job29`, `ex_job31`.
 */
export const ESANCHIT_DOC_CODES_OBSERVED: Record<string, string> = {
  '004000': 'Test Report',
  '861000': 'Certificate of Origin (non-preferential)',
  '165000': 'Bond',
  '911000': 'Licence',
  '911FT0': 'Licence — FTA / scheme',
  '911CI3': 'Certificate of approval',
  '911DA3': 'DGCA approval',
  '022CO1': 'NOC / permit',
};

/** Single Window additional-product-information rules by tariff chapter. */
export interface SingleWindowRule {
  chapters: [number, number];
  pga: string;
  infoRows: { infoType: string; qualifier: string; code?: string }[];
  /** documents customs/PGA expects for these chapters */
  expectedDocs: string[];
}

/**
 * The Single Window qualifiers a food or plant line has to answer, by chapter.
 *
 * **The codes are deliberately absent, and that is the whole point.** These
 * four qualifiers used to carry `STCNR`, `MSC`, `FC0102` and `RFAN` as
 * constants on the rule. They are real — Logi-Sys' own checklists print all
 * four — but they are **per-line declarations, not chapter facts**, and
 * `ex_job24` proves it on a single Bill of Entry:
 *
 * ```
 * I-14303 item 1  17021110 lactose       STCNR    MSC  FC0102  RFAN
 * I-14303 item 2  35022000 whey protein  STCCT18  AYU  FC0101  RFAN
 * ex_job3         12074090 sesame        STCNR    —    FC1430  RFAN  + PLC011 PLP003 PCN1172
 * ```
 *
 * Two lines of one consignment, the same four questions, three different
 * answers. A storage condition of "not refrigerated" (`STCNR`) against
 * "controlled at 18°" (`STCCT18`), a drug category of `MSC` against `AYU`,
 * a proprietary status of `FC0102` against `FC0101`. Emitting any of them as a
 * constant declares one line's facts about another line's goods — which is
 * exactly what "no exported column may be a constant in code" exists to stop.
 *
 * So the rule names the **questions**, and the answers come from the line. Until
 * there is somewhere to record them, a line in scope raises a warning that
 * names the qualifiers it must answer, and files none of them. That is worse
 * than Logi-Sys, which files all four; it is better than filing the wrong
 * storage condition on a food consignment.
 *
 * The chapter range is not settled either: `ex_job24`'s whey protein is
 * **chapter 35**, outside the 2–22 the rule was written for.
 * See docs/boe-mapping/open-questions.md#sw-fssai-codes.
 */
export const SINGLE_WINDOW_RULES: SingleWindowRule[] = [
  {
    chapters: [2, 22],
    pga: 'FSSAI',
    infoRows: [
      { infoType: 'Item Characteristics', qualifier: 'Storage Condition' },
      { infoType: 'Item Category', qualifier: 'Drug Related Category' },
      { infoType: 'Item Category', qualifier: 'Foods & Supplement Proprietry Status' },
      { infoType: 'Item Identification', qualifier: 'Retail Pre-pack Food Article' },
    ],
    expectedDocs: ['FSSAI licence', 'test report'],
  },
  {
    // ex_job24 item 2: whey protein concentrate, 35022000, carrying the same
    // four qualifiers as the lactose on item 1 of the same Bill of Entry.
    chapters: [35, 35],
    pga: 'FSSAI',
    infoRows: [
      { infoType: 'Item Characteristics', qualifier: 'Storage Condition' },
      { infoType: 'Item Category', qualifier: 'Drug Related Category' },
      { infoType: 'Item Category', qualifier: 'Foods & Supplement Proprietry Status' },
      { infoType: 'Item Identification', qualifier: 'Retail Pre-pack Food Article' },
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
