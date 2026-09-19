import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TariffMaster } from './data.js';

/**
 * The printed Customs Tariff, parsed and committed.
 *
 * `packages/core/scripts/build-tariff-book.py` reads BDP's Customs Tariff
 * 2026-27 — three scanned volumes, 3,218 pages — into the JSON this module
 * loads. It is the base layer of the tariff master: ~12,000 tariff items where
 * the hand-typed seed in data.ts has three.
 *
 * Why JSON on disk rather than a generated .ts like its siblings: at 12,000
 * rows the literal would be several megabytes that `tsc` and Next re-parse on
 * every build, where igst-schedule.ts at 1,195 entries is already 288 KB.
 *
 * ## How far a row can be trusted
 *
 * The source is an OCR'd scan, so every row carries the tier the build graded
 * it at. `verified` means the row's rates reconcile against the TOTAL printed
 * beside them and there is nothing to doubt. `repaired` means they reconcile
 * once a decimal point OCR dropped is restored. `unverified` means no reading
 * reconciled: those rows are kept, because knowing a tariff item exists is
 * worth something even when its rate is not readable, but they are for
 * proposing to a human and must never be applied on their own.
 */

export type TariffConfidence = 'verified' | 'repaired' | 'unverified';

/** A row exactly as the build script emits it. */
export interface TariffBookRow {
  cth: string;
  description: string;
  unit?: string;
  unitUncertain?: boolean;
  basicBcdRate?: number;
  effectiveBcdRate?: number;
  prefBcdRate?: number;
  igstRate?: number;
  swsRate?: number;
  swsOfAv?: number;
  totalIncidencePercent?: number;
  rateText?: string;
  impPolicy?: string;
  expPolicy?: string;
  remarks?: string;
  /** Notifications the REMARKS column cites — the join into Volume II. */
  notificationRefs?: TariffBookNotificationRef[];
  concessions?: TariffBookConcession[];
  variants?: TariffBookVariant[];
  confidence: TariffConfidence;
  page: number;
}

export interface TariffBookNotificationRef {
  /** As printed, mangling and all: "Ntfn 45/2025-Gus. - SlNo.25". */
  printed: string;
  /** Normalised to the form the masters use: "045/2025". */
  notification: string;
  /** The entry within the notification, where the book names one. */
  serial?: string;
  /**
   * Who issued it. DGFT numbers against a policy period or financial year
   * ("20/2015-2020", "44/2025-26") and CBIC against the calendar year; the two
   * share numbers and years, so without this a policy notification would be
   * read as the customs notification that happens to match.
   */
  authority?: 'CBIC' | 'DGFT';
}

export interface TariffBookConcession {
  notification: string;
  printed: string;
  description: string;
  effectiveBcdRate?: number;
  igstRate?: number;
  remarks?: string;
}

export interface TariffBookVariant {
  description: string;
  basicBcdRate?: number;
  effectiveBcdRate?: number;
  igstRate?: number;
  totalIncidencePercent?: number;
  page: number;
}

export interface TariffBookFile {
  source: string;
  publisher: string;
  edition: string;
  builtAt: string;
  sha256: string;
  rowCount: number;
  checksumPassRate: number;
  confidence: Record<TariffConfidence, number>;
  unverified: string[];
  rows: TariffBookRow[];
}

/** An entry of Volume III's alphabetical product index. */
export interface ProductIndexEntry {
  /** The printed product name, with the entry it hangs under where it has one. */
  term: string;
  /** Headings it points at: '8516' or '851640'. */
  headings: string[];
  /** The reference as printed, e.g. '8460.11-90, Ch. 84-3'. */
  printed: string;
  page: number;
}

export interface ProductIndexFile {
  source: string;
  edition: string;
  entryCount: number;
  headingCount: number;
  headingsNotInSchedule: string[];
  entries: ProductIndexEntry[];
}

const GENERATED_DIR = 'packages/core/src/masters/generated/tariff-book';

/**
 * Assembled rather than written as a literal, for the reason
 * packages/exporter/src/template.ts documents at length: webpack
 * pattern-matches `new URL('<literal>', import.meta.url)` and rewrites it into
 * an asset module whose copy the route cannot then read. Keeping the specifier
 * out of a literal leaves the expression alone.
 */
function moduleRelative(file: string): string {
  return ['.', 'generated', 'tariff-book', file].join('/');
}

/**
 * Every place the file might legitimately be, most specific first. Bundlers,
 * `next dev` and a serverless trace each root the process somewhere different,
 * so one fixed path cannot cover them.
 */
