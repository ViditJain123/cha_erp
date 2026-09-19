import {
  AIRLINES,
  BCD_CONDITIONS,
  BCD_EXEMPTIONS,
  BCD_EXEMPTION_NOTIFICATION,
  CHA_PROFILE,
  COMP_CESS_NOTIFICATION,
  COMP_CESS_RESIDUAL_ENTRY,
  COMP_CESS_SCHEDULE,
  COMP_CESS_UNAPPLIED_AMENDMENTS,
  isChemicalDeclarationCth,
  CUSTOM_HOUSES,
  DECLARATIONS,
  FOREIGN_PORTS,
  FTA_SCHEMES,
  IGST_RATE_NOTIFICATION,
  IGST_RESIDUAL_ENTRY,
  IGST_SCHEDULE,
  PORTS,
  RE_IMPORT_NOTIFICATIONS,
  SINGLE_WINDOW_RULES,
  UQC_NORMALIZATION,
  VALID_UQC,
  type AirlineMaster,
  type BcdConditionMaster,
  type BcdExemptionEntry,
  type ChaProfile,
  type CompCessEntry,
  type CustomHouseMaster,
  type DeclarationMaster,
  type ForeignPortMaster,
  type FtaSchemeMaster,
  type IgstScheduleEntry,
  type ImporterMaster,
  type PortMaster,
  type ReImportEntry,
  type TariffCodeSpec,
  type TariffMaster,
} from './data.js';
import { logisysNotn } from './codes.js';
import { allExchangeRates, allImporters, allTariff } from './store.js';
import type { ExchangeRateTable } from '../types.js';
export {
  productIndexFile,
  tariffBook,
  tariffBookMasters,
  tariffEdition,
  type ProductIndexEntry,
  type ProductIndexFile,
  type TariffBookFile,
  type TariffBookNotificationRef,
  type TariffBookRow,
  type TariffConfidence,
} from './tariff-book.js';
export { searchProductIndex, type ProductIndexHit } from './product-index.js';
export {
  tariffBookNotification,
  tariffBookNotificationsFile,
  type TariffBookNotification,
} from './tariff-book-notifications.js';
export { drawbackFile, lookupDrawback, type DrawbackEntry, type DrawbackFile } from './drawback.js';
export {
  chapterNotes,
  chapterNotesFile,
  type ChapterNotes,
  type ChapterNotesFile,
} from './chapter-notes.js';

export * from './data.js';
export * from './store.js';
export * from './codes.js';
export * from './party-name.js';
export * from './stations.js';
export * from './warehouse-code.js';
export {
  standardUqcFile,
  standardUqcForCth,
  standardQuantity,
  type StandardUqcFile,
  type StandardQuantity,
} from './standard-uqc.js';

export function lookupTariff(cth: string): TariffMaster | undefined {
  return allTariff().find((t) => t.cth === cth);
}

/**
 * Resolve a partial (e.g. 6-digit) HS code to a full 8-digit tariff row.
 * Returns the row only when the prefix matches exactly one entry —
 * ambiguous prefixes need human resolution.
 */
export function lookupTariffByPrefix(hsPrefix: string): TariffMaster | undefined {
  const resolved = resolveTariffPrefix(hsPrefix);
  return resolved.reason === 'unique' ? resolved.row : undefined;
}

/**
 * Why a partial HS code did or did not resolve to one tariff item.
 *
 * - `unique`        the prefix has exactly one 8-digit child. Nothing to decide.
 * - `all-agree`     several children, but they carry the same duty. The rates
 *                   are safe to use; the RITC still has to be chosen, because
 *                   the Bill of Entry declares a code and not a rate.
 * - `ambiguous`     several children with different duty. The goods description
 *                   has to settle it.
 * - `unknown-prefix` no child at all — the code is not in the First Schedule.
 */
export type TariffPrefixReason = 'unique' | 'all-agree' | 'ambiguous' | 'unknown-prefix';

export interface TariffPrefixResolution {
  /** Set only for `unique`. Every other outcome is a judgement someone has to make. */
  row?: TariffMaster;
  /** Every 8-digit child of the prefix, in code order. */
  candidates: TariffMaster[];
  reason: TariffPrefixReason;
}

/**
 * Resolve a partial (e.g. 6-digit) HS code against the First Schedule.
 *
 * This used to be `lookupTariffByPrefix` alone, and its "exactly one match"
 * rule was written when the tariff master held three rows — where a prefix
 * matching one row was the normal case. Against the full schedule a 6-digit
 * heading has one to a dozen children, so "exactly one" is now the rare case
 * and returning undefined for the rest would silently delete the
 * prefix-completion path instead of asking for help. Hence the reason: the
 * caller can tell "I could not find it" apart from "there are four and you
 * have to pick", which are different problems with different fixes.
 */
