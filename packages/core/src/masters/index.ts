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
  CUSTOM_HOUSES,
  DECLARATIONS,
  FOREIGN_PORTS,
  FTA_SCHEMES,
  IGST_RATE_NOTIFICATION,
  IGST_RESIDUAL_ENTRY,
  IGST_SCHEDULE,
  PORTS,
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
  type TariffCodeSpec,
  type TariffMaster,
} from './data.js';
import { allExchangeRates, allImporters, allTariff } from './store.js';
import type { ExchangeRateTable } from '../types.js';

export * from './data.js';
export * from './store.js';
export * from './codes.js';
export * from './party-name.js';

export function lookupTariff(cth: string): TariffMaster | undefined {
  return allTariff().find((t) => t.cth === cth);
}

/**
 * Resolve a partial (e.g. 6-digit) HS code to a full 8-digit tariff row.
 * Returns the row only when the prefix matches exactly one entry —
 * ambiguous prefixes need human resolution.
 */
export function lookupTariffByPrefix(hsPrefix: string): TariffMaster | undefined {
  const p = hsPrefix.replace(/\D/g, '');
  if (p.length < 4) return undefined;
  const matches = allTariff().filter((t) => t.cth.startsWith(p));
  return matches.length === 1 ? matches[0] : undefined;
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

export interface DeclarationContext {
  ftaClaimed: boolean;
  isChemicalWithoutCas: boolean;
  isFood: boolean;
}

/** Declaration codes applicable to a job, per the masters rules. */
export function applicableDeclarations(ctx: DeclarationContext): DeclarationMaster[] {
  return DECLARATIONS.filter((d) => {
    switch (d.rule) {
      case 'always':
      case 'invoice':
        return true;
      case 'fta':
        return ctx.ftaClaimed;
      case 'chemical-no-cas':
        return ctx.isChemicalWithoutCas;
      case 'food':
        return ctx.isFood;
      case 'manual':
        return false;
    }
  });
}

export function chaProfile(): ChaProfile {
  return CHA_PROFILE;
}

/** Single Window / PGA rule applicable to a tariff chapter, if any. */
export function singleWindowRuleForChapter(chapter: number) {
  return SINGLE_WINDOW_RULES.find((r) => chapter >= r.chapters[0] && chapter <= r.chapters[1]);
}
