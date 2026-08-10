import type { ChecklistDraft } from '@checklist/extraction';

/** The job record an export is filed against. */
export interface LogisysJob {
  id: string;
  reference: string | null;
}

/**
 * What the exporter needs to build a workbook.
 *
 * The draft is the whole input. An earlier version of this took a job row plus
 * a list of documents and identifiers, which was never enough to fill a Bill of
 * Entry — it could name the containers but not their seals, and knew nothing of
 * line items, values, notifications or origin.
 */
export interface LogisysExportInput {
  draft: ChecklistDraft;
  job: LogisysJob;
}

export interface LogisysExportResult {
  buffer: Buffer;
  fileName: string;
  /** `1.0.0+<template hash>` — identifies generator and vendor template. */
  templateVersion: string;
  /**
   * Columns that apply to this job and could not be filled. The operator
   * completes them in Logi-Sys; they are not silent.
   */
  warnings: string[];
}
