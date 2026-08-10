/**
 * Value formatting for the Logi-Sys import spreadsheet.
 *
 * Every rule here exists because the first manual attempt at this workbook got
 * it wrong in a way a spreadsheet made easy: Excel inferred types, and the
 * inference was wrong. Nothing below lets a type be inferred.
 */

/**
 * How dates are written.
 *
 * Logi-Sys prints `30-Jun-2026` on its own checklist and its date inputs show
 * `dd-mmm-yyyy` as a placeholder, so that is the shape it reads back. Dates go
 * in as *text*: the template declares no number formats at all (`<numFmts>` is
 * empty and every `cellXf` is General), so a serial would arrive as a bare
 * integer with no format hint, leaving Logi-Sys to guess both an epoch and a
 * 1900-leap-year convention.
 *
 * CONFIRM against a real upload. It is one constant precisely so that a
 * different answer is a one-line change.
 */
export const LOGISYS_DATE_FORMAT = 'DD-MMM-YYYY';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-06-30` -> `30-Jun-2026`.
 *
 * Done by string slicing, never `new Date()`. Constructing a Date from
 * `'2026-06-30'` yields UTC midnight, which renders as the 29th anywhere west
 * of Greenwich — a CI box in a negative offset would silently shift every date
 * on the Bill of Entry by a day.
 */
export function formatLogisysDate(iso: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return undefined;
  return `${day}-${monthName}-${year}`;
}

/**
 * Round to a fixed number of decimals without leaving float noise in the XML.
 *
 * `1.20757 * 1` can serialise as `1.2075699999999999`; going through toFixed
 * and back gives the number Logi-Sys expects to see.
 */
export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Decimal places for money amounts and for unit prices. */
export const AMOUNT_DP = 2;
export const UNIT_PRICE_DP = 6;

/**
 * XML-escape a text value, and drop characters XML cannot carry.
 *
 * Both halves matter. Supplier addresses contain `&`, and `Marks_&_Nos` values
 * come straight off a B/L. Control characters come from OCR'd PDF text and make
 * Excel refuse to open the file at all.
 */
export function escapeXml(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Column number (1-based) to spreadsheet letters: 1 -> A, 27 -> AA. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
