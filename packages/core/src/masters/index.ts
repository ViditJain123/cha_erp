import {
  CHA_PROFILE,
  DECLARATIONS,
  EXCHANGE_RATES,
  FTA_SCHEMES,
  IMPORTERS,
  PORTS,
  TARIFF,
  type ChaProfile,
  type DeclarationMaster,
  type FtaSchemeMaster,
  type ImporterMaster,
  type PortMaster,
  type TariffMaster,
} from './data.js';
import type { ExchangeRateTable } from '../types.js';

export * from './data.js';

export function lookupTariff(cth: string): TariffMaster | undefined {
  return TARIFF.find((t) => t.cth === cth);
}

/**
 * Resolve a partial (e.g. 6-digit) HS code to a full 8-digit tariff row.
 * Returns the row only when the prefix matches exactly one entry —
 * ambiguous prefixes need human resolution.
 */
export function lookupTariffByPrefix(hsPrefix: string): TariffMaster | undefined {
  const p = hsPrefix.replace(/\D/g, '');
  if (p.length < 4) return undefined;
  const matches = TARIFF.filter((t) => t.cth.startsWith(p));
  return matches.length === 1 ? matches[0] : undefined;
}

export function lookupPort(codeOrName: string): PortMaster | undefined {
  const q = codeOrName.trim().toLowerCase();
  return PORTS.find((p) => p.code.toLowerCase() === q || p.name.toLowerCase().includes(q));
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
  const applicable = EXCHANGE_RATES.filter((e) => e.effectiveFrom <= isoDate).sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const table = applicable[applicable.length - 1] ?? EXCHANGE_RATES[0];
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
  return IMPORTERS.find((imp) =>
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