function candidatePaths(file: string): string[] {
  const candidates: string[] = [];

  const override = process.env.TARIFF_BOOK_DIR;
  if (override) candidates.push(path.join(override, file));

  try {
    candidates.push(fileURLToPath(new URL(moduleRelative(file), import.meta.url)));
  } catch {
    // import.meta.url is not a file URL under some bundlers; the walk covers it.
  }

  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth++) {
    candidates.push(path.join(dir, GENERATED_DIR, file));
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return candidates;
}

/** Reads one generated tariff-book artefact, or null when it is not built. */
export function loadTariffBookFile<T>(file: string): T | null {
  for (const candidate of candidatePaths(file)) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')) as T;
    } catch {
      // Try the next one; only an exhausted list means it is absent.
    }
  }
  return null;
}

let schedule: TariffBookFile | null | undefined;
let productIndex: ProductIndexFile | null | undefined;

/**
 * The parsed schedule, or null when it has not been built.
 *
 * Unlike the export template this degrades rather than throwing: the book is a
 * base layer under the seed and the overlay, so an installation without it
 * still resolves every CTH those two carry. The masters page reports whether
 * it loaded.
 */
export function tariffBook(): TariffBookFile | null {
  if (schedule === undefined) {
    schedule = loadTariffBookFile<TariffBookFile>('schedule.json');
    // Degrading is right for a checkout that has not built the book. It is
    // wrong for a deployment, where it means the file was not bundled — and
    // nothing else would say so: drafts still build, every line just goes back
    // to "BCD rate needs manual entry". Said once, where the logs will show it.
    if (!schedule && process.env.NODE_ENV === 'production') {
      console.error(
        '[tariff-book] schedule.json is missing from this deployment. The tariff master has ' +
          'fallen back to the three-row seed. Check outputFileTracingIncludes in ' +
          'apps/web/next.config.ts, or set TARIFF_BOOK_DIR.',
      );
    }
  }
  return schedule;
}

/**
 * The edition a citation should name, e.g. "2026-27". Falls back to a word
 * rather than a year when the book is not built: naming an edition we did not
 * read would make the citation a lie.
 */
export function tariffEdition(): string {
  return tariffBook()?.edition ?? 'current';
}

export function productIndexFile(): ProductIndexFile | null {
  if (productIndex === undefined)
    productIndex = loadTariffBookFile<ProductIndexFile>('product-index.json');
  return productIndex;
}

/**
 * The book's rows in TariffMaster shape.
 *
 * A row is only offered as a master row when the book states both a BCD and an
 * IGST rate for it. The rest — rows whose rate is a form of words ("20% or
 * Rs.X per piece, whichever is higher"), and rows the OCR left unreadable —
 * stay available through `tariffBook()` for proposing to a reviewer, but they
 * are not something `lookupTariff` should answer a duty question with.
 *
 * AIDC and compensation cess come through as zero, and that is a reading
 * rather than a default: the book folds both into its TOTAL column, so for
 * every `verified` and `repaired` row the checksum reconciling *without* an
 * additional term is positive evidence that neither applies. For `unverified`
 * rows it is not evidence of anything, which is what provenance.confidence is
 * there to say.
 */
export function tariffBookMasters(): TariffMaster[] {
  const file = tariffBook();
  if (!file) return [];
  const out: TariffMaster[] = [];
  for (const row of file.rows) {
    const bcd = row.basicBcdRate ?? row.effectiveBcdRate;
    if (bcd === undefined || row.igstRate === undefined) continue;
    out.push({
      cth: row.cth,
      description: row.description,
      bcdRate: bcd,
      unit: row.unit ?? '',
      igstRate: row.igstRate,
      igstNotification: '009/2025',
      aidcRate: 0,
      aidcNotification: '011/2021',
      compCessRate: 0,
      compCessNotification: '001/2017',
      ...(row.basicBcdRate !== undefined && { basicBcdRate: row.basicBcdRate }),
      ...(row.effectiveBcdRate !== undefined && { effectiveBcdRate: row.effectiveBcdRate }),
      ...(row.prefBcdRate !== undefined && { prefBcdRate: row.prefBcdRate }),
      ...(row.swsRate !== undefined && { swsRate: row.swsRate }),
      ...(row.swsOfAv !== undefined && { swsOfAv: row.swsOfAv }),
      ...(row.totalIncidencePercent !== undefined && {
        totalIncidencePercent: row.totalIncidencePercent,
      }),
      ...(row.impPolicy && { impPolicy: row.impPolicy }),
      ...(row.expPolicy && { expPolicy: row.expPolicy }),
      ...(row.remarks && { remarks: row.remarks }),
      ...(row.notificationRefs && { notificationRefs: row.notificationRefs }),
      ...(row.concessions && { concessions: row.concessions }),
      ...(row.variants && { variants: row.variants }),
      provenance: {
        source: 'book',
        page: row.page,
        edition: file.edition,
        confidence: row.confidence,
      },
    });
  }
  return out;
}