export function resolveTariffPrefix(hsPrefix: string): TariffPrefixResolution {
  const p = hsPrefix.replace(/\D/g, '');
  if (p.length < 4) return { candidates: [], reason: 'unknown-prefix' };
  const candidates = allTariff()
    .filter((t) => t.cth.startsWith(p))
    .sort((a, b) => a.cth.localeCompare(b.cth));
  if (candidates.length === 0) return { candidates, reason: 'unknown-prefix' };
  if (candidates.length === 1) return { row: candidates[0]!, candidates, reason: 'unique' };
  const [first] = candidates;
  const agree = candidates.every(
    (c) => c.bcdRate === first!.bcdRate && c.igstRate === first!.igstRate,
  );
  return { candidates, reason: agree ? 'all-agree' : 'ambiguous' };
}

/* ------------------------------ duty notifications ------------------------------ */

/**
 * How specifically an entry of a duty notification covers a CTH: the length of
 * the longest include prefix that opens the code, 0 for an "Any Chapter" entry
 * that names no matching code, null when the entry does not cover it at all.
 *
 * Longest prefix wins because that is how the notifications are read: a rate
 * against `0910` is displaced by one against `0910 11 10` for goods that fall
 * under the tariff item, never the other way round.
 */
function specMatch(spec: TariffCodeSpec, cth: string): number | null {
  const code = cth.replace(/\D/g, '');
  if (!code) return null;
  if ((spec.exclude ?? []).some((excluded) => code.startsWith(excluded))) return null;
  const matched = spec.include.filter((included) => code.startsWith(included));
  if (matched.length) return Math.max(...matched.map((m) => m.length));
  return spec.anyChapter ? 0 : null;
}

/** Entries of `entries` that cover `cth`, most specific first, ties in notification order. */
function matchesFor<T extends TariffCodeSpec>(entries: T[], cth: string): T[] {
  return entries
    .map((entry) => ({ entry, rank: specMatch(entry, cth) }))
    .filter((m): m is { entry: T; rank: number } => m.rank !== null)
    .sort((a, b) => b.rank - a.rank)
    .map((m) => m.entry);
}

/**
 * IGST schedule entries covering a CTH, most specific first.
 *
 * Several can match — the rate follows the *description*, not the code alone
 * ("pre-packaged and labelled" is the difference between 5% and nil on half of
 * Chapter 10) — so this returns them all and leaves the choice to whoever can
 * read the goods description.
 */
export function igstScheduleMatches(cth: string): IgstScheduleEntry[] {
  return matchesFor(IGST_SCHEDULE, cth);
}

export interface IgstRateResult {
  /** Rate in per cent. */
  rate: number;
  /** ICES-form notification number to file against, e.g. "009/2025". */
  notification: string;
  entry: IgstScheduleEntry;
  /** No entry named this CTH, so Schedule II's residual 18% applies. */
  residual: boolean;
  /** Equally specific entries naming a *different* rate — a human must read the descriptions. */
  alternatives: IgstScheduleEntry[];
}

/**
 * The IGST rate for a CTH under notification 9/2025-IT(R).
 *
 * Always answers for a usable code: a CTH that no entry names is taxed at 18%
 * by Schedule II's residual entry, which is the notification's own rule rather
 * than a default of ours. `alternatives` is non-empty when equally specific
 * entries disagree, which means the description decides and the answer here is
 * only the first candidate.
 */
export function igstRateForCth(cth: string): IgstRateResult | undefined {
  const code = cth.replace(/\D/g, '');
  if (code.length < 4) return undefined;
  // "Any Chapter" entries (intellectual property, actionable claims) cover
  // every code and describe none of these goods; they are not a rate for a
  // CTH, only the residual entry below is.
  const named = igstScheduleMatches(code).filter((e) => (specMatch(e, code) ?? 0) > 0);
  if (!named.length) {
    return {
      rate: IGST_RESIDUAL_ENTRY.rate,
      notification: IGST_RATE_NOTIFICATION,
      entry: IGST_RESIDUAL_ENTRY,
      residual: true,
      alternatives: [],
    };
  }
  const best = specMatch(named[0]!, code);
  const equal = named.filter((e) => specMatch(e, code) === best);
  const entry = equal[0]!;
  return {
    rate: entry.rate,
    notification: IGST_RATE_NOTIFICATION,
    entry,
    residual: false,
    alternatives: equal.slice(1).filter((e) => e.rate !== entry.rate),
  };
}

/**
 * Compensation cess entries covering a CTH, most specific first.
 *
 * Like the IGST schedule, several can match and the description decides:
 * unmanufactured tobacco is 71% with a brand name and 65% with a lime tube, at
 * the same four digits.
 */
export function compCessMatches(cth: string): CompCessEntry[] {
  return matchesFor(COMP_CESS_SCHEDULE, cth);
}

export interface CompCessResult {
  /** Rate in per cent, or null when the entry states a specific or compound cess. */
  rate: number | null;
  /** Column (4) verbatim, always present — the only honest answer for a compound rate. */
  rateText: string;
  /** ICES-form notification number to file against: "001/2017". */
  notification: string;
  entry: CompCessEntry;
  /** No entry named this CTH, so S.No. 56 applies and the cess is nil. */
  residual: boolean;
  /** Equally specific entries stating a *different* rate — a human must read the descriptions. */
  alternatives: CompCessEntry[];
  /**
   * The amending notifications this master does not carry. Empty on a residual
   * answer, which no amendment can reach; populated on every named entry, so a
   * caller cannot file one without being told it may have moved.
   */
  unappliedAmendments: string[];
}

