import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logisysNotn, type NotnFlag } from './codes.js';

/**
 * The duty masters behind the ITEMS sheet (docs/boe-mapping/06-items.md).
 *
 * Each is parsed out of the CBIC notification corpus by its own script under
 * `packages/core/scripts/` and committed as JSON in `generated/items/`:
 *
 * | File | Script | What it answers |
 * |---|---|---|
 * | `levies.json` | `build-item-levies.py` | AIDC (11/2021), SWS exemption (11/2018), health cess, IGST and cess exemptions |
 * | `fta-agreements.json` + `fta-schedules/*.json` | `build-fta-schedules.py` | trade agreements, their rules of origin and per-CTH concession serials |
 * | `trade-remedies.json` | `build-trade-remedies.py` | anti-dumping, safeguard and CVD rows |
 * | `tariff-values.json` | `build-tariff-values.py` | tariff values under s.14(2), edition by edition |
 *
 * JSON on disk rather than generated .ts for the reason tariff-book.ts gives:
 * these are large and `tsc` would re-parse them on every build.
 *
 * Every lookup takes the Bill of Entry date, because every one of these moves:
 * AIDC and SWS entries are amended at each budget, a tariff value lasts a
 * fortnight, an anti-dumping duty lapses after five years unless extended.
 */

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

const GENERATED_DIR = 'packages/core/src/masters/generated/items';

function moduleRelative(file: string): string {
  // Assembled, not a literal — see tariff-book.ts on webpack and import.meta.url.
  return ['.', 'generated', 'items', file].join('/');
}

