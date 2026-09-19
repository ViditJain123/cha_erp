import {
  AwbExtractSchema,
  BankCertificateExtractSchema,
  BlExtractSchema,
  ClassificationSchema,
  CoaExtractSchema,
  CooExtractSchema,
  GstTaxInvoiceExtractSchema,
  IntoBondBeExtractSchema,
  ShippingBillExtractSchema,
  ContractExtractSchema,
  FreightCertificateExtractSchema,
  HighSeasAgreementExtractSchema,
  InsuranceCertificateExtractSchema,
  InvoiceExtractSchema,
  PurchaseOrderExtractSchema,
  PackingListExtractSchema,
  type DocType,
  type ExtractedDoc,
} from './schemas.js';
import { MODELS, structuredPdfCall } from './openai.js';

export const CLASSIFY_SYSTEM = `You classify documents for an Indian customs house agent preparing an import Bill of Entry.
Classify the attached PDF. Return:
- docTypes: EVERY document type present in the file, in page order. One PDF is often a scan of several documents stapled together — an invoice, then a bill of lading, then a packing list, then a certificate of origin. List each one once. A file holding a single document returns a single-element array.
- docType: the one the file is principally about, for callers that want a single label.
The types:
- invoice: commercial invoice from the overseas supplier
- bill_of_lading: ocean/sea bill of lading (MBL or HBL)
- air_waybill: air waybill (MAWB or HAWB)
- packing_list: packing list
- certificate_of_origin: certificate of origin (any scheme/FTA form)
- certificate_of_analysis: certificate of analysis / conformance / quality
- into_bond_be: an INTO-BOND (warehousing) Bill of Entry, or its checklist print, for goods already deposited in a customs bonded warehouse. It states BE type W / "Warehousing" / "Into Bond", usually names an eight-character warehouse code, and is attached so a later ex-bond clearance can be filed against it.
- shipping_bill: an ICES SHIPPING BILL — the export document, for goods leaving India. Headed "INDIAN CUSTOMS EDI SYSTEM" with a header block of "Port Code", "SB No" and "SB Date", and a "PART - I - SHIPPING BILL SUMMARY". Attached on a re-import, because it is the export these goods are coming back from. An "Import CheckList" is not one.
- gst_tax_invoice: an Indian outward GST tax invoice raised BY the importer for a product they sold, not a foreign supplier's commercial invoice. It is headed "Tax Invoice", carries the seller's 15-character GSTIN, and charges CGST/SGST or IGST in rupees. Attached on a Section 65 (MOOWR) ex-bond clearance, where the goods it sells are the finished product manufactured in the bonded warehouse.
- freight_certificate: a forwarder's or carrier's certificate of the freight charged on this consignment. Often titled "Freight Certificate", "Certificate of Freight" or "Freight Declaration"; it states an amount (and sometimes inland/ex-works charges separately) against a B/L or invoice.
- insurance_certificate: a marine insurance certificate or a declaration under an open policy. States a policy number, a sum insured and usually a premium.
- purchase_order: the buyer's own purchase order to the supplier.
- contract: a sale contract or purchase agreement between the two.
- bank_certificate: a bank's certificate of the exchange rate for a currency, issued to the importer. States a bank's name, a certificate number and date, a currency and a rate in rupees. Attached when the invoice currency is one the Ministry of Finance does not notify a customs rate for.
- high_seas_agreement: a HIGH SEAS SALE agreement — a contract selling goods while they are afloat, signed after shipment and before the Bill of Entry. Usually titled "High Seas Sale Agreement"; names a seller and a buyer, quotes the original supplier's invoice and/or the B/L, and states the high-seas sale value. It is not the supplier's own invoice and not an ordinary sale contract.
- other: anything else (licences, test reports, correspondence...)
A pre-filing "CheckList - Bill of Entry" print for a HOME CONSUMPTION BE is "other"; the same print for a WAREHOUSING BE is "into_bond_be".
Do not list "other" alongside real types: a bundle that also contains an insurance certificate and a grade certificate is still just the types you recognise. Only return ["other"] when the file contains nothing else.`;