/**
 * The compensation cess for a CTH under notification 1/2017-Compensation Cess (Rate).
 *
 * Always answers for a usable code. Goods that no serial names are covered by
 * S.No. 56 at nil — the notification's own rule, not a default of ours — and
 * that is the pair (`001/2017`, `56`) a Bill of Entry declares for them.
 *
 * A named answer is a candidate, never a conclusion: nineteen notifications
 * amend this Schedule and none of them is applied here, so `unappliedAmendments`
 * comes back non-empty and the caller must say so.
 */
export function compCessForCth(cth: string): CompCessResult | undefined {
  const code = cth.replace(/\D/g, '');
  if (code.length < 4) return undefined;
  // The residual entry is `anyChapter`, so it matches everything at rank 0.
  // Dropping rank-0 matches here is what makes "named by a serial" mean it.
  const named = compCessMatches(code).filter((e) => (specMatch(e, code) ?? 0) > 0);
  if (!named.length) {
    return {
      rate: COMP_CESS_RESIDUAL_ENTRY.rate,
      rateText: COMP_CESS_RESIDUAL_ENTRY.rateText,
      notification: COMP_CESS_NOTIFICATION,
      entry: COMP_CESS_RESIDUAL_ENTRY,
      residual: true,
      alternatives: [],
      unappliedAmendments: [],
    };
  }
  const best = specMatch(named[0]!, code);
  const equal = named.filter((e) => specMatch(e, code) === best);
  const entry = equal[0]!;
  return {
    rate: entry.rate,
    rateText: entry.rateText,
    notification: COMP_CESS_NOTIFICATION,
    entry,
    residual: false,
    // Compared on the text, not the number: every specific and compound rate
    // has a null `rate`, so comparing numbers would collapse "Rs.400 per tonne"
    // and "5% + Rs.2126 per thousand" into one answer.
    alternatives: equal.slice(1).filter((e) => e.rateText !== entry.rateText),
    unappliedAmendments: COMP_CESS_UNAPPLIED_AMENDMENTS,
  };
}

/** The compensation cess notification a Bill of Entry files against. */
export function compCessNotification(): string {
  return COMP_CESS_NOTIFICATION;
}

/**
 * BCD exemption entries covering a CTH, most specific first.
 *
 * Never auto-applied: every entry is bound to a description and most to a
 * condition (an end-use undertaking, a registration, a certificate), so these
 * are candidates for a reviewer or a model that can read the goods, not an
 * answer. `bcdExemptionNotification()` is the number to file against once one
 * is chosen.
 *
 * "Any Chapter" entries are left out unless asked for: they are the importer-
 * driven exemptions (diplomatic baggage, defence stores, goods re-imported
 * after repair), which no code lookup can rule in, and there are enough of
 * them to bury the entries that actually name the chapter.
 */
export function bcdExemptionMatches(
  cth: string,
  opts?: { includeAnyChapter?: boolean },
): BcdExemptionEntry[] {
  const matches = matchesFor(BCD_EXEMPTIONS, cth);
  return opts?.includeAnyChapter ? matches : matches.filter((e) => (specMatch(e, cth) ?? 0) > 0);
}

/** ICES-form number of the BCD exemption notification, e.g. "045/2025". */
export function bcdExemptionNotification(): string {
  return BCD_EXEMPTION_NOTIFICATION;
}

/**
 * The conditions an exemption entry cites, in citation order.
 *
 * Returns the whole condition, not just its prose: the number is what a job
 * records against, and `kinds` is what decides whether the condition means
 * "chase a certificate", "print a declaration" or "this importer must already
 * hold an IIN and a continuity bond".
 */
export function bcdConditions(entry: BcdExemptionEntry): BcdConditionMaster[] {
  return entry.conditions
    .map((no) => BCD_CONDITIONS.find((c) => c.table === entry.table && c.no === no))
    .filter((c): c is BcdConditionMaster => Boolean(c));
}

/** The full text of the conditions an exemption entry cites, in citation order. */
export function bcdConditionTexts(entry: BcdExemptionEntry): string[] {
  return bcdConditions(entry).map((c) => c.text);
}

/**
 * Whether a concession is still available on a given date.
 *
 * An entry with no proviso never lapses. One with a proviso lapses the day
 * after the date it names — and that date is only right if the amendments that
 * move it have been applied, which is why this and `isStale` belong together.
 */
export function isInForce(entry: BcdExemptionEntry, onIsoDate: string): boolean {
  return !entry.validUntil || entry.validUntil >= onIsoDate;
}

/**
 * Whether an entry has been overtaken by an amendment we could not apply.
 *
 * A stale entry is still the best evidence of what the concession *was*, so it
 * is still worth showing — but its rate must not be applied, because the text
 * it was read from is no longer the text in force.
 */
export function isStale(entry: BcdExemptionEntry): boolean {
  return Boolean(entry.staleBy?.length);
}

/**
 * The conditions that bind a particular sub-item of an entry.
 *
 * An entry that enumerates end uses does not impose all its conditions on all
 * of them: S.No. 160 cites 3 and 19, but 19 — supply the newsprint to a
 * registered newspaper — binds only the newsprint sub-item. Asking about the
 * entry as a whole over-states the obligation for everyone else.
 */