function candidatePaths(file: string): string[] {
  const candidates: string[] = [];
  const override = process.env.ITEM_MASTERS_DIR;
  if (override) candidates.push(path.join(override, file));
  try {
    candidates.push(fileURLToPath(new URL(moduleRelative(file), import.meta.url)));
  } catch {
    // import.meta.url is not a file URL under some bundlers; the walk covers it.
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth++) {
    candidates.push(path.join(dir, GENERATED_DIR, file));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}

const cache = new Map<string, unknown>();

/** One generated item master, or null when it has not been built. */
export function loadItemMaster<T>(file: string): T | null {
  if (cache.has(file)) return cache.get(file) as T | null;
  let value: T | null = null;
  for (const candidate of candidatePaths(file)) {
    try {
      value = JSON.parse(readFileSync(candidate, 'utf8')) as T;
      break;
    } catch {
      // Try the next one.
    }
  }
  cache.set(file, value);
  return value;
}

/** For tests that swap a master in. */
export function resetItemMasterCache(): void {
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** A notification row that covers tariff codes by prefix. */
export interface CodeCover {
  include: string[];
  exclude?: string[];
  anyChapter?: boolean;
}

/** Length of the longest include prefix opening `cth`; null when not covered. */
export function coverRank(spec: CodeCover, cth: string): number | null {
  const code = cth.replace(/\D/g, '');
  if (!code) return null;
  if ((spec.exclude ?? []).some((x) => x && code.startsWith(x))) return null;
  const matched = spec.include.filter((p) => p && code.startsWith(p));
  if (matched.length) return Math.max(...matched.map((m) => m.length));
  return spec.anyChapter ? 0 : null;
}

function inForce(v: { validFrom?: string | null; validUntil?: string | null }, onIsoDate: string): boolean {
  if (v.validFrom && onIsoDate < v.validFrom) return false;
  if (v.validUntil && onIsoDate > v.validUntil) return false;
  return true;
}

/** Entries covering `cth` on the date, most specific first. */
function covering<T extends CodeCover & { validFrom?: string | null; validUntil?: string | null }>(
  entries: readonly T[],
  cth: string,
  onIsoDate: string,
): T[] {
  return entries
    .map((entry) => ({ entry, rank: coverRank(entry, cth) }))
    .filter((m): m is { entry: T; rank: number } => m.rank !== null && inForce(m.entry, onIsoDate))
    .sort((a, b) => b.rank - a.rank)
    .map((m) => m.entry);
}

/** The single most specific entry, and any equally specific rivals. */
function best<T extends CodeCover & { validFrom?: string | null; validUntil?: string | null }>(
  entries: readonly T[],
  cth: string,
  onIsoDate: string,
): { entry: T; rivals: T[] } | undefined {
  const all = covering(entries, cth, onIsoDate);
  const [first] = all;
  if (!first) return undefined;
  const rank = coverRank(first, cth);
  return { entry: first, rivals: all.slice(1).filter((e) => coverRank(e, cth) === rank) };
}

/* ------------------------------------------------------------------ *
 * Rate wording → flag
 * ------------------------------------------------------------------ */

/**
 * The Plus/Minus/Higher/Lower flag a notification's rate wording implies.
 *
 * "10% or Rs. 25 per kg, whichever is higher" is `H`; "…whichever is lower" is
 * `L`; "10% plus Rs. 5 per kg" is `+`; "10% minus …" is `-`. A rate with no
 * specific part is `+`, which is the screen's default and gives the same duty.
 */
export function notnFlagFromRateText(text: string | null | undefined): NotnFlag {
  const t = (text ?? '').toLowerCase();
  if (/whichever\s+is\s+(higher|more|greater)/.test(t)) return 'H';
  if (/whichever\s+is\s+(lower|less)/.test(t)) return 'L';
  if (/\bminus\b|\bless\b/.test(t)) return '-';
  return '+';
}

/* ------------------------------------------------------------------ *
 * Levies: AIDC, SWS, health cess, IGST and cess exemptions
 * ------------------------------------------------------------------ */

export interface LevyEntry extends CodeCover {
  serial: string;
  description: string;
  rateText?: string | null;
  rate?: number | null;
  conditions?: string[];
  /** The entry covers every good under its codes, with no qualifying words. */
  allGoods?: boolean;
  /** AIDC only: `specific` (by code), `claim-based` (by the BCD exemption claimed), `residual`. */
  kind?: 'specific' | 'claim-based' | 'residual';
  /** Claim-based entries: the BCD notifications (and serials) whose claim selects this entry. */
  refs?: { notification: string; table?: string; serials?: string[]; relation?: string }[];
  validFrom?: string | null;
  validUntil?: string | null;
  amendedBy?: string[];
  page?: number;
}

export interface ExemptionEntry extends LevyEntry {
  type: 'C' | 'G';
  notification: string;
  igstRateText?: string | null;
  igstRate?: number | null;
}

export interface AidcAnnexureRow {
  serial: string;
  notification: string;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface LeviesFile {
  aidc: {
    notification: string;
    entries: LevyEntry[];
    /** Notifications whose BCD exemption puts a line under the ANNEXURE entry (S.No. 19). */
    annexure: AidcAnnexureRow[];
    otherExemptions?: (LevyEntry & { notification: string })[];
  };
  swsExemption: { notification: string; entries: LevyEntry[] };
  healthCess?: { exemptionNotification?: string; entries: LevyEntry[] };
  igstExemptions: ExemptionEntry[];
  compCessExemptions: ExemptionEntry[];
}

function levies(): LeviesFile | null {
  return loadItemMaster<LeviesFile>('levies.json');
}

/** A resolved notification line for one item. */
export interface LevyLine {
  notification: string;
  serial: string;
  flag: NotnFlag;
  rate: number | null;
  rateText: string | null;
  /** The entry carries conditions: file it only when the goods meet them. */
  conditional: boolean;
  /** Equally specific serials that name the same CTH — the description decides. */
  rivals: string[];
  page?: number;
}

function lineFrom(notification: string, hit: { entry: LevyEntry; rivals: LevyEntry[] }): LevyLine {
  const { entry, rivals } = hit;
  return {
    notification: logisysNotn(notification) ?? notification,
    serial: entry.serial,
    flag: notnFlagFromRateText(entry.rateText),
    rate: entry.rate ?? null,
    rateText: entry.rateText ?? null,
    conditional: entry.allGoods !== undefined ? !entry.allGoods : (entry.conditions ?? []).length > 0,
    rivals: rivals.map((r) => r.serial),
    ...(entry.page !== undefined && { page: entry.page }),
  };
}

/**
 * The date the AIDC ANNEXURE is read as at.
 *
 * Read literally, 06/2025-Customs added 24/2005 (and 166 others) to the
 * ANNEXURE, which would put ex_job5's ITA goods under S.No. 19 — but Logi-Sys
 * filed S.No. 17 on every one of them, while filing 19 for a Japan-CEPA claim
 * (69/2011, an original ANNEXURE row). The ANNEXURE as it stood before 06/2025
 * reproduces all eight filed serials. Both serials are Nil, so no duty turns on
 * it; until Sandesh confirms which Logi-Sys wants, the filed behaviour is
 * reproduced. See docs/boe-mapping/open-questions.md.
 */
export const AIDC_ANNEXURE_AS_AT = '2025-02-01';

/** The BCD exemption claimed on a line, which is what selects most AIDC serials. */
export interface BcdClaim {
  notification: string;
  serial?: string;
}

/**
 * AIDC levy (11/2021-Customs) serial for a line.
 *
 * 11/2021 names very few tariff codes. For almost everything the serial is
 * chosen by the BCD exemption claimed on the line: S.No. 19 for a claim under
 * a notification in its ANNEXURE (69/2011 — so ex_job6's polypropylene is 19),
 * the claim-based entries that name their own notification and serials
 * (45/2025 → S.No. 20), and otherwise the residual S.No. 17. A code-specific
 * entry wins over all of them.
 */
export function aidcLevyFor(cth: string, onIsoDate: string, claim?: BcdClaim): LevyLine | undefined {
  const file = levies();
  if (!file) return undefined;
  const { aidc } = file;
  const live = aidc.entries.filter((e) => inForce(e, onIsoDate));

  const specific = best(live.filter((e) => (e.kind ?? 'specific') === 'specific' && e.include.length), cth, onIsoDate);
  if (specific) return lineFrom(aidc.notification, specific);

  const claimNotn = claim ? logisysNotn(claim.notification) : undefined;
  if (claimNotn) {
    const named = live.find(
      (e) =>
        e.kind === 'claim-based' &&
        coverRank(e, cth) !== null &&
        (e.refs ?? []).some(
          (r) => logisysNotn(r.notification) === claimNotn && (!r.serials?.length || (claim?.serial !== undefined && r.serials.includes(claim.serial))),
        ),
    );
    if (named) return lineFrom(aidc.notification, { entry: named, rivals: [] });

    const annexed = aidc.annexure.some(
      (row) => logisysNotn(row.notification) === claimNotn && inForce(row, AIDC_ANNEXURE_AS_AT),
    );
    const annexureEntry = live.find((e) => e.kind === 'claim-based' && /mentioned in the ANNEXURE/i.test(e.description));
    if (annexed && annexureEntry) return lineFrom(aidc.notification, { entry: annexureEntry, rivals: [] });
  }

  const residual = live.find((e) => e.kind === 'residual');
  return residual ? { ...lineFrom(aidc.notification, { entry: residual, rivals: [] }), conditional: false } : undefined;
}

/** The SWS exemption (11/2018-Customs) entry covering a CTH, when one exempts the surcharge. */
export function swsExemptionFor(cth: string, onIsoDate: string): LevyLine | undefined {
  const file = levies();
  if (!file) return undefined;
  const hit = best(file.swsExemption.entries, cth, onIsoDate);
  return hit && lineFrom(file.swsExemption.notification, hit);
}

/** Health cess exemption line covering a CTH. */
export function healthCessFor(cth: string, onIsoDate: string): LevyLine | undefined {
  const file = levies();
  const hc = file?.healthCess;
  if (!hc?.exemptionNotification) return undefined;
  const hit = best(hc.entries, cth, onIsoDate);
  return hit && lineFrom(hc.exemptionNotification, hit);
}

export interface ExemptionCandidate extends LevyLine {
  type: 'C' | 'G';
  description: string;
}

function exemptionCandidates(entries: ExemptionEntry[], cth: string, onIsoDate: string): ExemptionCandidate[] {
  return covering(entries, cth, onIsoDate).map((entry) => ({
    ...lineFrom(entry.notification, { entry, rivals: [] }),
    rate: entry.igstRate ?? entry.rate ?? null,
    rateText: entry.igstRateText ?? entry.rateText ?? null,
    type: entry.type,
    description: entry.description,
  }));
}

/**
 * IGST exemptions that may apply to a CTH. Candidates, not conclusions: an
 * exemption's description and conditions decide it, not the code alone.
 */
export function igstExemptionCandidates(cth: string, onIsoDate: string): ExemptionCandidate[] {
  const file = levies();
  return file ? exemptionCandidates(file.igstExemptions, cth, onIsoDate) : [];
}

export function compCessExemptionCandidates(cth: string, onIsoDate: string): ExemptionCandidate[] {
  const file = levies();
  return file ? exemptionCandidates(file.compCessExemptions, cth, onIsoDate) : [];
}

/* ------------------------------------------------------------------ *
 * Tariff values
 * ------------------------------------------------------------------ */

export interface TariffValueRow extends CodeCover {
  table: string;
  /** Printed as a number in the JSON; the Bill of Entry takes it as text. */
  serial: string | number;
  description: string;
  amount: number;
  currency: string;
  unitText: string;
  /** UQC of the notification's unit and how many of it the amount is for: per 10 GMS → { GMS, 10 }. */
  uqc: string;
  per: number;
  page?: number;
}

export interface TariffValueEdition {
  notification: string;
  notificationDate?: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  rows: TariffValueRow[];
}

export interface TariffValuesFile {
  baseNotification: string;
  editions: TariffValueEdition[];
}

/** The edition in force on the date. */
export function tariffValueEdition(onIsoDate: string): TariffValueEdition | undefined {
  const file = loadItemMaster<TariffValuesFile>('tariff-values.json');
  return file?.editions.find(
    (e) => e.effectiveFrom <= onIsoDate && (e.effectiveUntil === null || onIsoDate <= e.effectiveUntil),
  );
}

/** Tariff-value rows that cover a CTH on the date. Descriptions decide between several. */
export function tariffValueCandidates(
  cth: string,
  onIsoDate: string,
): { baseNotification: string; edition: TariffValueEdition; rows: TariffValueRow[] } | undefined {
  const file = loadItemMaster<TariffValuesFile>('tariff-values.json');
  const edition = tariffValueEdition(onIsoDate);
  if (!file || !edition) return undefined;
  const rows = edition.rows
    .map((row) => ({ row, rank: coverRank(row, cth) }))
    .filter((m): m is { row: TariffValueRow; rank: number } => m.rank !== null)
    .sort((a, b) => b.rank - a.rank)
    .map((m) => m.row);
  return rows.length ? { baseNotification: file.baseNotification, edition, rows } : undefined;
}

/** Grams in one unit of each mass UQC the tariff-value tables use. */
const GRAMS: Record<string, number> = { GMS: 1, KGS: 1000, MTS: 1_000_000, TON: 1_000_000, QTL: 100_000 };

/**
 * An invoice quantity in the notification's unit — `Tarrif_Value_Qty`.
 *
 * The notification fixes a value per its own unit (US$ per tonne, per 10
 * grams, per kilogram), so 156,450 KGS against a per-tonne value is 156.450,
 * and 1,000 GMS against a per-10-grams value is 100. Undefined when the two
 * units are not both masses — pieces cannot be converted to grams.
 */
export function tariffValueQuantity(quantity: number, invoiceUqc: string, row: Pick<TariffValueRow, 'uqc' | 'per'>): number | undefined {
  const from = GRAMS[invoiceUqc.toUpperCase()];
  const to = GRAMS[row.uqc.toUpperCase()];
  if (from === undefined || to === undefined || !row.per) return undefined;
  return (quantity * from) / (to * row.per);
}

/* ------------------------------------------------------------------ *
 * Trade agreements
 * ------------------------------------------------------------------ */

export interface FtaAgreement {
  key: string;
  name: string;
  partners: string[];
  inForceFrom: string | null;
  inForceUntil: string | null;
  concessionNotifications: { notification: string; date?: string; amendedBy?: string[] }[];
  slot: 'BASIC' | 'SAPTA';
  rooRules?: { notification: string; date?: string } | null;
  cooHeadingPatterns: string[];
  originCriteria: { coo: string; ices: string; tariffShift?: string }[];
  retroactive: {
    allowed: boolean;
    windowDays: number | null;
    windowFrom?: string | null;
    marking: string | null;
    otherConditions?: string[];
    source?: { notification?: string; rule?: string; page?: number } | null;
  } | null;
  directConsignment?: { required: boolean; transitConditions?: string[]; source?: unknown } | null;
  thirdPartyInvoicing?: { allowed: boolean; conditions?: string[]; source?: unknown } | null;
  cooValidityDays?: number | null;
  notes?: string;
}

export interface FtaScheduleLine extends CodeCover {
  serial: string;
  /** A line of a different kind inside an agreement (Singapore's 74/2005 remissions): overrides the agreement's slot. */
  slot?: 'BASIC' | 'SAPTA' | null;
  /** `preferential BCD rate %` or `percent reduction of applied duty`. */
  rateMeaning?: string;
  description: string;
  rateText?: string | null;
  rate?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  conditions?: string[] | null;
  page?: number;
  /** The concession notification this row belongs to, when an agreement has several. */
  notification?: string;
}

export function ftaAgreements(): FtaAgreement[] {
  return loadItemMaster<FtaAgreement[]>('fta-agreements.json') ?? [];
}

function agreementInForce(a: FtaAgreement, onIsoDate: string): boolean {
  return (!a.inForceFrom || a.inForceFrom <= onIsoDate) && (!a.inForceUntil || onIsoDate <= a.inForceUntil);
}

/** Agreements in force on the date that cover goods originating in `originIso2`. */
export function ftaAgreementsForOrigin(originIso2: string, onIsoDate: string): FtaAgreement[] {
  const code = originIso2.toUpperCase();
  return ftaAgreements().filter((a) => a.partners.includes(code) && agreementInForce(a, onIsoDate));
}

/**
 * The agreement a certificate of origin claims: its heading matched against
 * each agreement's patterns, among those covering the origin country. When the
 * heading matches nothing but exactly one agreement covers the country, that
 * one — a certificate is issued under *some* agreement with its partner.
 */
export function ftaAgreementForCertificate(
  schemeText: string | null | undefined,
  originIso2: string,
  onIsoDate: string,
): FtaAgreement | undefined {
  const candidates = ftaAgreementsForOrigin(originIso2, onIsoDate);
  const heading = schemeText ?? '';
  const byHeading = candidates.filter((a) =>
    a.cooHeadingPatterns.some((p) => {
      try {
        return new RegExp(p, 'i').test(heading);
      } catch {
        return heading.toUpperCase().includes(p.toUpperCase());
      }
    }),
  );
  if (byHeading.length === 1) return byHeading[0];
  if (byHeading.length > 1) {
    // Several headings match (a generic "Certificate of Origin"): prefer the
    // agreement with the longest matching pattern.
    return byHeading.sort(
      (a, b) =>
        Math.max(...b.cooHeadingPatterns.map((p) => p.length)) -
        Math.max(...a.cooHeadingPatterns.map((p) => p.length)),
    )[0];
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The agreement's schedule, or null when it has not been parsed. */
export function ftaSchedule(key: string): FtaScheduleLine[] | null {
  return loadItemMaster<FtaScheduleLine[]>(`fta-schedules/${key}.json`);
}

export interface FtaConcession {
  agreement: FtaAgreement;
  notification: string;
  serial: string;
  /** Which ITEMS columns the line files in — the line's own kind wins over the agreement's. */
  slot: 'BASIC' | 'SAPTA';
  /** `rate` is the percentage of duty remitted, not a preferential rate. */
  rateIsRemission: boolean;
  rate: number | null;
  rateText: string | null;
  description: string;
  rivals: string[];
  page?: number;
}

/**
 * The concession line for a CTH under an agreement — the serial the Bill of
 * Entry files. Undefined when the schedule does not name the CTH: that is not
 * a concession line, and the serial of some other line is never a substitute.
 */
export function ftaConcessionFor(agreement: FtaAgreement, cth: string, onIsoDate: string): FtaConcession | undefined {
  const lines = ftaSchedule(agreement.key);
  if (!lines) return undefined;
  const hit = best(lines, cth, onIsoDate);
  if (!hit) return undefined;
  const notification =
    hit.entry.notification ?? agreement.concessionNotifications[0]?.notification ?? '';
  return {
    agreement,
    notification: logisysNotn(notification) ?? notification,
    serial: hit.entry.serial,
    slot: hit.entry.slot ?? agreement.slot,
    rateIsRemission: /reduction|remi/i.test(hit.entry.rateMeaning ?? '') || (!hit.entry.rateMeaning && agreement.slot === 'SAPTA'),
    rate: hit.entry.rate ?? null,
    rateText: hit.entry.rateText ?? null,
    description: hit.entry.description,
    rivals: hit.rivals.map((r) => r.serial),
    ...(hit.entry.page !== undefined && { page: hit.entry.page }),
  };
}

/** The Logi-Sys origin criterion (and tariff shift, where the agreement implies one) for what the certificate prints. */
export function ftaOriginCriterion(
  agreement: FtaAgreement,
  printed: string | null | undefined,
): { criterion: string; tariffShift?: string } | undefined {
  const raw = printed?.trim().toUpperCase();
  if (!raw) return undefined;
  const hit =
    agreement.originCriteria.find((c) => c.coo.toUpperCase() === raw) ??
    agreement.originCriteria.find((c) => raw.startsWith(c.coo.toUpperCase()));
  return hit ? { criterion: hit.ices, ...(hit.tariffShift && { tariffShift: hit.tariffShift }) } : undefined;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, thirty: 30 };

/**
 * Calendar days after shipment inside which an agreement treats a certificate
 * as issued in the ordinary course — "at the time of exportation or within
 * three working days", "within five working days of the date of exportation".
 * Read off the agreement's own conditions; working days are widened to cover
 * the weekends inside them. Three working days when the rule is silent, the
 * commonest wording across India's agreements.
 */
export function normalIssuanceDays(agreement: FtaAgreement): number {
  const text = (agreement.retroactive?.otherConditions ?? []).join(' ').toLowerCase();
  const m = text.match(/(?:within|not later than)\s+(?:a period of\s+)?(\d+|[a-z]+)\s+(working\s+)?days/);
  const n = m ? (Number(m[1]) || NUMBER_WORDS[m[1]!] || 3) : 3;
  const working = m ? Boolean(m[2]) : true;
  return working ? n + 2 * Math.ceil(n / 5) : n;
}

export interface RetroactiveCheck {
  /** `COO_Retroactive_Issuance`. */
  retroactive: boolean;
  compliant: boolean;
  reason: string;
}

const DAY_MS = 86_400_000;

/**
 * The customer's retroactive-issuance rule, against the agreement's own.
 *
 * A certificate issued on or before the shipment date is not retroactive —
 * `N`, nothing to think about. One issued after it is retroactive; it is
 * compliant only when the agreement allows retroactive issue, the certificate
 * carries the marking the agreement requires, and it was issued inside the
 * agreement's window. Otherwise the operator is told it is not compliant and
 * the shipper has to be contacted.
 *
 * A certificate issued within three days of shipment is treated as issued at
 * the time of export, which is the ordinary tolerance in the rules of origin of
 * most of India's agreements ("at the time of exportation or within three
 * working days"). Agreements that state a different grace carry it in
 * `retroactive.otherConditions` for the reason text; the three-day allowance
 * itself is deliberately not stretched per agreement.
 */
export function retroactiveCheck(
  agreement: FtaAgreement,
  cooIssueDate: string | null | undefined,
  shipmentDate: string | null | undefined,
  markedRetroactive: boolean | null | undefined,
  invoiceDate?: string | null,
): RetroactiveCheck {
  const rule = agreement.retroactive;
  const cite = rule?.source?.notification
    ? ` (${rule.source.notification}${rule.source.rule ? `, ${rule.source.rule}` : ''})`
    : '';

  // Chile and MERCOSUR have no retroactive issuance at all: a certificate is
  // valid from the invoice date for a fixed window, and inside it is simply
  // not retroactive.
  if (rule && rule.windowFrom === 'invoice' && !rule.marking && cooIssueDate && invoiceDate && rule.windowDays !== null) {
    const days = Math.round((Date.parse(cooIssueDate) - Date.parse(invoiceDate)) / DAY_MS);
    const inside = days >= 0 && days <= rule.windowDays;
    return {
      retroactive: false,
      compliant: inside,
      reason: inside
        ? `Certificate issued ${days} day(s) after the invoice, inside ${agreement.name}'s ${rule.windowDays}-day window${cite}.`
        : `Certificate issued ${days} day(s) from the invoice date; ${agreement.name} allows ${days < 0 ? 'none before the invoice' : `${rule.windowDays} days`}${cite}. Contact the shipper.`,
    };
  }

  if (!cooIssueDate || !shipmentDate) {
    return {
      retroactive: false,
      compliant: false,
      reason: `Cannot check retroactive issuance under ${agreement.name}: ${!cooIssueDate ? 'the certificate has no issue date' : 'the shipment date is unknown'}.`,
    };
  }
  const days = Math.round((Date.parse(cooIssueDate) - Date.parse(shipmentDate)) / DAY_MS);
  const normal = normalIssuanceDays(agreement);
  if (days <= normal) {
    return {
      retroactive: false,
      compliant: true,
      reason: `Certificate issued ${days <= 0 ? 'on or before' : `${days} day(s) after`} shipment, within ${agreement.name}'s ordinary issuance — not retroactive.`,
    };
  }
  if (!rule) {
    return {
      retroactive: true,
      compliant: true,
      reason:
        `Certificate issued ${days} days after shipment. ${agreement.name}'s rules state no retroactive-issuance provision — ` +
        'confirm with the issuing authority before filing.',
    };
  }
  if (!rule.allowed) {
    return {
      retroactive: true,
      compliant: false,
      reason:
        `Certificate issued ${days} days after shipment, but ${agreement.name} does not provide for retroactive issuance${cite}. ` +
        'Contact the shipper for a certificate that complies.',
    };
  }
  if (rule.windowDays !== null && days > rule.windowDays) {
    return {
      retroactive: true,
      compliant: false,
      reason:
        `Certificate issued ${days} days after shipment; ${agreement.name} allows retroactive issuance within ${rule.windowDays} days${cite}. ` +
        'Contact the shipper.',
    };
  }
  if (rule.marking && markedRetroactive !== true) {
    return {
      retroactive: true,
      compliant: false,
      reason:
        `Certificate issued ${days} days after shipment and ${agreement.name} requires it to be marked "${rule.marking}"${cite}, ` +
        `which ${markedRetroactive === false ? 'it is not' : 'could not be read on it'}. Confirm the marking, or contact the shipper.`,
    };
  }
  return {
    retroactive: true,
    compliant: true,
    reason:
      `Certificate issued retroactively, ${days} days after shipment, within ${agreement.name}'s rule${cite}` +
      (rule.otherConditions?.length ? ` — also check: ${rule.otherConditions.join('; ')}.` : '.'),
  };
}

/* ------------------------------------------------------------------ *
 * Trade remedies
 * ------------------------------------------------------------------ */

export interface TradeRemedyEntry extends CodeCover {
  kind: 'ADD' | 'SAFEGUARD' | 'CVD';
  notification: string;
  notificationShort?: string;
  notificationDate?: string;
  tableSerial: string | null;
  description: string;
  specification?: string | null;
  originCountries: string[];
  exportCountries: string[];
  producer: string;
  exporter: string;
  supplierSerial: string | null;
  /**
   * `SPECIFIC` amount per unit; `CIF_PCT` / `AV` % of assessable value;
   * `LANDED_PCT` % of landed value; `REFERENCE_PRICE` the shortfall of the
   * landed value below a reference price, per unit.
   */
  basis: string | null;
  rate: number | null;
  amount: number | null;
  unit: string | null;
  currency: string | null;
  validFrom: string | null;
  validUntil: string | null;
  validityInferred?: boolean;
  rescindedBy?: string | null;
  page?: number;
  /** "Any country other than …": the countries the residual row excludes. */
  originExcept?: string[];
  exportExcept?: string[];
  /** The row applies when EITHER the origin or the export country matches. */
  originOrExport?: boolean;
  /** The table's own words for a residual producer row ("Any producer other than S.No. 1"). */
  residual?: string | null;
  /** Instructions the numbers do not carry — e.g. "less the CVD levied". */
  dutyNotes?: string[];
  /** Safeguard: not levied when the CIF price is at or above these. */
  notLeviedAtOrAboveCifPrice?: { productCategory: string; cifPrice: number; unit: string; currency: string }[];
}

/** Member states, for rows that name the European Union as one country. */
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

function countryIn(list: string[], iso: string | undefined): boolean {
  if (!iso) return false;
  const code = iso.toUpperCase();
  return list.some((c) => c.toUpperCase() === code || (c.toUpperCase() === 'EU' && EU.has(code)));
}

export interface TradeRemediesFile {
  asOf: string;
  entries: TradeRemedyEntry[];
}

export function tradeRemedyEntries(): TradeRemedyEntry[] {
  return loadItemMaster<TradeRemediesFile>('trade-remedies.json')?.entries ?? [];
}

/** Company names compared on their distinctive words. */
function nameTokens(name: string): Set<string> {
  const stop = new Set(['CO', 'COMPANY', 'LTD', 'LIMITED', 'INC', 'CORP', 'CORPORATION', 'PVT', 'PRIVATE', 'LLC', 'GMBH', 'SA', 'AG', 'PLC', 'THE', 'AND', 'OF', 'INDUSTRY', 'INDUSTRIES', 'INTERNATIONAL', 'GROUP']);
  return new Set(
    name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stop.has(w)),
  );
}

/** Whether two company names plausibly name the same producer. */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  const shared = [...ta].filter((w) => tb.has(w)).length;
  return shared / Math.min(ta.size, tb.size) >= 0.6;
}

const isAny = (v: string | null | undefined) => !v || /^(ANY|ALL)\b/i.test(v.trim());

export interface TradeRemedyMatch {
  /** The single row to file, when the match is unambiguous. */
  entry?: TradeRemedyEntry;
  /** Every row that could apply, when it is not. */
  candidates: TradeRemedyEntry[];
}

/**
 * The trade-remedy rows for one item, per kind.
 *
 * A row names a CTH, an origin, an export country and — for anti-dumping —
 * often a producer and exporter, with a residual "any other" row beside the
 * named ones. A named row whose producer and exporter both match the item wins
 * over the residual; when no named row matches, the residual applies. Anything
 * else — two named rows, or a named producer the item's manufacturer merely
 * resembles — is returned as candidates for a person.
 */
export function tradeRemediesFor(input: {
  cth: string;
  originIso2: string | undefined;
  exportIso2: string | undefined;
  producer: string | undefined;
  exporter: string | undefined;
  onIsoDate: string;
}): Record<'ADD' | 'SAFEGUARD' | 'CVD', TradeRemedyMatch> {
  const out = {
    ADD: { candidates: [] as TradeRemedyEntry[] },
    SAFEGUARD: { candidates: [] as TradeRemedyEntry[] },
    CVD: { candidates: [] as TradeRemedyEntry[] },
  } as Record<'ADD' | 'SAFEGUARD' | 'CVD', TradeRemedyMatch>;

  const countryOk = (list: string[], except: string[] | undefined, iso: string | undefined) => {
    if (except?.length && countryIn(except, iso)) return false;
    return list.length === 0 || list.some((c) => isAny(c)) || countryIn(list, iso);
  };
  const exportIso2 = input.exportIso2 ?? input.originIso2;

  const live = tradeRemedyEntries().filter((e) => {
    if (e.rescindedBy || !inForce(e, input.onIsoDate) || coverRank(e, input.cth) === null) return false;
    const origin = countryOk(e.originCountries, e.originExcept, input.originIso2);
    const exported = countryOk(e.exportCountries, e.exportExcept, exportIso2);
    return e.originOrExport ? origin || exported : origin && exported;
  });

  for (const kind of ['ADD', 'SAFEGUARD', 'CVD'] as const) {
    const rows = live.filter((e) => e.kind === kind);
    if (!rows.length) continue;
    const named = rows.filter((e) => !isAny(e.producer) || !isAny(e.exporter));
    const residual = rows.filter((e) => isAny(e.producer) && isAny(e.exporter));
    const namedMatches = named.filter(
      (e) =>
        (isAny(e.producer) || sameCompany(e.producer, input.producer)) &&
        (isAny(e.exporter) || sameCompany(e.exporter, input.exporter)),
    );
    if (namedMatches.length === 1) {
      out[kind] = { entry: namedMatches[0]!, candidates: namedMatches };
    } else if (namedMatches.length === 0 && residual.length === 1) {
      out[kind] = { entry: residual[0]!, candidates: residual };
    } else {
      out[kind] = { candidates: namedMatches.length ? namedMatches : rows };
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Product master key
 * ------------------------------------------------------------------ */

/**
 * The key a description is remembered under in `product_master`.
 *
 * Upper-cased, punctuation turned to space, runs of space collapsed. Grade
 * codes are kept: "RANDOM POLYPROPYLENE RP2248N" and "…RP2240M" are different
 * products that may classify alike, and the operator confirms each once.
 */
export function productDescriptionKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z0-9%./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