export const EXTRACT_COMMON = `You extract data from import shipment documents for an Indian customs Bill of Entry.
Rules:
- Copy values exactly as printed (numbers, codes, names). Do not invent values.
- The document may be a noisy scan with stamps and handwriting; read carefully.
- Dates: return ISO format YYYY-MM-DD. Interpret ambiguous formats from context (e.g. "04.06.2026" is 4 June 2026 on non-US trade documents; "6/29/26" on US documents is 29 June 2026).
- Set a field to null when it is absent or unreadable; also list any field you are not confident about in uncertainFields (use the field name).
- Read EVERY page, including continuation sheets, appendices and "attached list" pages. Values absent from the front page are routinely printed there, and a value on page 3 is not a value you may return as null.
- Numbers: a European document writes the thousands separator as a dot and the decimal as a comma — "49.500,000 KGS" is 49500 kilograms, "1.207,57" is 1207.57, and "1,207.57" on an Anglo document is the same figure. Read which convention the page uses (the currency, the other figures on it, whether the total is plausible for the goods) and return the value itself, never the digits with the separators removed. A quantity a thousand times too large reaches the Bill of Entry as a thousand times too much duty: ex_job25 declared 49,500 tonnes of polypropylene in two containers this way, and ex_job27 the same 49,500,000 as a line quantity.
- Weights: convert to kilograms when the unit is stated, AND, where the schema has a "...UnitAsPrinted" field, also return the unit exactly as the document prints it. Do not normalise it: "KGM", "KGS", "KG" and "LBS" are four different strings and only the document knows which one it used. "MTQ" and "CBM" are volumes, not weights — never put a volume in a weight field.`;

