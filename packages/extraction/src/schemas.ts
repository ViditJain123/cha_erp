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
  'into_bond_be',
  // The export leg of a re-import: the ICES shipping bill the goods went out
  // under. It is the only document that can source the RE-IMPORT sheet, and
  // until it had a type here it classified as `other` and was discarded while
  // sitting in the job folder.
  'shipping_bill',
  // The MOOWR unit's own outward GST tax invoice, which is what a section 65
  // ex-bond clearance is declared against. Not a shipping document: it names
  // the *finished* product, which nothing on the import side knows.
  'gst_tax_invoice',
  // The two documents the charge block is read off. Both used to classify as
  // `other` and be discarded, which left INVOICES' freight and insurance
  // columns with no source at all.
  'freight_certificate',
  'insurance_certificate',
  'purchase_order',
  'contract',
  // The bank's exchange-rate certificate, for a currency the Ministry of
  // Finance notification does not cover. ICES calls those "non-standard
  // currencies" and makes the bank name, certificate number and certificate
  // date mandatory on the EXCHANGE_RATE row (error 155).
  'bank_certificate',
  // The agreement behind a high-seas sale. It is the only document that names
  // the parties the HSS sheet declares, and it classified as `other` and was
  // discarded while sitting in the job folder.
  'high_seas_agreement',
  'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const ClassificationSchema = z.object({
  /**
   * The type the file is principally about — what it would be filed under.
   *
   * Kept for callers that want one label per file, and for the `other` case.
   */
  docType: z.enum(DOC_TYPES),
  /**
   * Every document type present in the PDF, in page order.
   *
   * One attachment is routinely a scan of several documents stapled together —
   * `ex_job7/Copy docs I-40127 INV BL PL COO INSURANCE GRADE-CERT COA.pdf` is
   * thirteen pages holding an invoice, a bill of lading, a packing list, a
   * certificate of origin and three more. Returning one type for that file
   * discards six documents' worth of data, and no amount of prompt work on the
   * bill-of-lading extractor can get it back.
   */
  docTypes: z.array(z.enum(DOC_TYPES)),
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
  /** Brand name printed against the line, when the invoice prints one. */
  brand: z.string().nullable(),
  /** Model, grade or type designation printed against the line. */
  model: z.string().nullable(),
  /** Country of origin printed against this line, when the invoice gives it per line. */
  countryOfOrigin: z.string().nullable(),
  /** The line says NCV / no commercial value / FOC / free of charge / value for customs purpose only. */
  noCommercialValue: z.boolean(),
});

/**
 * One commercial invoice.
 *
 * A file is not an invoice; a file *contains* invoices, and routinely more than
 * one — `ex_job5/30239 INVOICE AND PACKING LIST.pdf` prints twelve, against
 * which the Bill of Entry declares twelve invoices at two exchange rates. So
 * the document extract is an array of these, never a single one.
 */