export function bcdSubEntryConditions(
  entry: BcdExemptionEntry,
  label: string,
): BcdConditionMaster[] {
  const sub = entry.subEntries?.find((s) => s.label === label.toLowerCase());
  if (!sub) return bcdConditions(entry);
  return sub.conditions
    .map((no) => BCD_CONDITIONS.find((c) => c.table === entry.table && c.no === no))
    .filter((c): c is BcdConditionMaster => Boolean(c));
}

/**
 * Whether a concession can only be claimed by following the IGCR Rules 2022.
 *
 * When the entry enumerates end uses, pass the sub-item — the answer can
 * differ between them. Without one this answers for the entry as a whole,
 * which is the safe direction: it says "IGCR" whenever any sub-item needs it.
 */
export function requiresIgcr(entry: BcdExemptionEntry, subEntryLabel?: string): boolean {
  const conditions = subEntryLabel ? bcdSubEntryConditions(entry, subEntryLabel) : bcdConditions(entry);
  return conditions.some((c) => c.kinds.includes('igcr'));
}

export function lookupPort(codeOrName: string): PortMaster | undefined {
  const q = codeOrName.trim().toLowerCase();
  return PORTS.find((p) => p.code.toLowerCase() === q || p.name.toLowerCase().includes(q));
}

/**
 * An Indian custom house by site code, legacy EDI code, or name.
 *
 * Exact code matches are tried before names: "Mumbai" is a substring of several
 * station names, where INBOM1 is one station.
 */
export function lookupCustomHouse(codeOrName: string): CustomHouseMaster | undefined {
  const q = codeOrName.trim().toUpperCase();
  if (!q) return undefined;

  const byCode = CUSTOM_HOUSES.find((h) => h.code === q || h.ediCode === q);
  if (byCode) return byCode;

  const lower = q.toLowerCase();
  const exactName = CUSTOM_HOUSES.find((h) => h.name.toLowerCase() === lower);
  if (exactName) return exactName;

  // Only when it is unambiguous — a partial name matching four stations is not
  // an answer, and a Bill of Entry filed at the wrong custom house is rejected.
  const partial = CUSTOM_HOUSES.filter((h) => h.name.toLowerCase().includes(lower));
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * An airline by air waybill prefix, IATA code, ICAO code, or name.
 *
 * The prefix is the useful one: `020-1234 5675` on a master air waybill names
 * Lufthansa whatever the issuing-agent line happens to say. Pass either the
 * bare prefix or the whole MAWB number.
 */
export function lookupAirline(value: string | undefined | null): AirlineMaster | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();

  // "020-1234 5675", "020 12345675" or just "020".
  const prefix = /^(\d{3})\b/.exec(raw.replace(/^\s+/, ''));
  if (prefix) {
    const byPrefix = AIRLINES.find((a) => a.awbPrefix === prefix[1]);
    if (byPrefix) return byPrefix;
  }

  if (/^[0-9A-Z]{2}$/.test(upper)) {
    const byIata = AIRLINES.find((a) => a.iata === upper);
    if (byIata) return byIata;
  }
  if (/^[A-Z]{3}$/.test(upper)) {
    const byIcao = AIRLINES.find((a) => a.icao === upper);
    if (byIcao) return byIcao;
  }

  const lower = upper.toLowerCase();
  const exact = AIRLINES.find((a) => a.name.toLowerCase() === lower);
  if (exact) return exact;

  const partial = AIRLINES.filter(
    (a) => a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase()),
  );
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * A foreign port by its UN/LOCODE, exactly.
 *
 * Separate from the name lookups because those match on substrings, and a
 * five-letter code is short enough to collide with one.
 */
export function foreignPortByUnlocode(unlocode: string | undefined | null): ForeignPortMaster | undefined {
  if (!unlocode) return undefined;
  const q = unlocode.trim().toUpperCase();
  return /^[A-Z]{5}$/.test(q) ? FOREIGN_PORTS.find((p) => p.unlocode === q) : undefined;
}

/** Match a foreign port/airport from free text like "MOMBASA, KENYA" or "BOSTON". */
export function lookupForeignPort(text: string): ForeignPortMaster | undefined {
  const q = text.trim().toLowerCase();
  if (!q) return undefined;
  return FOREIGN_PORTS.find(
    (p) =>
      q.includes(p.name.toLowerCase()) ||
      p.unlocode.toLowerCase() === q ||
      (p.aliases ?? []).some((a) => q.includes(a.toLowerCase())),
  );
}

/** ICES "Name(UNLOCODE)" display for a port, e.g. "Boston(USBOS)". */
export function formatForeignPort(p: ForeignPortMaster): string {
  return `${p.name}(${p.unlocode})`;
}

/** Normalize an invoice unit to an ICES-standard UQC. */
export function normalizeUqc(unit: string): { uqc: string; changed: boolean } {
  const raw = unit.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (VALID_UQC.has(raw)) return { uqc: raw, changed: false };
  const mapped = UQC_NORMALIZATION[raw];
  if (mapped) return { uqc: mapped, changed: mapped !== raw };
  return { uqc: 'NOS', changed: true };
}

