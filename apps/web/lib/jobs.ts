import 'server-only';
import type { Tables } from '@checklist/db';
import { formatStamp } from './dates';

export type JobStage = Tables<'jobs'>['stage'];

// Document labels live in their own module so client components can read them
// without dragging `server-only` in behind them.
export { DOC_TYPE_LABELS } from './document-types';
export type { DocumentType } from './document-types';

export const STAGE_LABELS: Record<JobStage, string> = {
  new: 'New',
  documents_received: 'Documents received',
  exported: 'Exported to Logi-Sys',
  scrutiny: 'In scrutiny',
  awaiting_shipper: 'Awaiting shipper',
  checklist_revision: 'Checklist being revised',
  // Not "At noting" any more: noting is one token inside the clearance track,
  // which owns the job from here to delivery.
  noting: 'With clearance',
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

export const IDENTIFIER_LABELS: Record<Tables<'job_identifiers'>['kind'], string> = {
  bl: 'B/L',
  awb: 'AWB',
  invoice: 'Invoice',
  container: 'Container',
  po: 'PO',
  conversation: 'Email thread',
};

/**
 * Scrutiny records "no requirement applies" as an event rather than a column:
 * it is a decision someone made at a point in time, and close-out reads it back
 * the same way suggestShipper reads the drafted email out of the log.
 */
export const CCR_WAIVED_EVENT = 'scrutiny.ccr_waived';

export const EVENT_LABELS: Record<string, string> = {
  'job.created_from_mail': 'Job opened from an email',
  'job.created_manually': 'Job created',
  'mail.attached': 'Documents attached from an email',
  'mail.ambiguous': 'An email matched more than one job',
  'job.created_from_upload': 'Job opened from dropped documents',
  'upload.attached': 'Dropped documents attached',
  'upload.ambiguous': 'Dropped documents matched more than one job',
  'draft.generated': 'Documents read into a checklist draft',
  'export.generated': 'Logi-Sys spreadsheet exported',
  'checklist.uploaded': 'Checklist PDF uploaded',
  'job.details_recorded': 'Branch, job number and ETA recorded',
  'scrutiny.started': 'Scrutiny started',
  'ccr.created': 'Compliance requirement added to the master',
  'scrutiny.ccr_waived': 'Recorded as needing no compliance requirement',
  'scrutiny.assessed': 'Compliance requirements assessed',
  'shipper.requested': 'Documents requested from the shipper',
  'request.document_uploaded': 'Document uploaded against a request',
  'scrutiny.reconciled': 'Arrived documents checked against the requests',
  'checklist.revision_requested': 'Sent back for a revised checklist',
  'scrutiny.completed': 'Shipper told the checklist is final — scrutiny done',
  'party.bound': 'Party set from the organization repository',

  // The delivery order runs beside scrutiny, but writes to the same timeline.
  'do.opened': 'Delivery order tracking started',
  'do.bl_checked': 'Bill of lading checked for the DO',
  'do.free_time_set': 'Detention free period recorded',
  'do.mode_set': 'Delivery mode and security decided',
  'do.security_waived': 'Recorded as needing no container deposit',
  'do.document_added': 'Document added to the DO checklist',
  'do.document_settled': 'DO document received or waived',
  'do.hss_flagged': 'Flagged as a high sea sale',
  'do.hss_docs_sent': 'High sea sales documents sent to the shipping line',
  'do.invoice_recorded': "Shipping line's invoice recorded",
  'do.invoice_scrutinised': "Shipping line's invoice scrutinised",
  'do.accounts_notified': 'Accounts told a payment is due',
  'do.invoice_paid': 'Shipping line paid',
  'do.proof_sent': 'Payment details sent to the shipping line',
  'do.received': 'Delivery order received',
  'do.operations_notified': 'Operations told the DO is ready',
  'do.delivered': 'Delivery taken',
  'do.deposit_updated': 'Container deposit updated',
  'do.closed': 'Delivery order closed',

  // Customs clearance: noting through to delivery.
  'checklist.duty_recorded': 'Duty on the checklist recorded',
  'clearance.opened': 'Customs clearance started',
  'clearance.noted': 'Bill of entry noted',
  'clearance.rms_routed': 'RMS routed the bill of entry',
  'clearance.passed': 'Passing recorded',
  'clearance.duty_checked': 'Assessed duty checked against the checklist',
  'clearance.duty_variance': 'Assessed duty differs — sent back to scrutiny',
  'clearance.variance_resolved': 'Duty variance closed',
  'clearance.query_raised': 'Customs raised a query',
  'clearance.query_answered': 'Customs query answered',
  'clearance.duty_paid': 'Duty paid',
  'clearance.shed': 'Goods registration and examination recorded',
  'clearance.noc_updated': 'An agency clearance was updated',
  'clearance.out_of_charge': 'Out of charge granted',
  'clearance.delivery_planned': 'A delivery day was put to the CFS',
  'clearance.delivery_approved': 'The CFS confirmed the delivery day',
  'clearance.delivery_refused': 'The CFS refused the delivery day',
  'clearance.delivered': 'Goods delivered',
};

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return formatStamp(iso);
}
