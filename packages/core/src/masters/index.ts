import {
  AIRLINES,
  CHA_PROFILE,
  CUSTOM_HOUSES,
  DECLARATIONS,
  FOREIGN_PORTS,
  FTA_SCHEMES,
  PORTS,
  SINGLE_WINDOW_RULES,
  UQC_NORMALIZATION,
  VALID_UQC,
  type AirlineMaster,
  type ChaProfile,
  type CustomHouseMaster,
  type DeclarationMaster,
  type ForeignPortMaster,
  type FtaSchemeMaster,
  type ImporterMaster,
  type PortMaster,
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
