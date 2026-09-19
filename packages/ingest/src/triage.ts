import { z } from 'zod';
import { MODELS, structuredPdfCall } from '@checklist/extraction/openai';
import type { Database } from '@checklist/db';

export type DocumentType = Database['public']['Enums']['document_type'];

/**
 * The document classes the watcher recognises.
 *
 * This list and `DOC_TYPES` in `@checklist/extraction` are two classifiers over
 * the same post, and they have drifted before: the freight and insurance
 * certificates were added there and not here, so a mail carrying only those
 * triaged as `unknown`. A new type belongs in three places — here, in
 * `DOC_TYPES`, and in the Postgres `document_type` enum.
 */
export const TRIAGE_DOC_TYPES = [
  'invoice',
  'bill_of_lading',
  'air_waybill',
  'packing_list',
  'certificate_of_origin',
  'certificate_of_analysis',
  // The export leg of a re-import. Enough on its own to open a job: a mail
  // carrying a shipping bill is a re-import being set up.
  'shipping_bill',
  'freight_certificate',
  'insurance_certificate',
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
  'shipping_bill',
  'freight_certificate',
  'insurance_certificate',
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

  // What the delivery order desk needs off the face of a B/L. Captured here for
  // the same reason as everything else: the document is in front of the model
  // exactly once, and the DO desk needs these days before anyone builds a
  // checklist draft. Null on every document that is not a B/L.
  blSurrenderIndication: z.enum(['surrendered', 'original']).nullable(),
  detentionFreeDays: z.number().nullable(),
  shippingLine: z.string().nullable(),
  containerMode: z.enum(['FCL', 'LCL']).nullable(),
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
- shipping_bill: an ICES SHIPPING BILL — an Indian EXPORT document, headed "INDIAN CUSTOMS EDI SYSTEM" with a "Port Code", "SB No" and "SB Date" header block. Attached when goods that were exported are being re-imported. An import checklist is not one.
- freight_certificate: a forwarder's or carrier's certificate of the freight charged on this consignment
- insurance_certificate: a marine insurance certificate or a declaration under an open policy
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

Delivery order fields — bills of lading only, null on everything else:
- blSurrenderIndication: 'surrendered' only when the document itself says so — a TELEX RELEASE, EXPRESS RELEASE, SURRENDERED or SEAWAY BILL stamp or wording. 'original' when it is an original negotiable B/L with no such marking. Null if you cannot tell. Do not infer surrender from the absence of a stamp: surrender usually happens after issue and the B/L never records it.
- detentionFreeDays: the free detention period in days, when the B/L states one — "21 DAYS FREE DETENTION AT FINAL DESTINATION" is 21, "Applicable free time 14 days detention" is 14. The number of days only. Null when no free period is printed. Do not use free time at the port of loading, and do not confuse detention (the carrier's box) with demurrage (the terminal's ground rent) — if the document only gives demurrage, return null.
- shippingLine: the carrier issuing the B/L, as printed on it — the line itself, not its Indian agent and not the freight forwarder.
- containerMode: 'FCL' or 'LCL' when the B/L says which. Null otherwise.

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
 *
 * PDFs and photographs are both readable. A Word or Excel attachment is not, and
 * throws — the caller records it as `unknown` rather than losing the file.
 */
export async function triageDocument(
  fileName: string,
  data: Buffer,
  mimeType = 'application/pdf',
): Promise<TriageResult> {
  const { data: triage, model } = await structuredPdfCall({
    schema: TriageSchema,
    schemaName: 'document_triage',
    system: SYSTEM,
    userText: `Triage this attachment. File name: ${fileName}`,
    fileName,
    pdf: data,
    mimeType,
    model: MODELS.classify,
    escalateModel: MODELS.extract,
  });
  return { ...triage, model };
}