export const PROMPTS: Record<Exclude<DocType, 'other'>, { system: string; user: string }> = {
  invoice: {
    system: `${EXTRACT_COMMON}
This file contains one or more commercial invoices. Return EVERY invoice printed in it, in page order, as a separate entry in "invoices" — one entry per invoice number.
- A single PDF routinely staples together a whole shipment's invoices: a dozen invoices, each with its own number, date, currency, Incoterm and line items. Returning only the first one loses eleven declarations, and nothing downstream can tell that they were there.
- Two pages that repeat the SAME invoice number (a continuation sheet, a duplicate/triplicate copy, an invoice reprinted beside its packing list) are ONE invoice: merge their line items, do not emit the entry twice.
- A packing list, a proforma, or a delivery note bound into the same file is not an invoice. Do not return it as one.
Item rules, per invoice:
- Goods line items: description, HS code if printed, quantity with unit, unit price, extended amount.
- hsCode is ONLY a customs HS/HTS/RITC code (6-10 digits, sometimes labelled "HS CODE"). A seller item/part number (e.g. "880FG-UV-8LB") is NOT an HS code — keep such codes as part of the description and set hsCode null.
- Lines that are charges (freight, handling, insurance, documentation...) are NOT goods: set isCharge=true for them and also surface freight as freightCharge when identifiable.
- termsOfInvoice: normalise the Incoterm (CIF/C&F(CFR)/FOB/EXW/CPT). "Ex-Works" is EXW.
- sellerAddressLines: use the seller's own/remit-to address block that identifies the selling entity, not office/plant contact addresses printed in footers.
- sellerCity: the city (or prefecture/province where that is what the address states) from that same block, on its own — the Bill of Entry declares it in a separate field from the address. For "HAMAMATSU SHI, SHIZUOKA KEN, 430-0942 JAPAN" that is "Shizuoka".
- Capture batch/manufacture/expiry details when printed near items.
- brand / model: only when the line prints a brand name or a model/grade/type designation. A seller's part number is not a model unless the invoice labels it as one. Null otherwise — do not write "UNBRANDED" or "NA".
- countryOfOrigin on a line: only when the invoice states origin per line; the document-level origin goes in countryOfOrigin on the invoice.
- noCommercialValue: true when the line (or the whole invoice) says NCV, "no commercial value", FOC, "free of charge", or "value for customs purpose only".
- manufacturerName / manufacturerAddressLines: only when the invoice names a manufacturer or producer separately from the seller. Null and [] otherwise.
- natureOfTransaction: what the invoice records. Most commercial invoices are an ordinary SALE and say nothing about it — answer UNKNOWN rather than SALE only when the document positively suggests something else and you cannot tell what. FREE_OF_COST covers "free of charge", "no commercial value", "value for customs purposes only", and a returning re-import billed with no payment due ("Payment: N/A"). SAMPLE, REPLACEMENT, GIFT, HIRE, RENT and SALE_ON_CONSIGNMENT only when the document says so.
- isExportInvoice: true when the invoice runs in the EXPORT direction — an Indian seller (rupee address, an IEC or a GSTIN) billing a foreign buyer, often naming a shipping bill, drawback tariff item, RoDTEP or LUT. A re-import job attaches the original export invoice alongside the supplier's invoice for the goods coming in, and only the latter is a line of this Bill of Entry. False for an ordinary overseas supplier's invoice.
- paymentTerms: the payment terms exactly as printed ("D/A 45 days from B/L date", "100% advance TT", "Irrevocable LC at sight"). Do not abbreviate or code them.
- lcNumber/lcDate: only when the invoice quotes a letter of credit. purchaseOrderNumber/Date and contractNumber/Date likewise — the invoice usually quotes the buyer's PO or a sale contract, and those are separate from its own number.`,
    user: 'Extract every commercial invoice in this file.',
  },
  bill_of_lading: {
    system: `${EXTRACT_COMMON}
This is an ocean bill of lading. isHouseBl: true only if issued by a freight forwarder/NVOCC as a House B/L; carrier (shipping line) B/Ls are master (false).
- carrierName: the ocean carrier. It is often NOT in a labelled box. Look at the letterhead/logo, at a "Carrier" field, and at the signature block, which commonly reads "X, LTD. AS AGENT FOR THE CARRIER Y" — in that shape Y is the carrier and X is its agent. Return the carrier's own name, trimmed of "AS AGENT FOR THE CARRIER" and of company-form suffixes only when they are clearly not part of the trading name. Still fill shippingLine with whatever name is most prominent on the form; the two may be the same.
- blNumber: when the header box is faint, stamped over or illegible, the same number is printed again in the footer of each continuation sheet ("continued in next ... BL No. XXXX") and in an appendix heading ("APPENDIX TO BILL OF LADING XXXX"). Read it from there rather than returning a garbled string.
- A bill of lading usually prints SEVERAL reference numbers side by side — a booking number, an agency/agent reference, and the carrier's own B/L number. Return each in its own field (blNumber, bookingNumber, agencyReferenceNumber). Do not collapse them into one and do not guess which is "the" B/L number: put each where it is labelled, and if a label is illegible leave that field null.
- masterBlNumber / masterBlDate: when this is a house B/L that quotes the master B/L it moves under, return that number and date. Null when it quotes none.
- shippedOnBoardDate: the SHIPPED ON BOARD / laden-on-board date. issueDate: the place-and-date-of-issue date. Return both when both are printed, even when they are the same day. blDate: the on-board date if there is one, else the issue date.
- packageCount / packageUnit are the count of PACKAGES — bags, cartons, drums, pallets — not containers. A totals box reading "Total No. of Pkgs/Cntrs 0004 CNTR" next to cargo described as "4000 BAG(S)" means packageCount 4000, packageUnit BAG, containerCount 4. When only containers are stated, leave packageCount null rather than putting the container count in it.
- netWeightKg is frequently not a labelled field at all: it appears inside the description block, or on a continuation/attached-list page, as free text — "NET WT: 25000.00 KGS", "TOTAL NETT WT.: 24,000.000 KGS", "NET WEIGHT:156,450(KGS)". Search every page before returning null.
- vesselName and voyageNo separately when the form prints them in separate boxes. Also return the combined string in vesselVoyage when they share one box ("WADI DUKA/02621/N", "INTERASIA TENACITY S022").
- CONTAINERS. One entry per physical container, and never the first one only. A B/L that moves six boxes and is filed as one box is a misdeclaration, so this list is read as carefully as the B/L number.
  - Where they are printed: a narrow "Container No./Seal No." column that repeats down the page, one line per box ("CAIU3686895 / QIN2410658 / 20GP / 1000 BAG(S)" then "CAIU3772397 / QIN2509082 / 20GP / 1000 BAG(S)" and so on); a stack of three-token lines under the marks block ("IAAU1141498 40SD96 IAAH479523"); a "*** B/L Attached List ***", appendix or container-manifest page; a continuation sheet. Read every page before you answer, and keep reading the column past the point the description block beside it ends — the description is written once and the containers are listed many times.
  - A container number is four letters and seven digits. Return it exactly as printed.
  - sizeType: verbatim, whatever form it takes — "40SD96", "20GP", "45G1", "1 X HIGH CUBE 40". Do not normalise it and do not convert it to a code.
  - sealNo: the seal on THAT container. Seals are per box; do not copy one seal onto every row, and leave it null rather than inventing one when the column is blank or illegible.
  - packagesStuffed / grossWeightKg: the packages in THAT container and their gross weight in kilograms, when the row states them — "CAIU3686895 / QIN2410658 / 20GP / 1000 BAG(S) / 25,400.00 KGS" is 1000 and 25400. Per box, like the seal: null when the row gives only a consignment total, and never the total divided by the number of boxes.
  - containerCount: the total the document states in words or figures — "SAY : SIX CONTAINERS ONLY" is 6, "6 CTRS" is 6, "Total No. of Pkgs/Cntrs 0004 CNTR" is 4, "1 X 40' FCL CONTAINER" is 1. Fill it from that statement even when you have also listed the containers individually: it is what the list is checked against.
  - The list and containerCount must agree. Before you answer, count the entries you are returning and compare. If the document states a total you cannot find that many numbers for, return the ones you can read — never pad the list with invented numbers — and add "containers" to uncertainFields.
marksAndNumbers: as printed (often "AS PER BL" style content).
isDraftDocument: true if the document carries a DRAFT watermark or stamp anywhere.`,
    user: 'Extract the bill of lading data.',
  },
  air_waybill: {
    system: `${EXTRACT_COMMON}
This is an air waybill.
- mawbNumber: the master AWB (11 digits, often printed as a 3-digit prefix + 8 digits, e.g. "057-79606800" or "057 BOS 79606800" -> "05779606800"). carrierIataPrefix: those first 3 digits on their own ("057").
- hawbNumber: the house AWB. It is an independent number, not a variant of the master, and it is often NOT labelled. Look in the top corners of the form beside the master number: a consolidator stamps its own reference there, usually letters then digits, often starting with the consolidator's initials — "HAWB No: BOS0121016" on a DSV waybill, a bare "OGC2606212" beside the master on a OneGlobe Consolidators one. A number in that position that is not the 11-digit master IS the house air waybill number. Return null — the JSON value, never the text "null" — only when there genuinely is no second number.
- hawbDate: the house AWB's own date when it is printed separately from the master's; null when the form shows only one date.
- issuingCarrierOrAgent is very often a FREIGHT FORWARDER, not the airline. Also return operatingCarrier: the airline actually carrying the goods, read from the routing row ("To / By First Carrier / Routing and Destination" — e.g. "CDG  AF  BOM  AF" means AF). Return the 2-letter airline code when that is what is printed.
- flightNumber and flightDate separately, as well as the combined flightAndDate string.
- WEIGHTS. The letter beside the gross weight is the unit, not a code: "101.00 K" is 101 kilograms, "490.00 K" is 490 kilograms, an L is pounds. Return that letter in grossWeightUnitAsPrinted and the converted figure in grossWeightKg. netWeightKg is usually absent from an air waybill — return null unless it is actually stated.
- pieces: the number of packages. packageUnit: what kind of package they are, as printed — PLT, PKG, CTN, SKID. Do not assume pallets; return null if the form does not say.`,
    user: 'Extract the air waybill data.',
  },
  certificate_of_origin: {
    system: `${EXTRACT_COMMON}
This is a certificate of origin, possibly a preferential/FTA form (GSP, DFTP, SAFTA, ASEAN, CEPA...). schemeText: the scheme heading printed on the form, verbatim. originCriterion: the value in the origin criterion box (e.g. "A", "COWO", percentages).
certificateNumber: the certificate's own serial/reference number only (e.g. "05830") — do not append year tokens or file references printed beside it.
- originCountry: the country the goods originate in, as the certificate states it.
- items: one entry per goods line in the certificate's goods table, in order, with the item number, description, HS code, origin criterion and quantity exactly as printed for that line. A certificate covering one product still has one item.
- producerName / producerAddress: the producer or manufacturer box, when the form has one and it is filled. exporterAddress: the exporter's address.
- transportRoute: the "means of transport and route" box verbatim; transitCountries: any countries that route passes through (empty when direct or not stated).
- issuedRetroactively: true when the certificate carries an "Issued Retroactively" / "Issued Retrospectively" marking or ticked box; false when the form has that box unticked; null when the form has no such marking.
- thirdPartyInvoicing: true when the third-party invoicing box is ticked or a third-party invoice is named; false when the box exists unticked; null otherwise.`,
    user: 'Extract the certificate of origin data.',
  },
  certificate_of_analysis: {
    system: `${EXTRACT_COMMON}
This is a certificate of analysis / conformance. One certificate may cover multiple products — return one entry per product with batch number, manufacture date and expiry date when printed.`,
    user: 'Extract the certificate of analysis data.',
  },
  into_bond_be: {
    system: `${EXTRACT_COMMON}
This is an into-bond (warehousing) Bill of Entry, or its checklist print, for goods deposited in a customs bonded warehouse. A later ex-bond Bill of Entry will be filed against it, so what matters is what identifies it and what it put into the warehouse.
- beNumber: the Bill of Entry number of THIS into-bond BE, not any other document number on the page.
- warehouseCode: the eight-character bonded warehouse code, shaped as four characters of port, one letter, three digits (for example MAA1U001). Copy it exactly; return null rather than assembling one from a warehouse name.
- bondNo / bondDate / bondExpiryDate: the warehousing bond executed with Customs, when printed.
- items: one entry per line of goods, in the order printed, with the invoice and item serial numbers the BE gives them. Those serials are how an ex-bond clearance points back at a line, so copy them rather than renumbering from 1.
- quantity / unit / packages: what went into the warehouse for that line.`,
    user: 'Extract the into-bond Bill of Entry data.',
  },
  shipping_bill: {
    system: `${EXTRACT_COMMON}
This is an ICES shipping bill: the EXPORT under which these goods left India. It is attached because they have come back, and the Bill of Entry has to claim a re-import exemption against it.
- sbNo / sbDate / portCode: from the header block at the top right of page 1, labelled "SB No", "SB Date" and "Port Code". portCode is the six-character ICES code (for example INNSA1), never the port's name.
- leoDate: the date beside "LEO" in the process-details block, which is the section 51 order permitting clearance. It decides which re-import notification applies, so return null rather than substituting the submission or assessment date.
- schemeFlags: PART - I prints one row of Y/N boxes under the headings "1.MODE 2.ASSESS 3.EXMN 4.JOBBING 5.MEIS 6.DBK 7.RODTP 8.LICENCE 9.DFRC 10.RE-EXP 11.LUT". Read each flag from the heading it sits under. THESE BOXES OFTEN DO NOT LINE UP with their headings once the page is extracted, and a wrong flag becomes a wrong duty claim: return null for any flag you cannot confidently align, and name it in uncertainFields. Never infer one flag from another.
- invoices: one entry per invoice in "PART - II - INVOICE DETAILS", carrying the "S.No" the bill gives it as sbInvSrNo. Within each, one item per line of its goods table, carrying that line's "ItemSNo" as sbItemSrNo. Copy both serials as printed rather than renumbering from 1 — they are how Customs matches the returning line against the export, and a bill routinely covers several invoices and items of which only one came back.
- invoiceTerm: the "INVTERM" box (FOB, CIF, CFR, EXW). freightAmount / insuranceAmount: the invoice's own freight and insurance boxes, in the invoice currency, not rupees.
- marksAndNumbers: the "MARKS & NUMBERS" box verbatim — it often carries the LUT number and any scheme declaration.`,
    user: 'Extract the shipping bill data.',
  },
  gst_tax_invoice: {
    system: `${EXTRACT_COMMON}
This is an outward GST tax invoice raised by an Indian seller. It is attached because the goods it sells were manufactured in a customs bonded warehouse under Section 65, and the Bill of Entry has to declare them.
- invoiceNo: the tax invoice number exactly as printed, including any prefix and slashes. It is at most sixteen characters; if what you read is longer, you have picked up something that is not the invoice number.
- invoiceDate: the date of the tax invoice, not the date of any e-way bill, challan or acknowledgement on the same page.
- supplierGstin: the 15-character GSTIN of the party RAISING the invoice, not the buyer's.
- lines: one entry per line of goods, in the order printed.
- hsn: the HSN/SAC printed against the line, exactly as printed — 4, 6 or 8 digits. Do not pad it and do not guess one from the description.
- quantity / unit: what that line sells, in the invoice's own unit ("PCS", "NOS", "KG", "MT"). Copy the unit as printed rather than normalising it.
Lines that are charges (freight, packing, insurance) are not goods — leave them out.`,
    user: 'Extract the GST tax invoice data.',
  },
  packing_list: {
    system: `${EXTRACT_COMMON}
This is a packing list. Capture package count/kind, net & gross weight totals and shipping marks.

Also return "lines" — one entry per product row in the packing table, in the order printed. This breakdown is what lets a partial warehouse clearance be computed, so read the table rather than only the totals:
- description: the goods on that row, verbatim.
- packages / packageType: how many packages of that product and what kind (BAG, CTN, PLT, DRUM), as printed.
- netWeightKg / grossWeightKg: that row's own weights, converted to kg.
- quantity / quantityUnit: the goods quantity when the row states one separately from its weight.
- marks / itemRef: the row's own shipping marks and any invoice/item serial it quotes.
Return an empty "lines" array when the document genuinely states only totals with no per-product table. Never split a total across invented rows, and never carry a figure printed once for the whole shipment onto every line.`,
    user: 'Extract the packing list data.',
  },
  freight_certificate: {
    system: `${EXTRACT_COMMON}
This is a freight certificate. What matters is which money is which, because they land in different columns of the Bill of Entry:
- freightAmount / freightRatePercent: the ocean or air freight itself, as an amount or as a rate on the FOB value. Return whichever the certificate states — never both, and never convert one into the other.
- exWorksAmount: pre-carriage stated SEPARATELY from the freight — inland haulage to the port of loading, origin terminal handling, ex-works collection. This is NOT freight; it is declared as a miscellaneous charge.
- otherChargesAmount / otherChargesDescription: anything else billed that is neither of the above.
Each amount keeps its own currency exactly as printed; they are routinely not all the same.`,
    user: 'Extract the freight certificate.',
  },
  insurance_certificate: {
    system: `${EXTRACT_COMMON}
This is a marine insurance certificate or an open-policy declaration.
- premiumAmount is what the importer PAID for the cover. sumInsured is what the goods are covered FOR. They differ by three orders of magnitude and only the premium is declared on the Bill of Entry — do not put one in the other's field.
- premiumRatePercent only when the certificate states the premium as a rate rather than an amount.
- The premium is usually in rupees even when the invoice is in foreign currency, because the policy is Indian. Return the currency as printed.`,
    user: 'Extract the insurance certificate.',
  },
  purchase_order: {
    system: `${EXTRACT_COMMON}
This is a buyer's purchase order. Return its own number and date, not the supplier's invoice number.`,
    user: 'Extract the purchase order.',
  },
  contract: {
    system: `${EXTRACT_COMMON}
This is a sale contract or purchase agreement.
- saleConditions: conditions the contract attaches to the sale — a restriction on resale, a price subject to later adjustment, an obligation to buy elsewhere. These are what a customs valuation declaration asks about. Return an empty array when the contract attaches none; ordinary commercial boilerplate (governing law, arbitration, force majeure) is not a condition on the sale.`,
    user: 'Extract the sale contract.',
  },
  bank_certificate: {
    system: `${EXTRACT_COMMON}
This is a bank's certificate of an exchange rate.
- rate is rupees per ONE unit of the currency. If the certificate quotes the rate per 100 units (common for JPY), return the figure as printed in rate AND put 100 in ratePerUnits. Never divide it yourself.
- certificateDate is the date the bank issued it, not the date of any transaction it mentions.`,
    user: 'Extract the bank exchange-rate certificate.',
  },
  high_seas_agreement: {
    system: `${EXTRACT_COMMON}
This is a high seas sale agreement — goods sold while afloat.
- The SELLER is the party who bought the goods from the overseas supplier and is now selling them on; the BUYER is the party who will file the Bill of Entry, or the next link in the chain.
- role: copy how the agreement styles each party ("Seller", "Vendor", "First Party", "Buyer", "Purchaser"). Do not normalise it.
- iec: the ten-character Importer Exporter Code where the agreement prints one. It is what Customs identifies the party by, so do not confuse it with a GSTIN (15 characters) or a PAN (10 characters, five letters first).
- saleValue is what the BUYER pays, which is higher than the original invoice value. If the agreement states a loading percentage rather than an amount, leave saleValue null and list it in uncertainFields.`,
    user: 'Extract the high seas sale agreement.',
  },
};

