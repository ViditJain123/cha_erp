import {
  AwbExtractSchema,
  BlExtractSchema,
  ClassificationSchema,
  CoaExtractSchema,
  CooExtractSchema,
  InvoiceExtractSchema,
  PackingListExtractSchema,
  type DocType,
  type ExtractedDoc,
} from './schemas.js';
import { MODELS, structuredPdfCall } from './openai.js';

const CLASSIFY_SYSTEM = `You classify documents for an Indian customs house agent preparing an import Bill of Entry.
Classify the attached document into exactly one type:
- invoice: commercial invoice from the overseas supplier
- bill_of_lading: ocean/sea bill of lading (MBL or HBL)
- air_waybill: air waybill (MAWB or HAWB)
- packing_list: packing list
- certificate_of_origin: certificate of origin (any scheme/FTA form)
- certificate_of_analysis: certificate of analysis / conformance / quality
- other: anything else (licences, test reports, insurance, correspondence...)
A pre-filing "CheckList - Bill of Entry" print is "other".`;

const EXTRACT_COMMON = `You extract data from import shipment documents for an Indian customs Bill of Entry.
Rules:
- Copy values exactly as printed (numbers, codes, names). Do not invent values.
- The document may be a noisy scan with stamps and handwriting; read carefully.
- Dates: return ISO format YYYY-MM-DD. Interpret ambiguous formats from context (e.g. "04.06.2026" is 4 June 2026 on non-US trade documents; "6/29/26" on US documents is 29 June 2026).
- Set a field to null when it is absent or unreadable; also list any field you are not confident about in uncertainFields (use the field name).
- Weights: convert to kilograms when the unit is stated.`;

const PROMPTS: Record<Exclude<DocType, 'other'>, { system: string; user: string }> = {
  invoice: {
    system: `${EXTRACT_COMMON}
This is a commercial invoice. Item rules:
- Goods line items: description, HS code if printed, quantity with unit, unit price, extended amount.
- hsCode is ONLY a customs HS/HTS/RITC code (6-10 digits, sometimes labelled "HS CODE"). A seller item/part number (e.g. "880FG-UV-8LB") is NOT an HS code — keep such codes as part of the description and set hsCode null.
- Lines that are charges (freight, handling, insurance, documentation...) are NOT goods: set isCharge=true for them and also surface freight as freightCharge when identifiable.
- termsOfInvoice: normalise the Incoterm (CIF/C&F(CFR)/FOB/EXW/CPT). "Ex-Works" is EXW.
- sellerAddressLines: use the seller's own/remit-to address block that identifies the selling entity, not office/plant contact addresses printed in footers.
- sellerCity: the city (or prefecture/province where that is what the address states) from that same block, on its own — the Bill of Entry declares it in a separate field from the address. For "HAMAMATSU SHI, SHIZUOKA KEN, 430-0942 JAPAN" that is "Shizuoka".
- Capture batch/manufacture/expiry details when printed near items.`,
    user: 'Extract the commercial invoice data.',
  },
  bill_of_lading: {
    system: `${EXTRACT_COMMON}
This is an ocean bill of lading. isHouseBl: true only if issued by a freight forwarder/NVOCC as a House B/L; carrier (shipping line) B/Ls are master (false).
blDate: prefer the SHIPPED ON BOARD date; also return issueDate separately. Capture all containers with size/type and seal numbers. marksAndNumbers: as printed (often "AS PER BL" style content).
isDraftDocument: true if the document carries a DRAFT watermark or stamp anywhere.`,
    user: 'Extract the bill of lading data.',
  },
  air_waybill: {
    system: `${EXTRACT_COMMON}
This is an air waybill. mawbNumber: the master AWB (11 digits, often printed as a 3-digit prefix + 8 digits, e.g. "057-79606800" -> "05779606800"). hawbNumber: house AWB if this is a HAWB or one is referenced.`,
    user: 'Extract the air waybill data.',
  },
  certificate_of_origin: {
    system: `${EXTRACT_COMMON}
This is a certificate of origin, possibly a preferential/FTA form (GSP, DFTP, SAFTA, ASEAN...). schemeText: the scheme heading printed on the form, verbatim. originCriterion: the value in the origin criterion box (e.g. "A", "COWO", percentages).
certificateNumber: the certificate's own serial/reference number only (e.g. "05830") — do not append year tokens or file references printed beside it.`,
    user: 'Extract the certificate of origin data.',
  },
  certificate_of_analysis: {
    system: `${EXTRACT_COMMON}
This is a certificate of analysis / conformance. One certificate may cover multiple products — return one entry per product with batch number, manufacture date and expiry date when printed.`,
    user: 'Extract the certificate of analysis data.',
  },
  packing_list: {
    system: `${EXTRACT_COMMON}
This is a packing list. Capture package count/kind, net & gross weight totals and shipping marks.`,
    user: 'Extract the packing list data.',
  },
};

const SCHEMAS = {
  invoice: { schema: InvoiceExtractSchema, name: 'invoice_extract' },
  bill_of_lading: { schema: BlExtractSchema, name: 'bl_extract' },
  air_waybill: { schema: AwbExtractSchema, name: 'awb_extract' },
  certificate_of_origin: { schema: CooExtractSchema, name: 'coo_extract' },
  certificate_of_analysis: { schema: CoaExtractSchema, name: 'coa_extract' },
  packing_list: { schema: PackingListExtractSchema, name: 'packing_list_extract' },
} as const;

export async function classifyDoc(fileName: string, pdf: Buffer): Promise<DocType> {
  const { data } = await structuredPdfCall({
    schema: ClassificationSchema,
    schemaName: 'doc_classification',
    system: CLASSIFY_SYSTEM,
    userText: 'Classify this document.',
    fileName,
    pdf,
    model: MODELS.classify,
    escalateModel: MODELS.extract,
  });
  return data.docType;
}

export async function extractDoc(fileName: string, pdf: Buffer, docType: DocType): Promise<ExtractedDoc> {
  if (docType === 'other') return { fileName, docType, data: null, model: 'none' };
  const prompt = PROMPTS[docType];
  const { schema, name } = SCHEMAS[docType];
  const { data, model } = await structuredPdfCall({
    schema,
    schemaName: name,
    system: prompt.system,
    userText: prompt.user,
    fileName,
    pdf,
  });
  return { fileName, docType, data, model };
}
