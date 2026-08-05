import { z } from 'zod';

/**
 * Zod schemas for OpenAI Structured Outputs (strict mode: every field present,
 * unknown/absent values are null — never omitted).
 */

export const DOC_TYPES = [
  'invoice',
  'bill_of_lading',
  'air_waybill',
  'packing_list',
  'certificate_of_origin',
  'certificate_of_analysis',
  'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const ClassificationSchema = z.object({
  docType: z.enum(DOC_TYPES),
  reason: z.string(),
});

const money = z.object({ amount: z.number(), currency: z.string() });

export const InvoiceItemSchema = z.object({
  description: z.string(),
  hsCode: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number(),
  /** true when the line is a charge (freight/handling/insurance), not goods */
  isCharge: z.boolean(),
  batchNo: z.string().nullable(),
  manufactureDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const InvoiceExtractSchema = z.object({
  invoiceNumber: z.string(),
  invoiceDate: z.string().nullable(),
  sellerName: z.string(),
  sellerAddressLines: z.array(z.string()),
  sellerCountry: z.string().nullable(),
  buyerName: z.string().nullable(),
  currency: z.string(),
  /** Incoterm / delivery terms exactly as printed, e.g. "CIF NHAVA SHEVA", "Ex-Works Taunton, MA" */
  deliveryTermsRaw: z.string().nullable(),
  /** Normalised terms of invoice */
  termsOfInvoice: z.enum(['FOB', 'CIF', 'CFR', 'C&F', 'EXW', 'CPT', 'UNKNOWN']),
  paymentTerms: z.string().nullable(),
  purchaseOrderNumber: z.string().nullable(),
  items: z.array(InvoiceItemSchema),
  freightCharge: money.nullable(),
  insuranceCharge: money.nullable(),
  totalAmount: z.number().nullable(),
  netWeightKg: z.number().nullable(),
  grossWeightKg: z.number().nullable(),
  countryOfOrigin: z.string().nullable(),
  portOfLoading: z.string().nullable(),
  portOfDischarge: z.string().nullable(),
  /** Fields the model could not read confidently (dotted paths). */
  uncertainFields: z.array(z.string()),
});

export const ContainerSchema = z.object({
  number: z.string(),
  sizeType: z.string().nullable(),
  sealNo: z.string().nullable(),
});

export const BlExtractSchema = z.object({
  blNumber: z.string(),
  /** shipped-on-board date if present, else issue date */
  blDate: z.string().nullable(),
  issueDate: z.string().nullable(),
  isHouseBl: z.boolean(),
  shipperName: z.string(),
  shipperAddressLines: z.array(z.string()),
  consigneeName: z.string().nullable(),
  notifyPartyName: z.string().nullable(),
  shippingLine: z.string().nullable(),
  vesselVoyage: z.string().nullable(),
  portOfLoading: z.string().nullable(),
  portOfDischarge: z.string().nullable(),
  placeOfDelivery: z.string().nullable(),
  packageCount: z.number().nullable(),
  packageUnit: z.string().nullable(),
  cargoDescription: z.string().nullable(),
  marksAndNumbers: z.string().nullable(),
  grossWeightKg: z.number().nullable(),
  netWeightKg: z.number().nullable(),
  measurementCbm: z.number().nullable(),
  hsCode: z.string().nullable(),
  invoiceNumberRef: z.string().nullable(),
  freightTerms: z.string().nullable(),
  containers: z.array(ContainerSchema),
  /** true when the document carries a DRAFT watermark/stamp or says non-negotiable draft */
  isDraftDocument: z.boolean(),
  uncertainFields: z.array(z.string()),
});

export const AwbExtractSchema = z.object({
  mawbNumber: z.string(),
  hawbNumber: z.string().nullable(),
  awbDate: z.string().nullable(),
  shipperName: z.string(),
  shipperAddressLines: z.array(z.string()),
  consigneeName: z.string().nullable(),
  issuingCarrierOrAgent: z.string().nullable(),
  airportOfDeparture: z.string().nullable(),
  airportOfDestination: z.string().nullable(),
  flightAndDate: z.string().nullable(),
  pieces: z.number().nullable(),
  grossWeightKg: z.number().nullable(),
  chargeableWeightKg: z.number().nullable(),
  natureOfGoods: z.string().nullable(),
  hsCode: z.string().nullable(),
  deliveryTerms: z.string().nullable(),
  referenceNumbers: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

export const CooExtractSchema = z.object({
  certificateNumber: z.string(),
  issueDate: z.string().nullable(),
  /** Scheme heading, e.g. "Duty Free tariff Preference Scheme for Least Developed Countries" */
  schemeText: z.string().nullable(),
  issuingCountry: z.string().nullable(),
  exporterName: z.string().nullable(),
  consigneeName: z.string().nullable(),
  hsCode: z.string().nullable(),
  originCriterion: z.string().nullable(),
  goodsDescription: z.string().nullable(),
  packageCount: z.number().nullable(),
  packageUnit: z.string().nullable(),
  grossWeightKg: z.number().nullable(),
  invoiceNumberRef: z.string().nullable(),
  invoiceDateRef: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

export const CoaProductSchema = z.object({
  productCode: z.string().nullable(),
  description: z.string(),
  batchNo: z.string().nullable(),
  manufactureDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const CoaExtractSchema = z.object({
  certificateDate: z.string().nullable(),
  issuerName: z.string().nullable(),
  referencePo: z.string().nullable(),
  products: z.array(CoaProductSchema),
  uncertainFields: z.array(z.string()),
});

export const PackingListExtractSchema = z.object({
  invoiceNumberRef: z.string().nullable(),
  packageCount: z.number().nullable(),
  packageUnit: z.string().nullable(),
  netWeightKg: z.number().nullable(),
  grossWeightKg: z.number().nullable(),
  marksAndNumbers: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

export type InvoiceExtract = z.infer<typeof InvoiceExtractSchema>;
export type BlExtract = z.infer<typeof BlExtractSchema>;
export type AwbExtract = z.infer<typeof AwbExtractSchema>;
export type CooExtract = z.infer<typeof CooExtractSchema>;
export type CoaExtract = z.infer<typeof CoaExtractSchema>;
export type PackingListExtract = z.infer<typeof PackingListExtractSchema>;

export interface ExtractedDoc {
  fileName: string;
  docType: DocType;
  data:
    | InvoiceExtract
    | BlExtract
    | AwbExtract
    | CooExtract
    | CoaExtract
    | PackingListExtract
    | null;
  /** model that produced the accepted extraction */
  model: string;
}