export const InvoiceDocSchema = z.object({
  invoiceNumber: z.string(),
  invoiceDate: z.string().nullable(),
  sellerName: z.string(),
  sellerAddressLines: z.array(z.string()),
  /** City/prefecture only — the BE declares it separately from the address. */
  sellerCity: z.string().nullable(),
  sellerCountry: z.string().nullable(),
  /**
   * The manufacturer or producer, when the invoice names one separately from
   * the seller ("Manufacturer:", "Producer:", "Made by"). Null when it does not
   * — the seller is not the manufacturer just because nobody else is named.
   */
  manufacturerName: z.string().nullable(),
  manufacturerAddressLines: z.array(z.string()),
  buyerName: z.string().nullable(),
  currency: z.string(),
  /** Incoterm / delivery terms exactly as printed, e.g. "CIF NHAVA SHEVA", "Ex-Works Taunton, MA" */
  deliveryTermsRaw: z.string().nullable(),
  /** Normalised terms of invoice */
  termsOfInvoice: z.enum(['FOB', 'CIF', 'CFR', 'C&F', 'EXW', 'CPT', 'UNKNOWN']),
  paymentTerms: z.string().nullable(),
  /**
   * What kind of transaction the invoice records, in the Bill of Entry's own
   * vocabulary. UNKNOWN when the document does not say — most commercial
   * invoices do not, and a sale is then the safe reading.
   */
  natureOfTransaction: z.enum([
    'SALE',
    'SALE_ON_CONSIGNMENT',
    'HIRE',
    'RENT',
    'GIFT',
    'SAMPLE',
    'FREE_OF_COST',
    'REPLACEMENT',
    'OTHER',
    'UNKNOWN',
  ]),
  /**
   * True when this is the ORIGINAL EXPORT invoice, not an invoice for this
   * import: raised by the Indian party who is now the importer, to a foreign
   * buyer, in the export direction.
   *
   * A re-import job carries both. `ex_job29` has `14385 INVOICE.pdf` from the
   * UK supplier and `14385 EXPORT INVOICE.pdf` from the Indian exporter, and
   * Logi-Sys filed one invoice, not two. The export invoice is evidence for the
   * RE-IMPORT sheet — it is where the drawback and RoDTEP declarations are —
   * and it is not a line of this Bill of Entry.
   */
  isExportInvoice: z.boolean(),
  purchaseOrderNumber: z.string().nullable(),
  purchaseOrderDate: z.string().nullable(),
  /** Sale contract / agreement number, when the invoice quotes one. */
  contractNumber: z.string().nullable(),
  contractDate: z.string().nullable(),
  /** Letter of credit, when the payment terms are an LC. */
  lcNumber: z.string().nullable(),
  lcDate: z.string().nullable(),
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

export const InvoiceExtractSchema = z.object({
  /** Every invoice printed in the file, in page order. */
  invoices: z.array(InvoiceDocSchema),
});

/**
 * A freight certificate — what the forwarder charges to bring the goods in.
 *
 * Two amounts matter and they are not the same money: the ocean/air freight
 * itself, which is the `Frt` column when the Incoterm leaves it to be added,
 * and any pre-carriage the certificate states separately on an ex-works
 * shipment, which is a miscellaneous charge rather than freight.
 */
export const FreightCertificateExtractSchema = z.object({
  certificateNumber: z.string().nullable(),
  certificateDate: z.string().nullable(),
  issuerName: z.string().nullable(),
  /** The invoice or B/L the certificate is issued against, when it quotes one. */
  invoiceNumberRef: z.string().nullable(),
  blOrAwbNumberRef: z.string().nullable(),
  freightAmount: money.nullable(),
  /** Some certificates state a rate on the FOB value instead of an amount. */
  freightRatePercent: z.number().nullable(),
  /**
   * Pre-carriage / ex-works collection charges stated apart from the freight —
   * inland haulage to the port of loading, terminal handling at origin.
   */
  exWorksAmount: money.nullable(),
  /** Anything else the certificate bills that is not the freight itself. */
  otherChargesAmount: money.nullable(),
  otherChargesDescription: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

/** A marine insurance certificate or declaration under an open policy. */
export const InsuranceCertificateExtractSchema = z.object({
  policyNumber: z.string().nullable(),
  certificateNumber: z.string().nullable(),
  certificateDate: z.string().nullable(),
  insurerName: z.string().nullable(),
  invoiceNumberRef: z.string().nullable(),
  /** The premium charged — what the BE declares as the insurance amount. */
  premiumAmount: money.nullable(),
  /** The premium as a rate, when the certificate states one instead. */
  premiumRatePercent: z.number().nullable(),
  /** What the consignment is insured FOR — not the premium. */
  sumInsured: money.nullable(),
  uncertainFields: z.array(z.string()),
});

/** A buyer's purchase order, for the PO columns. */
export const PurchaseOrderExtractSchema = z.object({
  orderNumber: z.string(),
  orderDate: z.string().nullable(),
  buyerName: z.string().nullable(),
  sellerName: z.string().nullable(),
  currency: z.string().nullable(),
  totalAmount: z.number().nullable(),
  uncertainFields: z.array(z.string()),
});

/** A sale contract or agreement, for the contract columns. */
export const ContractExtractSchema = z.object({
  contractNumber: z.string(),
  contractDate: z.string().nullable(),
  buyerName: z.string().nullable(),
  sellerName: z.string().nullable(),
  /** Conditions attached to the sale, when the contract states any. */
  saleConditions: z.array(z.string()),
  uncertainFields: z.array(z.string()),
});

export const ContainerSchema = z.object({
  number: z.string(),
  sizeType: z.string().nullable(),
  sealNo: z.string().nullable(),
  /**
   * Packages stuffed in THIS container, and their gross weight.
   *
   * `CONTAINERS.PackagesStuffed` and `GrWt` have always been on the sheet and
   * on the draft, and until this was read nothing ever filled them: every
   * export wrote the `0` the mapper falls back to, while Logi-Sys' own file for
   * the same job carried 1,043 cartons and 26,284 kg per box (`ex_job6`). The
   * hand-transcribed golden fixture had the figures, so no test could see it.
   */
  packagesStuffed: z.number().nullable(),
  grossWeightKg: z.number().nullable(),
});

export const BlExtractSchema = z.object({
  blNumber: z.string(),
  /** shipped-on-board date if present, else issue date */
  blDate: z.string().nullable(),
  issueDate: z.string().nullable(),
  /**
   * The shipped-on-board date on its own.
   *
   * `blDate` collapses on-board and issue into one field, so the two can never
   * be told apart after the fact, and the BE wants the on-board date. Kept
   * separate here so the precedence is decided in `merge.ts` and visible.
   */
  shippedOnBoardDate: z.string().nullable(),
  isHouseBl: z.boolean(),
  /**
   * The master B/L this house B/L is issued under, when the document quotes it.
   *
   * A forwarder's house B/L is not the document the Bill of Entry declares in
   * `MAWB_MBL_No` — the main carrier's is. When the house B/L names its master,
   * that is the only place we have it without asking for another document.
   */
  masterBlNumber: z.string().nullable(),
  masterBlDate: z.string().nullable(),
  shipperName: z.string(),
  shipperAddressLines: z.array(z.string()),
  consigneeName: z.string().nullable(),
  notifyPartyName: z.string().nullable(),
  shippingLine: z.string().nullable(),
  /**
   * The ocean carrier, as distinct from whoever's name is on the form.
   *
   * On `ex_job6` the carrier appears only in the signature block —
   * "INTERASIA LINES, LTD. AS AGENT FOR THE CARRIER INTERASIA LINES SINGAPORE
   * PTE. LTD." — and on `ex_job2` only in the letterhead. `shippingLine` picks
   * up whichever name is most prominent; this one is asked for explicitly.
   */
  carrierName: z.string().nullable(),
  vesselVoyage: z.string().nullable(),
  /** Vessel and voyage separately, when the B/L prints them in separate boxes. */
  vesselName: z.string().nullable(),
  voyageNo: z.string().nullable(),
  /**
   * The other reference numbers a B/L carries.
   *
   * `ex_job2` prints three side by side — BOOKING NO `ESLKEMBFL2000990`, an
   * illegible `BL No.`, and AGENCY REF NO `EMIVKEMBFL200846` — and the number
   * Logi-Sys filed is the agency reference. Collapsing them into `blNumber`
   * loses the ability to tell which one was picked.
   */
  bookingNumber: z.string().nullable(),
  agencyReferenceNumber: z.string().nullable(),
  portOfLoading: z.string().nullable(),
  portOfDischarge: z.string().nullable(),
  placeOfDelivery: z.string().nullable(),
  packageCount: z.number().nullable(),
  packageUnit: z.string().nullable(),
  /**
   * How many containers, kept apart from how many packages.
   *
   * `liv_job1/10793 BL.pdf` prints "Total No. of Pkgs/Cntrs 0004 CNTR" in the
   * totals box while the cargo is 4000 BAG(S). Without somewhere to put the 4,
   * it lands in `packageCount` and the BE declares four bags.
   */
  containerCount: z.number().nullable(),
  cargoDescription: z.string().nullable(),
  marksAndNumbers: z.string().nullable(),
  grossWeightKg: z.number().nullable(),
  netWeightKg: z.number().nullable(),
  /**
   * The weight units exactly as printed, alongside the converted kilograms.
   *
   * `KGM` is the UN/ECE code an EDI-generated B/L prints, and the same column
   * often carries a volume in `MTQ`. Keeping the printed unit lets the merge
   * check the conversion rather than trust it.
   */
  grossWeightUnitAsPrinted: z.string().nullable(),
  netWeightUnitAsPrinted: z.string().nullable(),
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
  /**
   * The house AWB's own date, which need not be the master's.
   *
   * Both were previously filled from `awbDate`, so a HAWB issued on a different
   * day silently inherited the MAWB's date.
   */
  hawbDate: z.string().nullable(),
  shipperName: z.string(),
  shipperAddressLines: z.array(z.string()),
  consigneeName: z.string().nullable(),
  issuingCarrierOrAgent: z.string().nullable(),
  /**
   * The 3-digit IATA prefix of the master air waybill.
   *
   * This is what names the airline. On `ex_job1` the form says "Issuing
   * Carrier's Agent: DSV AIR & SEA INC" — a freight forwarder — while the MAWB
   * `057 BOS 79606800` and the routing row `CDG / AF / BOM / AF` both say Air
   * France. The prefix is the reliable one.
   */
  carrierIataPrefix: z.string().nullable(),
  /** The airline actually carrying the goods, off the routing row (`AF`, `EK`). */
  operatingCarrier: z.string().nullable(),
  airportOfDeparture: z.string().nullable(),
  airportOfDestination: z.string().nullable(),
  flightAndDate: z.string().nullable(),
  /** Flight number and flight date separately — the BE wants them apart. */
  flightNumber: z.string().nullable(),
  flightDate: z.string().nullable(),
  pieces: z.number().nullable(),
  /**
   * What kind of package the pieces are — PLT, PKG, CTN — as printed.
   *
   * `merge.ts` used to assume PLT for every air job; the checklist for
   * `ex_job5` says "20 PKG".
   */
  packageUnit: z.string().nullable(),
  grossWeightKg: z.number().nullable(),
  netWeightKg: z.number().nullable(),
  grossWeightUnitAsPrinted: z.string().nullable(),
  chargeableWeightKg: z.number().nullable(),
  natureOfGoods: z.string().nullable(),
  hsCode: z.string().nullable(),
  deliveryTerms: z.string().nullable(),
  referenceNumbers: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

/**
 * One line of goods on a certificate of origin. Preferential certificates list
 * goods item by item, each with its own HS code and origin criterion, and the
 * Bill of Entry declares the item's serial on the certificate.
 */
export const CooItemSchema = z.object({
  /** The item number the certificate prints for the line ("1", "2"). */
  itemNumber: z.string().nullable(),
  description: z.string(),
  hsCode: z.string().nullable(),
  originCriterion: z.string().nullable(),
  quantity: z.string().nullable(),
  invoiceNumberRef: z.string().nullable(),
});

export const CooExtractSchema = z.object({
  certificateNumber: z.string(),
  issueDate: z.string().nullable(),
  /** Country the goods originate in, as printed on the certificate. */
  originCountry: z.string().nullable(),
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
  exporterAddress: z.string().nullable(),
  /** The producer/manufacturer box, when the form has one and it is filled. */
  producerName: z.string().nullable(),
  producerAddress: z.string().nullable(),
  /** "Means of transport and route" as printed. */
  transportRoute: z.string().nullable(),
  /** Countries the route passes through, as printed; empty when direct or not stated. */
  transitCountries: z.array(z.string()),
  /**
   * True when the certificate is marked as issued retroactively — an "Issued
   * Retroactively" / "Issued retrospectively" stamp or a ticked box. False when
   * the form has that box and it is not ticked; null when the form has no
   * such marking at all.
   */
  issuedRetroactively: z.boolean().nullable(),
  /** Third-party invoicing: the box is ticked or a third-party invoice is named. */
  thirdPartyInvoicing: z.boolean().nullable(),
  /** Every goods line, in the order printed. */
  items: z.array(CooItemSchema),
  uncertainFields: z.array(z.string()),
});

/**
 * A bank's certificate of the exchange rate for a non-notified currency.
 *
 * ICES requires the bank name, the certificate number and its date on the
 * EXCHANGE_RATE row for any currency the Ministry of Finance notification does
 * not cover, and requires the certificate to be dated the day the Bill of Entry
 * is filed. See docs/boe-mapping/19-exchange-rate.md.
 */
export const BankCertificateExtractSchema = z.object({
  bankName: z.string().nullable(),
  certificateNo: z.string().nullable(),
  certificateDate: z.string().nullable(),
  /** The currency the rate is certified for, ISO 4217. */
  currency: z.string().nullable(),
  /** INR per unit of that currency, as certified. */
  rate: z.number().nullable(),
  /**
   * Some currencies are quoted per hundred units. The BE converts per unit, so
   * the two have to be kept apart rather than silently divided.
   */
  ratePerUnits: z.number().nullable(),
  uncertainFields: z.array(z.string()),
});

/** One party named in a high-seas-sale agreement. */
export const HighSeasPartySchema = z.object({
  name: z.string(),
  iec: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  postalCode: z.string().nullable(),
  /** 'seller' or 'buyer' as the agreement itself styles them. */
  role: z.string(),
});

/**
 * A high-seas-sale agreement: who sold the goods afloat, to whom, and for how
 * much.
 *
 * The HSS sheet declares the chain by ICES *preceding level*, counted backwards
 * from the importer filing the Bill of Entry — so the agreement's buyer is the
 * filer (or the next link down) and its seller is level 0. The extraction keeps
 * the roles as printed and lets the resolver do the counting.
 */
export const HighSeasAgreementExtractSchema = z.object({
  agreementDate: z.string().nullable(),
  seller: HighSeasPartySchema.nullable(),
  buyer: HighSeasPartySchema.nullable(),
  /** The invoice the goods were originally imported against, where it is quoted. */
  invoiceNumberRef: z.string().nullable(),
  blNumberRef: z.string().nullable(),
  /** What the buyer paid, which is what the BE is assessed on. */
  saleValue: z.number().nullable(),
  currency: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

export type BankCertificateExtract = z.infer<typeof BankCertificateExtractSchema>;
export type HighSeasAgreementExtract = z.infer<typeof HighSeasAgreementExtractSchema>;

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

/**
 * One line of a packing list: a product, how many packages of it, and what
 * those packages weigh.
 *
 * The per-line breakdown is what makes a partial ex-bond clearance computable.
 * Warehoused goods are released in whole packages, and the Bill of Entry has to
 * state the gross weight of the packages released — so releasing 4 of 10 bags
 * needs the weight of one bag, which only exists if the packing list is read
 * line by line rather than as a set of totals.
 */
export const PackingListLineSchema = z.object({
  /** The goods, as the packing list describes them. */
  description: z.string(),
  /** Shipping marks for this line, when it carries its own. */
  marks: z.string().nullable(),
  /** Invoice or item serial the line quotes, when it quotes one. */
  itemRef: z.string().nullable(),
  /** How many packages of this product. */
  packages: z.number().nullable(),
  /** BAG, CTN, PLT, DRUM — as printed. */
  packageType: z.string().nullable(),
  netWeightKg: z.number().nullable(),
  grossWeightKg: z.number().nullable(),
  /** The goods quantity, when the line states one apart from its weight. */
  quantity: z.number().nullable(),
  quantityUnit: z.string().nullable(),
});

export const PackingListExtractSchema = z.object({
  invoiceNumberRef: z.string().nullable(),
  packageCount: z.number().nullable(),
  packageUnit: z.string().nullable(),
  netWeightKg: z.number().nullable(),
  grossWeightKg: z.number().nullable(),
  marksAndNumbers: z.string().nullable(),
  /** Per-product rows. Empty when the document states only totals. */
  lines: z.array(PackingListLineSchema),
  uncertainFields: z.array(z.string()),
});

/**
 * The earlier into-bond Bill of Entry an ex-bond filing draws against.
 *
 * An ex-bond BE must name the into-bond BE by number and date, and ICES will
 * only release quantity that its own ledger shows against that BE, the
 * ex-bonder's IEC and the warehouse. When the customer attaches the into-bond
 * BE or its checklist, this is where those values come from — otherwise the
 * operator keys them, because nothing else in the system knows them.
 */
export const IntoBondItemSchema = z.object({
  /** Serial of the invoice the item sits under on the into-bond BE. */
  invoiceSrNo: z.number().nullable(),
  /** Item serial within that invoice. */
  itemSrNo: z.number().nullable(),
  description: z.string(),
  cth: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  packages: z.number().nullable(),
});

/**
 * One line of a GST tax invoice for a product manufactured under section 65.
 *
 * The HSN on a GST invoice is the finished product's own heading — the thing
 * `SEC65_EXBOND_INFO.FinishedProductCTH` wants and that no import document
 * carries. It is printed at 4, 6 or 8 digits depending on the supplier's
 * turnover, so it is copied as printed and padded downstream rather than here.
 */
export const GstTaxInvoiceLineSchema = z.object({
  description: z.string(),
  /** As printed — 4, 6 or 8 digits. */
  hsn: z.string().nullable(),
  quantity: z.number().nullable(),
  /** The invoice's own unit, which may not be an ICES UQC. */
  unit: z.string().nullable(),
});

/**
 * An outward GST tax invoice raised by a section 65 (MOOWR) unit.
 *
 * Attached so the SEC65_EXBOND_INFO declaration can be proposed rather than
 * typed: ICES wants the invoice number and date, and the finished product's
 * heading, description, quantity and unit, for every item on the ex-bond BE.
 */
export const GstTaxInvoiceExtractSchema = z.object({
  /** Control Result Code — sixteen characters at most under CGST rule 46. */
  invoiceNo: z.string(),
  invoiceDate: z.string().nullable(),
  /** The GSTIN raising it — the warehouse's own registration. */
  supplierGstin: z.string().nullable(),
  supplierName: z.string().nullable(),
  buyerName: z.string().nullable(),
  placeOfSupply: z.string().nullable(),
  lines: z.array(GstTaxInvoiceLineSchema),
  uncertainFields: z.array(z.string()),
});

/** One goods line of a shipping bill, with the serials the bill gave it. */
export const ShippingBillItemSchema = z.object({
  /** The item's serial within its shipping-bill invoice, as printed. */
  sbItemSrNo: z.number().nullable(),
  hsCode: z.string().nullable(),
  description: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  /** Value in the invoice's currency, as the bill states it. */
  value: z.number().nullable(),
});

/** One invoice of a shipping bill. A bill may carry several. */
export const ShippingBillInvoiceSchema = z.object({
  /** The invoice's serial within the shipping bill — its "S.No" column. */
  sbInvSrNo: z.number().nullable(),
  invoiceNo: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  /** The invoice term the bill prints: FOB, CIF, CFR, EXW. */
  invoiceTerm: z.string().nullable(),
  currency: z.string().nullable(),
  freightAmount: z.number().nullable(),
  insuranceAmount: z.number().nullable(),
  items: z.array(ShippingBillItemSchema),
});

/**
 * Which export promotion schemes the shipping bill's Part-I summary declares.
 *
 * Every field is nullable and means three things, not two: true, false, and
 * "the box could not be read". That distinction is load-bearing. The row is
 * printed as a bare run of Y/N boxes under eleven headings, and on both real
 * bills we hold it extracts mis-aligned against those headings — so a guess
 * here becomes a wrong notification claim on a customs declaration.
 */
export const ShippingBillSchemeFlagsSchema = z.object({
  /** DBK — drawback. */
  drawback: z.boolean().nullable(),
  /** RODTP. */
  rodtep: z.boolean().nullable(),
  /** MEIS — a Chapter-3 reward scheme, which shortens the re-import limit. */
  meis: z.boolean().nullable(),
  /** LICENCE — DEEC, Advance Authorisation, DFIA or EPCG. */
  licence: z.boolean().nullable(),
  /** DFRC — Duty Free Replenishment Certificate. */
  dfrc: z.boolean().nullable(),
  /** LUT — exported under bond or letter of undertaking, no IGST paid. */
  lut: z.boolean().nullable(),
  /** RE-EXP — the consignment is itself a re-export. */
  reExport: z.boolean().nullable(),
});

/**
 * An ICES shipping bill — the export this consignment is coming back from.
 *
 * Read for the RE-IMPORT sheet (`docs/boe-mapping/09-re-import.md`): the bill's
 * number, date and port go into the row, its own invoice and item serials are
 * how ICES finds the line that went out, and its scheme flags are what propose
 * the notification entry.
 */
export const ShippingBillExtractSchema = z.object({
  /** The shipping bill number, seven digits, from the header block. */
  sbNo: z.string(),
  sbDate: z.string().nullable(),
  /** The six-character ICES port code, from the header's "Port Code" box. */
  portCode: z.string().nullable(),
  /** The date of the section 51 order permitting clearance, when printed. */
  leoDate: z.string().nullable(),
  exporterName: z.string().nullable(),
  exporterIec: z.string().nullable(),
  exporterGstin: z.string().nullable(),
  consigneeName: z.string().nullable(),
  countryOfFinalDestination: z.string().nullable(),
  schemeFlags: ShippingBillSchemeFlagsSchema,
  /** The exchange rate the bill itself used, for converting its own amounts. */
  exchangeRate: z.number().nullable(),
  invoices: z.array(ShippingBillInvoiceSchema),
  marksAndNumbers: z.string().nullable(),
  uncertainFields: z.array(z.string()),
});

export const IntoBondBeExtractSchema = z.object({
  /** The into-bond BE number, as printed. */
  beNumber: z.string(),
  beDate: z.string().nullable(),
  /** Eight-character warehouse code, when the document prints one. */
  warehouseCode: z.string().nullable(),
  warehouseName: z.string().nullable(),
  importerName: z.string().nullable(),
  iec: z.string().nullable(),
  bondNo: z.string().nullable(),
  bondDate: z.string().nullable(),
  bondExpiryDate: z.string().nullable(),
  portCode: z.string().nullable(),
  items: z.array(IntoBondItemSchema),
  uncertainFields: z.array(z.string()),
});

export type Container = z.infer<typeof ContainerSchema>;
/** One invoice off a document. */
export type InvoiceDoc = z.infer<typeof InvoiceDocSchema>;
/** What one file yields: every invoice printed in it. */
export type InvoiceExtract = z.infer<typeof InvoiceExtractSchema>;
export type IntoBondBeExtract = z.infer<typeof IntoBondBeExtractSchema>;
export type ShippingBillExtract = z.infer<typeof ShippingBillExtractSchema>;
export type ShippingBillInvoice = z.infer<typeof ShippingBillInvoiceSchema>;
export type ShippingBillItem = z.infer<typeof ShippingBillItemSchema>;
export type GstTaxInvoiceExtract = z.infer<typeof GstTaxInvoiceExtractSchema>;
export type BlExtract = z.infer<typeof BlExtractSchema>;
export type AwbExtract = z.infer<typeof AwbExtractSchema>;
export type CooExtract = z.infer<typeof CooExtractSchema>;
export type CoaExtract = z.infer<typeof CoaExtractSchema>;
export type PackingListExtract = z.infer<typeof PackingListExtractSchema>;
export type FreightCertificateExtract = z.infer<typeof FreightCertificateExtractSchema>;
export type InsuranceCertificateExtract = z.infer<typeof InsuranceCertificateExtractSchema>;
export type PurchaseOrderExtract = z.infer<typeof PurchaseOrderExtractSchema>;
export type ContractExtract = z.infer<typeof ContractExtractSchema>;

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
    | IntoBondBeExtract
    | GstTaxInvoiceExtract
    | ShippingBillExtract
    | FreightCertificateExtract
    | InsuranceCertificateExtract
    | PurchaseOrderExtract
    | ContractExtract
    | BankCertificateExtract
    | HighSeasAgreementExtract
    | null;
  /** model that produced the accepted extraction */
  model: string;
}
