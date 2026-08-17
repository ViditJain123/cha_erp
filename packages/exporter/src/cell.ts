import {
  AMOUNT_DP,
  UNIT_PRICE_DP,
  formatLogisysDate,
  roundTo,
} from './format.js';

/**
 * A single cell of the Logi-Sys import workbook.
 *
 * The whole point of this type is that a cell's kind is *declared*, never
 * inferred. Handing `'0510226'` to a spreadsheet and letting it decide is how
 * the AD code lost its leading zero on the first manual attempt.
 */
export type Cell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'blank' };

export const BLANK: Cell = { kind: 'blank' };

/**
 * Free text. Empty and whitespace-only values collapse to blank.
 *
 * Internal runs of whitespace collapse to a single space, because extracted
 * values carry the line breaks of the document they came from — a carrier name
 * read off an air waybill arrived as "DSV AIR & SEA INC\nBOSTON", and a newline
 * inside a cell is not something to put on a declaration.
 */
export function text(value: string | number | null | undefined): Cell {
  if (value === null || value === undefined) return BLANK;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s ? { kind: 'text', value: s } : BLANK;
}

/**
 * An identifier that must never be treated as a number.
 *
 * Behaves exactly like `text()` today. It exists to mark intent at the call
 * site, so a reviewer scanning a mapper can see which values are deliberately
 * strings, and so `grep code\(` finds every one of them. Two cases where it is
 * load-bearing rather than decorative:
 *
 *   - AD code `0510226` — as a number it becomes 510226.
 *   - COO number `250377141204202410` — 18 digits, past the point where a
 *     float64 holds integers exactly, so it becomes 250377141204202000.
 */
export function code(value: string | null | undefined): Cell {
  return text(value);
}

/** A quantity, weight, rate or count. */
export function num(value: number | null | undefined): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return BLANK;
  return { kind: 'number', value };
}

/** A money amount, rounded to the given precision (default 2dp). */
export function money(value: number | null | undefined, decimals: number = AMOUNT_DP): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return BLANK;
  return { kind: 'number', value: roundTo(value, decimals) };
}

/** A unit price, which needs more precision than an amount (6dp). */
export function unitPrice(value: number | null | undefined): Cell {
  return money(value, UNIT_PRICE_DP);
}

/** An ISO `YYYY-MM-DD` date, written as text in the Logi-Sys format. */
export function isoDate(value: string | null | undefined): Cell {
  if (!value) return BLANK;
  const formatted = formatLogisysDate(value);
  return formatted ? { kind: 'text', value: formatted } : BLANK;
}

/**
 * A yes/no flag.
 *
 * `undefined` stays blank rather than becoming `N`, so "we do not know" and
 * "no" remain distinguishable on a customs declaration.
 */
export function yn(value: boolean | null | undefined): Cell {
  if (value === null || value === undefined) return BLANK;
  return { kind: 'text', value: value ? 'Y' : 'N' };
}
