import { formatLogisysDate } from './format.js';

/**
 * A single cell of the Logi-Sys import workbook.
 *
 * The whole point of this type is that a cell's kind is *declared*, never
 * inferred. Handing `'0510226'` to a spreadsheet and letting it decide is how
 * the AD code lost its leading zero on the first manual attempt.
 *
 * There is deliberately no numeric kind. A workbook Logi-Sys exported itself
 * (`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx`) writes every one of
 * its cells as a string — `1`, `100000.000000`, `0.00`, `4000.000` — with a
 * fixed number of decimals per column and never a numeric cell anywhere. So
 * numbers here are formatted, not stored: the constructors below each name a
 * precision, and a caller cannot omit one.
 */
export type Cell =
  | { kind: 'text'; value: string }
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

/**
 * A number, written with exactly `decimals` decimal places.
 *
 * `toFixed` is the whole implementation on purpose: it both rounds and pads, so
 * `0` at 2dp is `0.00` and `1.20757` at 6dp is `1.207570`, which is the shape
 * Logi-Sys writes. Going through a Number round-trip instead would give back
 * `0` and `1.20757`, and would let float noise like `1.2075699999999999` reach
 * the XML.
 */
export function decimal(value: number | null | undefined, decimals: number): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return BLANK;
  return { kind: 'text', value: value.toFixed(decimals) };
}

/** A whole number: a serial, a count, a container size. */
export function int(value: number | null | undefined): Cell {
  if (value === null || value === undefined || !Number.isFinite(value)) return BLANK;
  return { kind: 'text', value: String(Math.round(value)) };
}

/** A money amount (2dp): invoice value, freight, insurance, duty rates in %. */
export function money(value: number | null | undefined): Cell {
  return decimal(value, 2);
}

/** A weight, package count or quantity the vendor writes at 3dp. */
export function weight(value: number | null | undefined): Cell {
  return decimal(value, 3);
}

/** A percentage on the INVOICES charge block (4dp). */
export function percent(value: number | null | undefined): Cell {
  return decimal(value, 4);
}

/** The 5dp columns: anti-dumping per-unit amounts and the SVB loading rates. */
export function rate5(value: number | null | undefined): Cell {
  return decimal(value, 5);
}

/** A line quantity, unit price, measure or exchange rate (6dp). */
export function qty(value: number | null | undefined): Cell {
  return decimal(value, 6);
}

/**
 * `cell` unless it is blank, in which case `fallback`.
 *
 * For the columns Logi-Sys fills with an explicit `0` / `0.00` on every export
 * even when the value is unknown: the mapper spreads a per-sheet zeros object
 * and then names the column again with the real value, so this is what keeps
 * the zero when there is no real value to name.
 */
export function orElse(cell: Cell, fallback: Cell): Cell {
  return cell.kind === 'blank' ? fallback : cell;
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
