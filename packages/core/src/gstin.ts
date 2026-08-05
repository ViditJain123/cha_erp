/**
 * Offline GSTIN sanity checks (format, embedded PAN, state code, check digit).
 * A live GSTN-verification API can be layered on top later; these checks catch
 * typos and extraction mistakes without any network call.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit per the official mod-36 algorithm. */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < first14.length; i++) {
    const value = ALPHABET.indexOf(first14[i]!);
    if (value < 0) throw new Error(`invalid GSTIN character ${first14[i]}`);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36]!;
}

export interface GstinCheckResult {
  valid: boolean;
  problems: string[];
}

export function validateGstin(gstin: string, opts?: { pan?: string; stateCode?: string }): GstinCheckResult {
  const problems: string[] = [];
  const g = gstin.trim().toUpperCase();

  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g)) {
    problems.push(`GSTIN "${g}" does not match the standard format.`);
    return { valid: false, problems };
  }
  const check = gstinCheckDigit(g.slice(0, 14));
  if (check !== g[14]) {
    problems.push(`GSTIN check digit is wrong (expected ${check}) — likely a typo or misread character.`);
  }
  if (opts?.pan && g.slice(2, 12) !== opts.pan.trim().toUpperCase()) {
    problems.push(`PAN inside GSTIN (${g.slice(2, 12)}) differs from PAN on record (${opts.pan}).`);
  }
  if (opts?.stateCode && g.slice(0, 2) !== opts.stateCode.trim()) {
    problems.push(`GSTIN state code ${g.slice(0, 2)} differs from importer state code ${opts.stateCode}.`);
  }
  return { valid: problems.length === 0, problems };
}