const SCHEMAS = {
  invoice: { schema: InvoiceExtractSchema, name: 'invoice_extract' },
  bill_of_lading: { schema: BlExtractSchema, name: 'bl_extract' },
  air_waybill: { schema: AwbExtractSchema, name: 'awb_extract' },
  certificate_of_origin: { schema: CooExtractSchema, name: 'coo_extract' },
  certificate_of_analysis: { schema: CoaExtractSchema, name: 'coa_extract' },
  packing_list: { schema: PackingListExtractSchema, name: 'packing_list_extract' },
  into_bond_be: { schema: IntoBondBeExtractSchema, name: 'into_bond_be_extract' },
  shipping_bill: { schema: ShippingBillExtractSchema, name: 'shipping_bill_extract' },
  gst_tax_invoice: { schema: GstTaxInvoiceExtractSchema, name: 'gst_tax_invoice_extract' },
  freight_certificate: { schema: FreightCertificateExtractSchema, name: 'freight_certificate_extract' },
  insurance_certificate: { schema: InsuranceCertificateExtractSchema, name: 'insurance_certificate_extract' },
  purchase_order: { schema: PurchaseOrderExtractSchema, name: 'purchase_order_extract' },
  contract: { schema: ContractExtractSchema, name: 'contract_extract' },
  bank_certificate: { schema: BankCertificateExtractSchema, name: 'bank_certificate_extract' },
  high_seas_agreement: { schema: HighSeasAgreementExtractSchema, name: 'high_seas_agreement_extract' },
} as const;

