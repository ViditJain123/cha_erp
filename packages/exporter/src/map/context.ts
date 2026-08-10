import type { ChecklistDraft } from '@checklist/extraction';

/** The job record that travels with a draft, for reference fields and naming. */
export interface ExportJob {
  id: string;
  reference: string | null;
}

/**
 * What a sheet mapper is given, and how it reports what it could not fill.
 *
 * Two severities, because they need different handling:
 *
 *   - `warn` — a column we would have liked to fill and could not. The export
 *     still happens; the operator sees the list and completes those fields in
 *     Logi-Sys. Most of the 200-odd unmapped columns are simply not applicable
 *     and never warn at all; these are the ones that are applicable and missing.
 *
 *   - `blocker` — the workbook would misstate something to Customs. The export
 *     does not happen. An incomplete Bill of Entry costs an operator ten
 *     minutes; a confidently wrong one is a misdeclaration.
 */
export interface MapContext {
  draft: ChecklistDraft;
  job: ExportJob;
  warn(path: string, message: string): void;
  blocker(path: string, message: string): void;
}

export interface MapIssue {
  path: string;
  message: string;
}

export interface IssueCollector {
  context(draft: ChecklistDraft, job: ExportJob): MapContext;
  warnings: MapIssue[];
  blockers: MapIssue[];
}

export function createCollector(): IssueCollector {
  const warnings: MapIssue[] = [];
  const blockers: MapIssue[] = [];
  return {
    warnings,
    blockers,
    context: (draft, job) => ({
      draft,
      job,
      warn: (path, message) => warnings.push({ path, message }),
      blocker: (path, message) => blockers.push({ path, message }),
    }),
  };
}
