import type { Tables } from '@checklist/db';

export type DocumentType = Tables<'job_documents'>['doc_type'];

/**
 * Deliberately outside `lib/jobs.ts`, which is `server-only`: the drop zone is a
 * client component and needs to name what it just read off each file.
 */
export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  bill_of_lading: 'Bill of Lading',
  air_waybill: 'Air Waybill',
  packing_list: 'Packing List',
  certificate_of_origin: 'Certificate of Origin',
  certificate_of_analysis: 'Certificate of Analysis',
  license: 'Licence',
  svb_order: 'SVB Order',
  checklist: 'Checklist (from Logi-Sys)',
  unknown: 'Unrecognised',
};