/**
 * Every document type in a PDF, in page order, most significant first.
 *
 * A single attachment is not a single document. Returning a list rather than a
 * label is what lets a bundled scan be read once per type it contains instead
 * of once, as whichever type happened to win.
 */
export async function classifyDoc(
  fileName: string,
  pdf: Buffer,
  mimeType?: string,
): Promise<DocType[]> {
  const { data } = await structuredPdfCall({
    schema: ClassificationSchema,
    schemaName: 'doc_classification',
    system: CLASSIFY_SYSTEM,
    userText: 'Classify this document.',
    fileName,
    pdf,
    ...(mimeType !== undefined ? { mimeType } : {}),
    model: MODELS.classify,
    escalateModel: MODELS.extract,
  });
  // De-duplicated, with the principal type first so callers that take the head
  // of the list get what the old single-label version returned.
  const types = [data.docType, ...(data.docTypes ?? [])].filter(
    (t, i, all) => all.indexOf(t) === i,
  );
  const real = types.filter((t) => t !== 'other');
  return real.length ? real : ['other'];
}

export async function extractDoc(
  fileName: string,
  pdf: Buffer,
  docType: DocType,
  mimeType?: string,
): Promise<ExtractedDoc> {
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
    ...(mimeType !== undefined ? { mimeType } : {}),
  });
  return { fileName, docType, data, model };
}
