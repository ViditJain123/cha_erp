import type { SheetRow } from '../sheet-writer.js';

/**
 * Where a rule came from, and therefore how much it matters.
 *
 * The two are deliberately not merged. We must satisfy **ices** to file at all;
 * we must satisfy **logisys** only for as long as the handoff through their
 * uploader exists, and their uploader is stricter in places — it makes eleven
 * SUPPORTING_DOCS columns mandatory that ICES treats as optional. Merging them
 * would mean chasing vendor requirements after the vendor is gone, and, worse,
 * would hide which of today's failures are real.
 */
export type RuleSource = 'ices' | 'logisys';

/** One thing that would be rejected, and the published code it is rejected under. */
export interface IcesFinding {
  /** `ERR_CD` for an ICES rule; the vendor's own label for a Logi-Sys one. */
  code: string;
  /** The published `ERR_DESC`, verbatim, or the vendor's message. */
  description: string;
  source: RuleSource;
  sheet: string;
  column: string;
  /** Which row — `Invoice #1 Item #2` — or empty for a sheet-level finding. */
  where: string;
  /** What we actually wrote, and why it fails. */
  detail: string;
}

/** The built workbook, as the rules see it: sheet name to the rows we wrote. */
export type SheetData = Record<string, SheetRow[]>;

export interface IcesRule {
  code: string;
  source: RuleSource;
  sheet: string;
  /** The column this rule is about, for the report. `''` for a whole-row rule. */
  column: string;
  /**
   * Columns the rule reads. A rule whose columns are not in the sheet does not
   * run and is counted as unrunnable rather than passing quietly — a rule that
   * silently no-ops reads exactly like a rule that found nothing.
   */
  reads: string[];
  check(data: SheetData): { where: string; detail: string }[];
}
