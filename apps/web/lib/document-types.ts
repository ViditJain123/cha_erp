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
  into_bond_be: 'Into-Bond Bill of Entry',
  shipping_bill: 'Shipping Bill (the export these goods left on)',
  gst_tax_invoice: 'GST Tax Invoice (finished product)',
  freight_certificate: 'Freight Certificate',
  insurance_certificate: 'Insurance Certificate',
  purchase_order: 'Purchase Order',
  contract: 'Sale Contract',
  bank_certificate: 'Bank Exchange-Rate Certificate',
  high_seas_agreement: 'High Seas Sale Agreement',
  checklist: 'Checklist (from Logi-Sys)',
  unknown: 'Unrecognised',
};
