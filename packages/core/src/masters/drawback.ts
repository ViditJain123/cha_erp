import { loadTariffBookFile } from './tariff-book.js';

/**
 * All Industry Rates of duty drawback, as the printed tariff sets them out
 * after each chapter.
 *
 * Drawback is money back on re-export, so it matters to a broker — but it is
 * keyed by its *own* serials, not by tariff items. 61150106 is a drawback
 * serial; no Bill of Entry declares it. They are HS-aligned at the heading, so
 * a CTH reaches them by prefix, longest first, the same way a notification's
 * code spec does.
 *
 * **Nothing here is verified.** The rate table checks itself — every row's
 * TOTAL is a function of its other cells, so a mis-read digit breaks the
 * arithmetic — and this table has no such property. A drawback rate is a
 * percentage of FOB with a cap and nothing on the row constrains it, so an
 * OCR'd 12% and an OCR'd 1.2% are equally readable and only one is right.
 * `rateUncertain` marks the rates an order of magnitude out of step with their
 * chapter, which is what a lost decimal point looks like, but the unflagged
 * ones are unchecked rather than confirmed.
 *
 * Treat every value here as a prompt to open the Department of Revenue's own
 * schedule, never as a figure to claim.
 */

export interface DrawbackEntry {
  /** The drawback serial as printed: '0201', '61150106'. */
  serial: string;
  description: string;
  unit?: string;
  /** Percentage of FOB value. */
  rate: number;
  /** The cell verbatim, because the parsed value cannot be checked. */
  ratePrinted: string;
  /** Cap in rupees per unit, where one is printed. */
  capRupees?: number;
  /** An order of magnitude out of step with its chapter — probably a lost decimal point. */
  rateUncertain?: boolean;
  page: number;
}

export interface DrawbackFile {
  source: string;
  edition: string;
  entryCount: number;
  uncertainRates: number;
  verified: false;
  note: string;
  entries: DrawbackEntry[];
}

let file: DrawbackFile | null | undefined;
let byPrefix: Map<string, DrawbackEntry[]> | null = null;

export function drawbackFile(): DrawbackFile | null {
  if (file === undefined) file = loadTariffBookFile<DrawbackFile>('drawback.json');
  return file;
}

/**
 * Drawback entries covering a CTH, most specific first.
 *
 * Returns every matching serial rather than one answer, because the prefix that
 * matches is often a whole heading and the goods decide which of its entries
 * applies — the same shape as every other lookup here.
 */
export function lookupDrawback(cth: string): DrawbackEntry[] {
  if (!byPrefix) {
    byPrefix = new Map();
    for (const entry of drawbackFile()?.entries ?? []) {
      const key = entry.serial.slice(0, 4);
      const list = byPrefix.get(key);
      if (list) list.push(entry);
      else byPrefix.set(key, [entry]);
    }
  }
  const code = cth.replace(/\D/g, '');
  if (code.length < 4) return [];
  return (byPrefix.get(code.slice(0, 4)) ?? [])
    .filter((e) => code.startsWith(e.serial.slice(0, Math.min(e.serial.length, code.length))) ||
      e.serial.length === 4)
    .sort((a, b) => b.serial.length - a.serial.length);
}