/**
 * FTA scheme applicable for a COO: matched on the certificate heading/scheme
 * text plus origin country membership.
 */
export function lookupFtaScheme(cooSchemeText: string, originCountry: string): FtaSchemeMaster | undefined {
  const text = cooSchemeText.toLowerCase();
  const country = originCountry.trim().toLowerCase();
  return FTA_SCHEMES.find(
    (s) =>
      (text.includes(s.cooHeadingPattern.toLowerCase()) || text.includes(s.scheme.toLowerCase())) &&
      s.countries.some((c) => c.toLowerCase() === country),
  );
}

/** Exchange rates effective on a given date (latest table not after the date). */
export function exchangeRatesOn(isoDate: string): ExchangeRateTable {
  const applicable = allExchangeRates().filter((e) => e.effectiveFrom <= isoDate).sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const table = applicable[applicable.length - 1] ?? allExchangeRates()[0];
  if (!table) throw new Error('no exchange rate tables seeded');
  return table.rates;
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(M\/S|MS|PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|INC)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fuzzy importer lookup by any name variant seen on shipping documents. */
export function lookupImporter(name: string): ImporterMaster | undefined {
  const q = normalizeName(name);
  if (!q) return undefined;
  return allImporters().find((imp) =>
    [imp.name, ...imp.aliases].some((candidate) => {
      const c = normalizeName(candidate);
      return c === q || c.includes(q) || q.includes(c);
    }),
  );
}

/** What the declaration rules read off a draft. Structural, so core needs no extraction types. */
export interface DeclarationInput {
  invoices: { srNo: number }[];
  items: {
    invoiceSrNo: number;
    slNo: number;
    ritc: string;
    bcdExemption?: { notification: string; scheme?: string };
  }[];
  singleWindowInfo?: { invoiceSrNo?: number; itemSlNo: number; infoType: string; qualifier: string }[];
}

/** One row of the STATEMENT table. */
export interface DeclarationStatement {
  /** 0 for a job-wide declaration. */
  invSrNo: number;
  /** 0 for a job- or invoice-wide declaration. */
  itemSrNo: number;
  type: 'DEC';
  code: string;
}

/**
 * The declarations a Bill of Entry files, each at the scope it covers.
 *
 * Rows come out in the order the Logi-Sys checklist prints them: job-wide
 * first, then each invoice followed by its lines. Within a line the codes keep
 * master order, so PC002 and DC007 come before CUF02, as on ex_job2 and ex_job6.
 *
 * Mandatory-document exceptions (REM rows naming a doc code) are not produced:
 * they need the CBIC Compulsory Compliance Requirements for the CTH, which no
 * master holds yet.
 */
export function declarationStatements(input: DeclarationInput): DeclarationStatement[] {
  const row = (invSrNo: number, itemSrNo: number, code: string): DeclarationStatement => ({
    invSrNo,
    itemSrNo,
    type: 'DEC',
    code,
  });
  const byTrigger = (...triggers: DeclarationMaster['trigger'][]) =>
    DECLARATIONS.filter((d) => triggers.includes(d.trigger));

  const ftaNotifications = new Set(FTA_SCHEMES.map((s) => s.notification));
  const applies = (d: DeclarationMaster, item: DeclarationInput['items'][number]): boolean => {
    switch (d.trigger) {
      // PC002 and the SW_ADDL_INFO chemical rows share one scope, by
      // construction: Circular 23/2023's chapters 28/29/32/39 + heading 3808.
      case 'chemical':
        return isChemicalDeclarationCth(item.ritc);
      case 'drug-category':
        // A row without an invoice serial predates it being recorded: invoice 1.
        return (input.singleWindowInfo ?? []).some(
          (sw) =>
            (sw.invoiceSrNo ?? 1) === item.invoiceSrNo &&
            sw.itemSlNo === item.slNo &&
            /drug related category/i.test(sw.qualifier),
        );
      case 'fta':
        return Boolean(
          item.bcdExemption &&
            (item.bcdExemption.scheme || ftaNotifications.has(item.bcdExemption.notification)),
        );
      default:
        return false;
    }
  };

  const rows = byTrigger('job').map((d) => row(0, 0, d.code));
  const perItem = byTrigger('chemical', 'drug-category', 'fta');
  for (const invoice of input.invoices) {
    for (const d of byTrigger('invoice')) rows.push(row(invoice.srNo, 0, d.code));
    for (const item of input.items.filter((it) => it.invoiceSrNo === invoice.srNo)) {
      for (const d of perItem) if (applies(d, item)) rows.push(row(invoice.srNo, item.slNo, d.code));
    }
  }
  return rows;
}

/** The distinct declarations filed, with their text — the checklist's code table. */
export function declarationTexts(statements: DeclarationStatement[]): { code: string; text: string }[] {
  const filed = new Set(statements.map((s) => s.code));
  return DECLARATIONS.filter((d) => filed.has(d.code)).map((d) => ({ code: d.code, text: d.text }));
}

export function chaProfile(): ChaProfile {
  return CHA_PROFILE;
}

/** Single Window / PGA rule applicable to a tariff chapter, if any. */
export function singleWindowRuleForChapter(chapter: number) {
  return SINGLE_WINDOW_RULES.find((r) => chapter >= r.chapters[0] && chapter <= r.chapters[1]);
}

export {
  crossCheckRow,
  crossCheckTariffBook,
  tariffDissent,
  type Corroboration,
  type CrossCheck,
  type CrossCheckReport,
  type TariffDissent,
} from './tariff-cross-check.js';
export * from './item-masters.js';

// ---------------------------------------------------------------------------
// Re-import — which entry of which notification a returning consignment claims.
// docs/boe-mapping/09-re-import.md is the contract.
// ---------------------------------------------------------------------------

/**
 * What the shipping bill's Part-I summary says the export claimed.
 *
 * The bill prints these as one row of Y/N boxes under the headings `MODE`,
 * `ASSESS`, `EXMN`, `JOBBING`, `MEIS`, `DBK`, `RODTP`, `LICENCE`, `DFRC`,
 * `RE-EXP`, `LUT`. Every field is optional because a box that could not be read
 * is not the same as a box that says N — `ex_job3`'s and `ex_job29`'s bills
 * both extract with the row mis-aligned against its headings.
 */
export interface ReImportExportSchemeFlags {
  /** `DBK` — drawback of Union customs or excise duty. */
  drawback?: boolean;
  stateDrawback?: boolean;
  /** Exported on payment of IGST with a refund claimed. */
  igstRefundClaimed?: boolean;
  /** `LUT` — exported under bond or letter of undertaking, no IGST paid. */
  lut?: boolean;
  exciseRebate?: boolean;
  exciseBond?: boolean;
  /** `LICENCE` — DEEC, Advance Authorisation, DFIA or EPCG. */
  licence?: boolean;
  /** `DFRC` — Duty Free Replenishment Certificate, the same family. */
  dfrc?: boolean;
  depb?: boolean;
  /** `RODTP`. */
  rodtep?: boolean;
  roSctl?: boolean;
  /** `MEIS` — a Chapter-3 reward scheme, which shortens the time limit. */
  meis?: boolean;
}

/** Why the goods are coming back, when a document or the instruction says. */
export type ReImportPurpose =
  | 'returned'
  | 'repairs-abroad'
  | 'stones-treated-abroad'
  | 'exhibition-or-consignment'
  | 'sez-aircraft-parts'
  | 'repairs-in-india'
  | 'reprocessing-in-india';

export interface ReImportCandidateInput {
  /** The shipping bill's date, ISO. */
  sbDate?: string;
  /** The section 51 LEO date, when the bill prints one. Falls back to `sbDate`. */
  leoDate?: string;
  /** When the Bill of Entry is being filed, ISO. Defaults to today. */
  beDate?: string;
  schemeFlags?: ReImportExportSchemeFlags;
  purpose?: ReImportPurpose;
  /** The goods are of the Fourth Schedule, so the excise side applies. */
  fourthScheduleGoods?: boolean;
  /** Exported by a 100% EOU or an FTZ unit, or out of a warehouse. */
  exportedByEouOrFromWarehouse?: boolean;
  /** Ownership changed between export and re-import — fatal to Sl. 2. */
  ownershipChanged?: boolean;
  /** Where the goods went, for the Bhutan machinery limit. */
  destinationCountry?: string;
  /** Circular 21/2019 measures an exhibition return from the delivery challan. */
  deliveryChallanDate?: string;
}

/** An entry the export could claim, with the reason and anything to look at. */
export interface ReImportCandidate {
  entry: ReImportEntry;
  /** Why this entry is on the list, in the operator's language. */
  because: string;
  /** Reasons to look again. Non-empty does not mean unavailable. */
  cautions: string[];
}

/** One entry by notification and serial, both in `NNN/YYYY` and `1E` form. */
export function reImportEntry(notification: string, serial: string): ReImportEntry | undefined {
  const s = serial.trim().toUpperCase();
  const n = logisysNotn(notification) ?? logisysNotn(expandTwoDigitYear(notification));
  return RE_IMPORT_NOTIFICATIONS.find((e) => e.notification === n && e.serial === s);
}

/**
 * `158/95` -> `158/1995`, so a notification written the way the trade says it
 * still finds its entry.
 *
 * The master holds four-digit years because that is the only form any golden
 * shows and the only form `logisysNotn` produces. Whether Logi-Sys wants
 * `158/1995` or `158/95` in `Notn_No` is [unverified](../../../docs/boe-mapping/open-questions.md) —
 * every populated example we hold is a notification of 2017 or later.
 */
function expandTwoDigitYear(value: string): string {
  return value.replace(/(\d{1,3})\s*\/\s*(\d{2})(?!\d)/, (_m, serial: string, year: string) => {
    const y = Number(year);
    return `${serial}/${y >= 50 ? 1900 + y : 2000 + y}`;
  });
}

/** Whole months from `from` to `to`, both ISO dates. */
function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.NaN;
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

export interface ReImportTimeLimit {
  limitMonths: number;
  extensionMonths: number;
  /** Months from the shipping bill to the filing. `NaN` when a date is missing. */
  elapsedMonths: number;
  withinLimit: boolean;
  /** Inside the limit plus the extension a Commissioner may allow. */
  withinExtension: boolean;
}

/**
 * How long the goods had to come back, and whether they did.
 *
 * The limit is the entry's, except for the one case the notification makes a
 * country rule rather than a scheme rule: machinery and equipment exported to
 * Bhutan otherwise than under a duty exemption or reward scheme get seven years
 * and a three-year extension.
 *
 * Being late is not fatal — the proviso lets a Principal Commissioner or
 * Commissioner extend on sufficient cause, which `ex_job29` did with a shipping
 * bill extension letter — so this reports rather than decides.
 */
export function reImportTimeLimit(
  entry: ReImportEntry,
  input: ReImportCandidateInput,
): ReImportTimeLimit {
  const bhutan = /^bhutan$/i.test(input.destinationCountry?.trim() ?? '');
  const scheme = entry.scheme;
  const underSchemeOrReward =
    scheme === 'dutyExemptionScheme' || scheme === 'depb' || input.schemeFlags?.meis === true;

  let limitMonths = entry.timeLimitMonths;
  let extensionMonths = entry.extensionMonths;
  if (bhutan && !underSchemeOrReward && entry.notification !== '158/1995') {
    limitMonths = 84;
    extensionMonths = 36;
  }
  // Circular 21/2019: an exhibition or consignment return is measured from the
  // delivery challan, not the shipping bill, and gets six months.
  let from = input.sbDate;
  if (input.purpose === 'exhibition-or-consignment' && input.deliveryChallanDate) {
    limitMonths = 6;
    extensionMonths = 0;
    from = input.deliveryChallanDate;
  }

  const to = input.beDate ?? new Date().toISOString().slice(0, 10);
  const elapsedMonths = from ? monthsBetween(from, to) : Number.NaN;
  const known = Number.isFinite(elapsedMonths);
  return {
    limitMonths,
    extensionMonths,
    elapsedMonths,
    withinLimit: !known || elapsedMonths <= limitMonths,
    withinExtension: !known || elapsedMonths <= limitMonths + extensionMonths,
  };
}

/**
 * Why these goods are outside the re-import notifications altogether, if they
 * are.
 *
 * Separate from the candidate list because "no entry applies" and "we could not
 * work out which entry applies" are different answers and need different words
 * in front of an operator. `reImportNotificationCandidates` returns an empty
 * list in both cases; this says which one it was.
 */
export function reImportExclusion(input: ReImportCandidateInput): string | undefined {
  if (input.purpose === 'repairs-in-india' || input.purpose === 'reprocessing-in-india') {
    return undefined;
  }
  if (input.exportedByEouOrFromWarehouse === true) {
    return (
      'These goods were exported by a 100% export-oriented undertaking or a unit in a Free Trade ' +
      'Zone, or out of a warehouse. The second proviso to 45/2017 and 46/2017 puts them outside ' +
      'those notifications entirely, so the re-import exemption has to come from somewhere else.'
    );
  }
  return undefined;
}

/**
 * The entries a re-import could be claiming, best-supported first.
 *
 * Deliberately returns a list. A real shipping bill sets more than one scheme
 * flag — `ex_job3`'s has RoDTEP and LICENCE and a LUT number in its marks, and
 * was filed `1E`; `ex_job29`'s has DBK and RoDTEP, also filed `1E` — and one row
 * carries one entry. Which one Kuberr claims when several fit is
 * [not settled](../../../docs/boe-mapping/open-questions.md), so nothing here
 * picks: the caller shows these and a person chooses.
 *
 * An empty list means no entry fits, which is itself an answer — the usual
 * cause is a consignment the exclusions rule out.
 */
export function reImportNotificationCandidates(
  input: ReImportCandidateInput,
): ReImportCandidate[] {
  const purpose = input.purpose ?? 'returned';
  const flags = input.schemeFlags ?? {};

  // ---- 158/95 is a different question, not a different answer to this one ----
  // These goods have not been abroad for anything; they have come here to be
  // worked on and will go out again.
  if (purpose === 'repairs-in-india' || purpose === 'reprocessing-in-india') {
    const serial = purpose === 'repairs-in-india' ? '1' : '2';
    const entry = reImportEntry('158/1995', serial);
    if (!entry) return [];
    return [
      {
        entry,
        because:
          purpose === 'repairs-in-india'
            ? 'The goods were made in India and have come back to be repaired or reconditioned here.'
            : 'The goods were made in India and have come back to be reprocessed, refined or re-made here.',
        cautions: [
          'This exemption runs against a bond undertaking to re-export within six months, so the ' +
            'filing also needs a BONDS_CERTIFICATES row.',
          ...timeCautions(entry, input),
        ],
      },
    ];
  }

  // ------------------------------------------------- which notification ----
  const leo = input.leoDate ?? input.sbDate;
  const preGst = leo !== undefined && leo < '2017-07-01';
  const family = preGst ? '094/1996' : input.fourthScheduleGoods ? '046/2017' : '045/2017';

  if (reImportExclusion(input)) return [];

  const of = (serial: string) => reImportEntry(family, serial);
  const out: ReImportCandidate[] = [];
  const add = (entry: ReImportEntry | undefined, because: string, cautions: string[] = []) => {
    if (!entry) return;
    out.push({ entry, because, cautions: [...cautions, ...timeCautions(entry, input)] });
  };

  // ---- purposes that displace Sl. 1 outright ----
  if (purpose === 'repairs-abroad') {
    add(
      of('2'),
      'The goods were sent out to be repaired and are coming back repaired.',
      [
        'Duty is on the fair cost of repairs including materials, plus insurance and freight ' +
          'both ways — so RE-IMPORT needs the export leg’s freight and insurance, in rupees, ' +
          'apportioned to the line.',
        'Notification 36/2021 and Circular 16/2021 confirm that value carries IGST and ' +
          'compensation cess as well as basic customs duty.',
        ...(input.ownershipChanged === true
          ? [
              'Ownership changed between export and re-import. Clause (e) of the proviso rules ' +
                'this entry out when it does.',
            ]
          : []),
      ],
    );
  }
  if (purpose === 'stones-treated-abroad') {
    add(of('3'), 'Cut and polished stones sent out for treatment are coming back treated.');
  }
  if (purpose === 'sez-aircraft-parts') {
    add(
      of('4'),
      'Aircraft parts replaced during maintenance in an SEZ, moving to the rest of India.',
      ['Nil only if the parts go back to the owner of the aircraft without a sale.'],
    );
  }
  if (purpose === 'exhibition-or-consignment') {
    add(
      of(family === '094/1996' ? '3' : '5'),
      'Goods returning from an exhibition or a consignment sale. Circular 21/2019 puts these ' +
        'under the residuary entry even though they went out under a LUT: taking them out of ' +
        'India was never a supply, so no integrated tax was ever payable and clause 1(d) does ' +
        'not apply.',
      ['The circular allows six months from the delivery challan, not the usual three years.'],
    );
    return out;
  }

  // ---- what the export claimed ----
  const bySchemeFlag: [boolean | undefined, string, string][] = [
    [flags.drawback, '1A', 'The shipping bill claims drawback (DBK).'],
    [flags.stateDrawback, '1B', 'The export claimed drawback of a State excise duty.'],
    [
      flags.igstRefundClaimed,
      '1C',
      'The export went out on payment of IGST with a refund claimed.',
    ],
    [flags.lut, '1D', 'The shipping bill carries a LUT or bond, so no IGST was paid at export.'],
    [flags.exciseRebate, '1C', 'The export claimed rebate of Central excise duty.'],
    [flags.exciseBond, '1D', 'The export went under bond without paying Central excise duty.'],
    [
      flags.licence || flags.dfrc,
      '1E',
      'The shipping bill shows a licence or DFRC — a duty exemption scheme (DEEC, Advance ' +
        'Authorisation, DFIA) or EPCG.',
    ],
    [flags.depb, '2A', 'The export went under the Duty Entitlement Passbook scheme.'],
    [flags.rodtep, '1F', 'The shipping bill claims RoDTEP.'],
    [flags.roSctl, '1G', 'The export claimed RoSCTL.'],
  ];

  // 45/2017 has no excise clauses and 46/2017 has no remission ones, so an
  // entry that does not exist in the chosen family is simply skipped.
  const seen = new Set<string>();
  for (const [set, serial, because] of bySchemeFlag) {
    if (set !== true || seen.has(serial)) continue;
    const entry = of(serial);
    if (!entry) continue;
    seen.add(serial);
    add(
      entry,
      because,
      serial === '1E'
        ? [
            'This entry is conditional: the DEEC book must not be closed, the authorisation not ' +
              'redeemed, the EPCG performance period not expired, and the re-import intimated to ' +
              'the licensing authority.',
          ]
        : [],
    );
  }

  // ---- the residuary entry ----
  // Always offered. Nothing claimed at export is the ordinary case for a
  // rejected or unsold consignment coming home, and it is also the fallback
  // when the shipping bill's flag row could not be read.
  add(
    of(family === '094/1996' ? '3' : '5'),
    out.length
      ? 'The residuary entry, if what the shipping bill shows was not actually claimed for these goods.'
      : 'Nothing on the shipping bill shows an incentive claimed at export.',
  );

  return out;
}

/** The one caution every entry can carry: the goods came back late. */
function timeCautions(entry: ReImportEntry, input: ReImportCandidateInput): string[] {
  const limit = reImportTimeLimit(entry, input);
  if (!Number.isFinite(limit.elapsedMonths) || limit.withinLimit) return [];
  const years = (m: number) => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);
  if (limit.withinExtension) {
    return [
      `The goods came back ${limit.elapsedMonths} months after export, past this entry's ` +
        `${years(limit.limitMonths)}. A Principal Commissioner or Commissioner may extend it by up ` +
        `to ${years(limit.extensionMonths)} on sufficient cause — the extension letter has to be on the job.`,
    ];
  }
  return [
    `The goods came back ${limit.elapsedMonths} months after export. This entry allows ` +
      `${years(limit.limitMonths)}` +
      (limit.extensionMonths
        ? ` and an extension of at most ${years(limit.extensionMonths)}`
        : '') +
      ', so the exemption is out of time.',
  ];
}
