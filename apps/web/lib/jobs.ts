import 'server-only';
import type { Tables } from '@checklist/db';

export type JobStage = Tables<'jobs'>['stage'];
export type DocumentType = Tables<'job_documents'>['doc_type'];

export const STAGE_LABELS: Record<JobStage, string> = {
  new: 'New',
  documents_received: 'Documents received',
  exported: 'Exported to Logi-Sys',
  scrutiny: 'In scrutiny',
  awaiting_shipper: 'Awaiting shipper',
  checklist_revision: 'Checklist being revised',
  noting: 'At noting',
  closed: 'Closed',
};

export const STAGE_STYLES: Record<JobStage, string> = {
  new: 'bg-slate-100 text-slate-700',
  documents_received: 'bg-blue-100 text-blue-800',
  exported: 'bg-amber-100 text-amber-800',
  scrutiny: 'bg-violet-100 text-violet-800',
  awaiting_shipper: 'bg-orange-100 text-orange-800',
  checklist_revision: 'bg-amber-100 text-amber-800',
  noting: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-600',
};

/** The order stages progress in — used for boards and for guarding transitions. */
export const STAGE_ORDER: readonly JobStage[] = [
  'new',
  'documents_received',
  'exported',
  'scrutiny',
  'awaiting_shipper',
  'checklist_revision',
  'noting',
  'closed',
];

/** Stages where the documents branch still owns the job. */
export const DOCUMENTS_STAGES: readonly JobStage[] = [
  'new',
  'documents_received',
  'exported',
  'checklist_revision',
];

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

export const IDENTIFIER_LABELS: Record<Tables<'job_identifiers'>['kind'], string> = {
  bl: 'B/L',
  awb: 'AWB',
  invoice: 'Invoice',
  container: 'Container',
  po: 'PO',
  conversation: 'Email thread',
};

export const EVENT_LABELS: Record<string, string> = {
  'job.created_from_mail': 'Job opened from an email',
  'job.created_manually': 'Job created',
  'mail.attached': 'Documents attached from an email',
  'mail.ambiguous': 'An email matched more than one job',
  'draft.generated': 'Documents read into a checklist draft',
  'export.generated': 'Logi-Sys spreadsheet exported',
  'checklist.uploaded': 'Checklist PDF uploaded',
  'job.details_recorded': 'Branch, job number and ETA recorded',
  'scrutiny.started': 'Scrutiny started',
  'scrutiny.assessed': 'Compliance requirements assessed',
  'shipper.requested': 'Documents requested from the shipper',
  'scrutiny.reconciled': 'Arrived documents checked against the requests',
  'checklist.revision_requested': 'Sent back for a revised checklist',
  'scrutiny.completed': 'Shipper told the checklist is final — scrutiny done',
};

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
