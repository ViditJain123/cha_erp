import {
  CHA_PROFILE,
  DECLARATIONS,
  FOREIGN_PORTS,
  FTA_SCHEMES,
  PORTS,
  SINGLE_WINDOW_RULES,
  UQC_NORMALIZATION,
  VALID_UQC,
  type ChaProfile,
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
