import { ICES_ERRORS, icesError } from '@checklist/core';
import { ICES_RULES } from './rules.js';
import type { IcesFinding, SheetData } from './types.js';

export type { IcesFinding, RuleSource, SheetData } from './types.js';
export { ICES_RULES } from './rules.js';

export interface IcesValidation {
  findings: IcesFinding[];
  /**
   * Rules that could not run because the sheet does not carry the column they
   * read. Reported rather than swallowed: a rule that quietly no-ops is
   * indistinguishable from a rule that passed, and that is the failure mode
   * this whole exercise exists to remove.
   */
  unrunnable: { code: string; sheet: string; column: string; missing: string[] }[];
}

/**
 * What ICES would reject about this workbook.
 *
 * ## Report, do not block
 *
 * This runs after the mappers and changes nothing about whether a workbook is
 * produced. That is deliberate for the first pass: the useful output is the
 * *number* — how many of our filings ICES would refuse today — and a validator
 * that starts by blocking exports cannot be measured against the corpus,
 * because the corpus would stop exporting.
 *
 * The rules that prove themselves against real filings can graduate to
 * blockers afterwards, one at a time.
 *
 * ## Why this exists at all
 *
 * Every validation rule this system owned before today was learned by uploading
 * a workbook to Logi-Sys and reading the ErrorList it returned. That makes
 * their uploader our validator, which is the vendor lock stated precisely: we
 * cannot file anywhere else, and we cannot find out how wrong we are without
 * asking them. ICES publishes its own 617 rejection codes, and
 * `packages/core/scripts/build-ices-errors.py` now reads them.
 */
export function validateIces(data: SheetData): IcesValidation {
  const findings: IcesFinding[] = [];
  const unrunnable: IcesValidation['unrunnable'] = [];

  for (const rule of ICES_RULES) {
    const rows = data[rule.sheet];
    if (rows === undefined) continue; // the sheet is not one we map at all

    const missing = rule.reads.filter((c) => rows.length > 0 && rows.every((r) => !(c in r)));
    if (missing.length) {
      unrunnable.push({
        code: rule.code,
        sheet: rule.sheet,
        column: rule.column,
        missing,
      });
      continue;
    }

    const published = rule.source === 'ices' ? icesError(rule.code) : undefined;
    for (const hit of rule.check(data)) {
      findings.push({
        code: rule.code,
        description: published?.description ?? rule.column,
        source: rule.source,
        sheet: rule.sheet,
        column: rule.column,
        where: hit.where,
        detail: hit.detail,
      });
    }
  }

  findings.sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.code.localeCompare(b.code) ||
      a.where.localeCompare(b.where),
  );
  return { findings, unrunnable };
}

/** How many of the published codes any rule here covers. Used by the report. */
export function icesRuleCoverage(): { rules: number; codes: number; published: number } {
  const codes = new Set(ICES_RULES.filter((r) => r.source === 'ices').map((r) => r.code));
  return { rules: ICES_RULES.length, codes: codes.size, published: ICES_ERRORS.length };
}
