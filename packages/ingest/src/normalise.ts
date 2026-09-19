import { isValidContainerNumber as isValid } from '@checklist/core';
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
 * The ISO 6346 check-digit validator, which now lives in `@checklist/core`
 * beside the size/type helpers.
 *
 * It moved because the CONTAINERS sheet needs it too: extraction has to be able
 * to tell a misread container number from a real one, and depending on the
 * ingest package to do that would have the mail pipeline sitting underneath the
 * Bill of Entry pipeline. Re-exported here so every existing caller and the
 * identifier tests keep their import.
 */
export { isValidContainerNumber } from '@checklist/core';

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
  return isValid(v) ? v : null;
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
