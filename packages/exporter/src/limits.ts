import type { SheetData } from './sheet-writer.js';

/**
 * The longest value any cell of the workbook may carry.
 *
 * A hard rule, not a guideline: `fillTemplate` refuses a longer cell outright,
 * and `enforceCellLimits` is the pass that makes sure it never has to. The
 * number is the customer's — no column of the Bill of Entry is to exceed 120
 * characters — and it sits above every ICES field width the mapping has run
 * into, so a cell that hits it is a description that ran on (ex_job13 wrote a
 * 363-character plant description into Product_Description) rather than a
 * legitimate value being clipped.
 */
export const MAX_CELL_CHARS = 120;

/**
 * Cut every over-long cell to `MAX_CELL_CHARS` and say so, per cell.
 *
 * Mutates the rows in place: the mappers have already declared each cell's
 * kind and formatting, and the cut has to happen after that, on the string
 * that would actually be written. A cut is reported as a warning naming the
 * sheet, the row and the column, with the original length, because a
 * description truncated on a customs declaration is something the operator
 * has to read before it is filed — the export happens, and it is not silent.
 *
 * Whitespace at the cut is trimmed so a value never ends in a space; nothing
 * cleverer than that, because a word boundary is not a safer place to end a
 * tariff description than a character boundary, only a prettier one.
 */
export function enforceCellLimits(
  data: SheetData,
  warn: (path: string, message: string) => void,
): void {
  for (const [sheet, rows] of Object.entries(data)) {
    rows.forEach((row, i) => {
      for (const [header, cell] of Object.entries(row)) {
        if (cell.kind !== 'text' || cell.value.length <= MAX_CELL_CHARS) continue;
        const original = cell.value;
        cell.value = original.slice(0, MAX_CELL_CHARS).trimEnd();
        warn(
          `${sheet}[${i + 1}].${header}`,
          `${original.length} characters, cut to ${MAX_CELL_CHARS} — no cell may be longer. ` +
            `Now reads "${cell.value}". Check the meaning survived, or shorten it on the job.`,
        );
      }
    });
  }
}
