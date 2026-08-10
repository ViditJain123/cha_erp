import type { Database } from '@checklist/db';

export type IdentifierKind = Database['public']['Enums']['identifier_kind'];

export interface Identifier {
  kind: IdentifierKind;
  /** Normalised form — what gets stored and compared. */
  value: string;
  /** What the document actually said, kept for display. */
  raw: string;
}

/**
 * Identifier normalisation.
 *
 * The same function must be used when writing job_identifiers and when looking
 * them up. If write-normalisation and read-normalisation ever diverge, matching
 * stops working silently — no errors, jobs just quietly stop being recognised.
 */

function alnum(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validates an ISO 6346 container number including its check digit.
 *
 * The check digit matters: OCR and hurried typing produce plausible-looking
 * container numbers, and an invalid one used as a match key would merge two
 * unrelated shipments.
 */
export function isValidContainerNumber(value: string): boolean {
  const v = alnum(value);
  if (!/^[A-Z]{4}[0-9]{7}$/.test(v)) return false;

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

export function normaliseBl(raw: string): string | null {
  const v = alnum(raw);
  // Short strings collide across shipments; a real B/L number is longer.
  return v.length >= 6 ? v : null;
}

export function normaliseAwb(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // Master air waybills are exactly 11 digits (3-digit airline prefix + 8).
  return digits.length === 11 ? digits : null;
}

export function normaliseInvoice(raw: string): string | null {
  const v = alnum(raw);
  // "INV-1" is a collision magnet; require something with real entropy.
  return v.length >= 5 ? v : null;
}

export function normaliseContainer(raw: string): string | null {
  const v = alnum(raw);
  return isValidContainerNumber(v) ? v : null;
}

export function normalisePo(raw: string): string | null {
  const v = alnum(raw);
  return v.length >= 5 ? v : null;
}

const NORMALISERS: Record<IdentifierKind, (raw: string) => string | null> = {
  bl: normaliseBl,
  awb: normaliseAwb,
  invoice: normaliseInvoice,
  container: normaliseContainer,
  po: normalisePo,
  // Graph's conversationId is opaque and already canonical.
  conversation: (raw) => (raw.trim().length > 0 ? raw.trim() : null),
};

/** Builds an identifier, or null when the raw value fails its format rules. */
export function makeIdentifier(kind: IdentifierKind, raw: string | null | undefined): Identifier | null {
  if (!raw) return null;
  const value = NORMALISERS[kind](raw);
  return value ? { kind, value, raw: raw.trim() } : null;
}

/** Deduplicates on (kind, value). */
export function dedupeIdentifiers(identifiers: Identifier[]): Identifier[] {
  const seen = new Map<string, Identifier>();
  for (const id of identifiers) {
    const key = `${id.kind}:${id.value}`;
    if (!seen.has(key)) seen.set(key, id);
  }
  return [...seen.values()];
}
