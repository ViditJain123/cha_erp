/**
 * HS code handling for CCR lookup.
 *
 * Codes are stored as bare digits with no dots or spaces, the same convention
 * `packages/core/src/masters` uses (`replace(/\D/g, '')`).
 */

/** Strips formatting and caps at the 8 digits India uses (RITC). */
export function normaliseHsCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  // Below four digits is a chapter or heading fragment too coarse to act on —
  // the same floor `lookupTariffByPrefix` applies.
  return digits.length >= 4 ? digits : null;
}

/**
 * Every prefix of an HS code that a requirement could be filed under, longest
 * first: 33049990 → 33049990, 3304999, 330499, 33049, 3304, 330, 33.
 *
 * Turning the *code* into candidate prefixes lets the lookup be an equality
 * match against an indexed column, rather than a `like 'x%'` scan of the whole
 * master.
 */
export function hsPrefixes(code: string, minLength = 2): string[] {
  const digits = code.replace(/\D/g, '');
  const prefixes: string[] = [];
  for (let length = digits.length; length >= minLength; length--) {
    prefixes.push(digits.slice(0, length));
  }
  return prefixes;
}

/** All prefixes for a set of codes, deduplicated. */
export function hsLookupKeys(codes: string[]): string[] {
  const keys = new Set<string>();
  for (const code of codes) {
    const normalised = normaliseHsCode(code);
    if (!normalised) continue;
    for (const prefix of hsPrefixes(normalised)) keys.add(prefix);
  }
  return [...keys];
}

/** True when `hsCode` falls under `prefix`. */
export function hsMatchesPrefix(hsCode: string, prefix: string): boolean {
  const code = hsCode.replace(/\D/g, '');
  const p = prefix.replace(/\D/g, '');
  return p.length > 0 && code.startsWith(p);
}
