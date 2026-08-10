import { z } from 'zod';
import { MODELS, structuredPdfCall } from '@checklist/extraction/openai';
import type { Database } from '@checklist/db';

export type DocumentType = Database['public']['Enums']['document_type'];

/**
 * The document classes the watcher recognises. A superset of the legacy
 * pipeline's seven — `license` and `svb_order` matter for customs clearance and
 * `unknown` replaces the old `other`.
 */
export const TRIAGE_DOC_TYPES = [
  'invoice',
  'bill_of_lading',
  'air_waybill',
  'packing_list',
  'certificate_of_origin',
  'certificate_of_analysis',
  'license',
  'svb_order',
  'unknown',
] as const;

/** Anything in this set is enough on its own to justify opening a job. */
export const TRADE_DOCUMENT_TYPES: readonly DocumentType[] = [
  'invoice',
  'bill_of_lading',
  'air_waybill',
  'packing_list',
  'certificate_of_origin',
  'certificate_of_analysis',
  'license',
  'svb_order',
];

export const TriageSchema = z.object({
  docType: z.enum(TRIAGE_DOC_TYPES),
  reason: z.string(),
  blNumber: z.string().nullable(),
  awbNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  containerNumbers: z.array(z.string()),
  poNumber: z.string().nullable(),
  importerName: z.string().nullable(),
  supplierName: z.string().nullable(),

  // The digest. This is what makes every later scrutiny step text-only: the
  // PDF is read once here and never uploaded to a model again.
  summary: z.string(),
  goodsDescription: z.string().nullable(),
  hsCodes: z.array(z.string()),
});

export type Triage = z.infer<typeof TriageSchema>;

const SYSTEM = `You are triaging documents attached to emails at an Indian customs house agent.

Return the document type and only the identifiers that let us tell one shipment from another. Do NOT extract line items, values or duty — a separate pass does that.

Document types:
- invoice: commercial/proforma invoice from the supplier
- bill_of_lading: sea B/L or house B/L (HBL). Has a vessel and a voyage
- air_waybill: air waybill, master (MAWB) or house (HAWB). Has flight details
- packing_list: package/carton breakdown with weights and dimensions
- certificate_of_origin: COO, including preferential/FTA certificates
- certificate_of_analysis: COA, test or analysis report for the goods
- license: an import licence or permit (DGFT, FSSAI, WPC, drug licence, etc.)
- svb_order: a Special Valuation Branch order or SVB investigation letter
- unknown: anything else, including cover letters, quotations and signatures

Identifier rules:
- blNumber: the carrier's B/L number exactly as printed. For a house B/L use the HBL number. Null unless this document actually carries one.
- awbNumber: air waybill number. Keep the digits; the 3-digit airline prefix is part of it.
- invoiceNumber: supplier's invoice number, not any internal reference.
- containerNumbers: every container number shown, in the standard 4 letters + 7 digits form.
- poNumber: buyer's purchase order number if present.
- importerName / supplierName: the consignee/buyer in India and the overseas seller.

Digest — this is the only record of the document's contents that is kept, so make it count:
- summary: two or three sentences. What this document is, who issued it, what it covers, and anything a customs broker would want flagged (a certificate's validity dates, a licence number, a declared origin, a restriction).
- goodsDescription: what is actually being imported, in the document's own words. Null on documents that do not describe goods.
- hsCodes: every HS/CTH/RITC code printed on the document, digits only, as written. Usually only the invoice carries these. Empty array if there are none — do not infer a code from the goods description, because a guessed code pulls in the wrong compliance requirements.

Return null rather than guessing. A wrong identifier attaches documents to the wrong shipment, which is worse than no identifier at all.`;

export interface TriageResult extends Triage {
  model: string;
}

/**
 * Classifies one attachment and pulls out its matching keys in a single call.
 *
 * Deliberately not the full extraction pipeline: running `extractDoc` on every
 * inbound attachment would cost an order of magnitude more and add minutes of
 * latency per tick, and none of the line-item detail is needed to answer
 * "which job does this belong to?".
 */
export async function triageDocument(fileName: string, pdf: Buffer): Promise<TriageResult> {
  const { data, model } = await structuredPdfCall({
    schema: TriageSchema,
    schemaName: 'document_triage',
    system: SYSTEM,
    userText: `Triage this attachment. File name: ${fileName}`,
    fileName,
    pdf,
    model: MODELS.classify,
    escalateModel: MODELS.extract,
  });
  return { ...data, model };
}
