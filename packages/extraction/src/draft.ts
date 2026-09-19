import type {
  InvoiceInput,
  JobDutyResult,
  ReImportPurpose,
  TermsOfInvoice,
} from '@checklist/core';
import type { DocType } from './schemas.js';

/**
 * How a party on the job came to be bound to a row in the organization
 * repository — the party master exported out of Logi-Sys.
 *
 * Logi-Sys resolves its parties by name, so an unbound party is a name we
 * guessed at rather than one we looked up. 'manual' means a person chose the
 * row, and re-reading the documents must not undo that.
 */
export type PartyMatchStatus = 'exact' | 'fuzzy' | 'ambiguous' | 'none' | 'manual';

/** A reviewer-facing warning attached to the draft. */
export interface DraftFlag {
  severity: 'error' | 'warning' | 'info';
  /** dotted path of the affected field, when field-specific */
  path?: string;
  message: string;
}

/** Provenance/confidence for a field (absent = extracted with high confidence). */
export interface FieldMeta {
  confidence: 'high' | 'medium' | 'low';
  /** file names the value came from */
  sources: string[];
  /** conflicting values seen on other documents, if any */
  conflicts?: { source: string; value: string }[];
}

/**
 * A notification serial number ("II114", "295", "56").
 *
 * Kept alongside the notification because the Bill of Entry needs both: the
 * Logi-Sys template has a `*_NotnSrNo` column beside every `*_Notn` one, and
 * a notification without its serial does not identify an exemption.
 */
export interface NotificationSerials {
  basic?: string;
  sws?: string;
  igst?: string;
  aidc?: string;
  compCess?: string;
}

/**
 * What the packing list says about one item: how many packages hold it, what
 * they weigh, and therefore what one package weighs.
 *
 * The per-package figures are the point. Warehoused goods leave a bond in whole
 * packages and the Bill of Entry states the gross weight released, so a partial
 * ex-bond clearance of 4 bags out of 10 is only computable when one bag has a
 * weight. Present only when a packing-list line matched this item and only
 * when the arithmetic is possible — a line with no package count yields no
 * per-package weight rather than a division by zero.
 */
export interface ItemPacking {
  packages: number;
  /** BAG, CTN, PLT — as the packing list prints it. */
  packageType?: string;
  netWeightKg?: number;
  grossWeightKg?: number;
  /** grossWeightKg / packages, when both are known. */
  perPackageGrossKg?: number;
  /** netWeightKg / packages, when both are known. */
  perPackageNetKg?: number;
  /** The packing-list line this came from, for the operator to check against. */
  sourceDescription: string;
}

/**
 * What is on record about this importer buying from this supplier.
 *
 * A Special Valuation Branch order covers one importer–supplier pair, not a
 * supplier: the same overseas seller can be related to one of a CHA's importers
 * and at arm's length from another. Held in the `supplier_relationships` table
 * and bound onto the draft once both parties are resolved.
 */
export interface SupplierRelationship {
  isRelated: boolean;
  /** How they are related, when they are — shareholding, common control, sole agency. */
  base?: string;
  /** A condition the relationship puts on the price, when there is one. */
  condition?: string;
  svbRefNo?: string;
  svbDate?: string;
  /** The custom house that imposed the load — not the station this BE is filed at. */
  svbCustomHouse?: string;
  /** `A` when the load applies to the assessable value. */
  loadingBasis?: string;
  rateAssessable?: number;
  /** `F` final or `P` provisional. */
  statusAssessable?: string;
  rateDuty?: number;
  statusDuty?: string;
  /**
   * Revenue deposit rate, when the customer's instruction asks for one.
   *
   * Rare, always by communication rather than off a document, and only ever on
   * a related-party import — typically 1% or 5%.
   */
  revenueDepositPercent?: number;
}

/**
 * One invoice on the Bill of Entry — a row of the INVOICES sheet.
 *
 * The valuation half is the duty engine's own input, so a draft invoice can be
 * handed to `computeValuation` without translation. The declaration half is
 * what the sheet asks about the sale itself.
 */
export interface DraftInvoice extends Omit<InvoiceInput, 'items'> {
  /** 1-based serial. `ITEMS.InvSrNo` points back at it. */
  srNo: number;
  /**
   * What the high-seas buyer paid, in the invoice currency.
   *
   * Only on a high seas sale, and only from the HSS invoice — the difference
   * between this and `invoiceValue` is the loading the BE declares.
   */
  hssValue?: number;
  /** The place named after the Incoterm — "CIF NHAVA SHEVA" → "NHAVA SHEVA". */
  termsPlace?: string;
  /** Payment terms exactly as the invoice prints them, before coding. */
  termsOfPayment?: string;
  paymentMethod: string;
  natureOfTransaction: string;
  relatedParty: boolean;
  purchaseOrderNumber?: string;
  purchaseOrderDate?: string;
  contractNumber?: string;
  contractDate?: string;
  lcNumber?: string;
  lcDate?: string;
}

/**
 * Where an ITEMS value came from. The same five sources the header uses
 * (`BoeFieldSource`), recorded per decidable field so the items panel can say
 * which values a person confirmed and which nobody has looked at yet.
 */
export type ItemFieldSource = 'document' | 'master' | 'mail' | 'operator' | 'default';

/** The ITEMS fields a person can decide, and so the ones provenance is kept for. */
export type ItemDecidableField =
  | 'ritc'
  | 'generalDescription'
  | 'brand'
  | 'model'
  | 'endUseCode'
  | 'originCountry'
  | 'manufacturer'
  | 'fta'
  | 'eximScheme'
  | 'tradeRemedies'
  | 'foc';

/**
 * A notification and its serial on one duty line of the item, in Logi-Sys'
 * spelling (`011/2021`, `17`). `flag` is the Plus/Minus/Higher/Lower dropdown
 * beside the line (see `NOTN_FLAG` in @checklist/core).
 */
export interface NotificationLine {
  notification: string;
  serial?: string;
  flag?: '+' | '-' | 'H' | 'L';
}

/** An IGST or compensation-cess exemption: a notification line plus its C/G type. */
export interface ExemptionLine extends NotificationLine {
  /** `C` — granted by a Customs notification; `G` — by a GST notification. */
  type: 'C' | 'G';
}

/**
 * A preferential-origin claim on one item.
 *
 * Per item, not per Bill of Entry: a certificate of origin lists goods line by
 * line, the agreement's schedule has a serial per tariff line, and a BE can mix
 * originating goods with goods that do not qualify. `ChecklistDraft.ftaClaim`
 * predates this and is kept only so older drafts still read.
 */
export interface ItemFtaClaim {
  /** Agreement key in the FTA master, e.g. `IN-JP-CEPA`. */
  agreement: string;
  /** Display name, e.g. "India-Japan CEPA" — also written to `bcdExemption.scheme`. */
  scheme: string;
  /** Which ITEMS columns carry the concession: `Basic_Notn` or `SAPTA_Notn`. */
  slot: 'BASIC' | 'SAPTA';
  notification: string;
  serial?: string;
  cooNumber?: string;
  cooDate?: string;
  countryOfIssue?: string;
  originCriterion?: string;
  originCriterionRemarks?: string;
  tariffShift?: string;
  accumulation?: string;
  directConsignment?: boolean;
  retroactiveIssuance?: boolean;
  itemSrNoInCertificate?: string;
  /** The retroactive-issuance check against the agreement's own rule. */
  retroactiveCheck?: { compliant: boolean; reason: string };
}

/** Anti-dumping, safeguard or countervailing duty on one item. */
export interface TradeRemedyLine {
  kind: 'ADD' | 'SAFEGUARD' | 'CVD';
  notification: string;
  serial?: string;
  /** The row of the notification's duty table — `CTHSrNo` / `CVD_ItemSrNo`. */
  cthSerial?: string;
  /** The producer/exporter row — `SuppSrNo` / `CVD_SupplierSrNo`. */
  supplierSerial?: string;
  quantity?: number;
  basis?: 'AV' | 'LANDED';
  ratePercent?: number;
  currency?: string;
  amountPerUnit?: number;
  amountUnit?: string;
  flag?: '+' | '-' | 'H' | 'L';
}

/** A tariff value under Customs Act s.14(2), in the notification's own unit. */
export interface TariffValueLine {
  notification: string;
  serial: string;
  quantity: number;
  currency: string;
  amountPerUnit: number;
  unit: string;
}

/** The earlier Bill of Entry the same goods came in on, when the operator gives one. */
export interface PreviousBe {
  beNo?: string;
  beDate?: string;
  igmNo?: string;
  igmDate?: string;
  currency?: string;
  unitPrice?: number;
  customHouse?: string;
}

/**
 * The shipping bill a re-imported line went out under, and what it claims.
 *
 * One of these per line of goods that is a re-import; it becomes one row of the
 * RE-IMPORT sheet. `docs/boe-mapping/09-re-import.md` is the contract.
 *
 * Everything is `Resolved` because the export leg is a fact about a different
 * filing, made at a different time, and the job screen has to show where each
 * value came from. `notification` is deliberately optional and separate from
 * `candidates`: the shipping bill's scheme flags usually fit several entries of
 * 45/2017, one row carries one entry, and nothing but a person may choose. The
 * exporter refuses while it is unset.
 */
export interface ItemReImport {
  /** The shipping bill's number. A string: seven digits, leading zeros real. */
  sbNo: Resolved<string>;
  sbDate: Resolved<string>;
  /** ICES six-character port code, never the port's name. */
  portOfExport: Resolved<string>;
  /** The invoice's serial *within the shipping bill*, not on this BE. */
  sbInvSrNo: Resolved<number>;
  /** The item's serial within that shipping-bill invoice. */
  sbItemSrNo: Resolved<number>;
  /** The entry claimed, once someone has confirmed it. */
  notification?: Resolved<{ notification: string; serial: string }>;
  /**
   * What the shipping bill's scheme flags say could be claimed, with the reason
   * for each. Kept on the draft so the job screen can show the choice without
   * re-reading the bill, and so the export can say what it was waiting for.
   */
  candidates?: ReImportCandidateSummary[];
  /** The export leg's freight, in rupees, apportioned to this line. */
  exportFreightInr?: Resolved<number>;
  /** The export leg's insurance, in rupees, apportioned to this line. */
  exportInsuranceInr?: Resolved<number>;
  /** Customs incentive repaid — ICES calls this BCD Amount. */
  customsDuty?: Resolved<number>;
  /** Excise incentive repaid — ICES calls this CVD Amount. */
  exciseDuty?: Resolved<number>;
  /** IGST refunded at export, or IGST not paid because the export was under bond. */
  igstPaid?: Resolved<number>;
  /** Why the goods went out, when a document or the instruction says. */
  purpose?: ReImportPurpose;
  /** Set when the goods are outside the notifications altogether. */
  exclusion?: string;
}

/** One entry the export could claim, flattened for storage on the draft. */
export interface ReImportCandidateSummary {
  notification: string;
  serial: string;
  /** The notification's own words for the entry. */
  description: string;
  /** The notification's own words for what is payable. */
  amountPayable: string;
  /** Why this entry is on the list. */
  because: string;
  /** Things to look at before choosing it — a time limit missed, a condition. */
  cautions: string[];
  /** Whether this entry needs the export leg's freight and insurance. */
  needsExportFreightInsurance: boolean;
  /** Whether this entry needs the incentive amounts repaid. */
  needsIncentiveRepayment: boolean;
}

/** Import under an export-promotion scheme: `Exim_Code` and its notification. */
export interface EximSchemeLine {
  code: string;
  notification?: string;
  serial?: string;
  policyPara?: string;
  policyYear?: string;
}

export interface DraftItem {
  slNo: number;
  /** Which invoice this line was billed on — `INVOICES.InvSrNo`. */
  invoiceSrNo: number;
  description: string;
  ritc: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  bcdRate: number;
  bcdNotification?: string;
  bcdExemption?: { notification: string; serial?: string; percent: number; scheme?: string };
  swsRate: number;
  igstRate: number;
  igstNotification?: string;
  aidcRate: number;
  aidcNotification?: string;
  compCessRate: number;
  compCessNotification?: string;
  /** Serial numbers for the notifications above, where known. */
  notificationSerials?: NotificationSerials;
  originCountry?: string;
  manufacturerName?: string;
  manufacturerAddress?: string;
  /** Manufacturer's country, separate from the address so it can be coded. */
  manufacturerCountry?: string;
  /** Trade description as declared, distinct from the invoice description. */
  generalDescription?: string;
  brand?: string;
  model?: string;
  endUseCode: string;
  /**
   * Single Window production details (food/pharma) — one entry per batch.
   *
   * Plural because ICES is: a consignment normally carries several lots and
   * each gets its own SW_PRODUCTION row. See docs/boe-mapping/13-sw-production.md.
   */
  batches?: DraftBatch[];
  /**
   * The chemical declaration for chapters 28/29/32/39 and heading 3808 —
   * Circular 23/2023, mandatory since 15.10.2023. See
   * docs/boe-mapping/11-sw-addl-info.md.
   *
   * `category` is one of `CHEMICAL_CATEGORIES` (`CPCBB`/`CPCFM`/`CPCPR`) and is
   * a statement about what the goods *are*, so it is an operator decision: no
   * document on a job says it. `casNumber` and `iupacName` come off a
   * certificate of analysis or safety data sheet where one is uploaded, and
   * are the operator's otherwise.
   */
  chemical?: { category?: string; casNumber?: string; iupacName?: string };
  /**
   * The hazardous-cargo answer for a CTH on Annexure-A of Circular 24/2026.
   *
   * `undefined` is distinct from `false`: it means nobody has been asked, and
   * no `CHR/HZRDS` row is filed. It is the importer's declaration to make, not
   * ours to infer from the tariff heading.
   */
  hazardous?: boolean;
  /** (expiry − today) / (expiry − manufacture), % — PGA shelf-life requirement */
  residualShelfLifePercent?: number;
  /** What the packing list says about this item, when a line matched it. */
  packing?: ItemPacking;

  // ---- ITEMS sheet (docs/boe-mapping/06-items.md) ----

  /** Country the goods were consigned from, when it differs from origin. */
  sourceCountry?: string;
  /** Country the goods passed through — mandatory on the BE when an FTA is claimed. */
  transitCountry?: string;
  manufacturerState?: string;
  manufacturerPin?: string;
  /** `0` none, `1` supplied with the item, `2` declared as separate items. */
  accessoryStatus?: '0' | '1' | '2';
  accessoriesDetails?: string;
  eximScheme?: EximSchemeLine;
  /** Social Welfare Surcharge exemption (11/2018-Customs), when one applies. */
  swsExemption?: NotificationLine;
  /** AIDC levy serial and flag; the notification number stays `aidcNotification`. */
  aidcLevy?: NotificationLine;
  aidcExemption?: NotificationLine;
  healthCessRate?: number;
  healthCess?: NotificationLine;
  igstLevyFlag?: '+' | '-' | 'H' | 'L';
  igstExemption?: ExemptionLine;
  compCessLevyFlag?: '+' | '-' | 'H' | 'L';
  compCessExemption?: ExemptionLine;
  /** Preferential-origin claim for this item, when one is made. */
  fta?: ItemFtaClaim;
  tradeRemedies?: TradeRemedyLine[];
  tariffValue?: TariffValueLine;
  /** No commercial value / free of charge on the invoice line. */
  foc?: boolean;
  previousBe?: PreviousBe;
  /** The shipping bill these goods went out under, when the line is a re-import. */
  reImport?: ItemReImport;
  /** Importer's own material code, when the operator records one. */
  materialCode?: string;
  /**
   * Trade-remedy rows that could apply but could not be settled — two named
   * producers, or a producer the manufacturer only resembles. The export
   * refuses while any are open; the items panel offers them as the choice.
   */
  tradeRemedyCandidates?: {
    kind: 'ADD' | 'SAFEGUARD' | 'CVD';
    notification: string;
    cthSerial?: string;
    supplierSerial?: string;
    producer: string;
    exporter: string;
    /** The row's duty, so choosing it files a computable line. */
    line?: TradeRemedyLine;
  }[];
  /** Which source decided each operator-decidable field. */
  sources?: Partial<Record<ItemDecidableField, ItemFieldSource>>;
}

/**
 * A certificate of origin as the item resolver needs it: which goods it covers
 * and what it says about them. Kept on the draft because the preferential
 * claim is decided per item, after the CTH is final — which is later than the
 * merge that read the certificate.
 */
export interface DraftCertificateOfOrigin {
  fileName?: string;
  certificateNumber: string;
  issueDate?: string;
  issuingCountry?: string;
  originCountry?: string;
  schemeText?: string;
  originCriterion?: string;
  producerName?: string;
  producerAddress?: string;
  transitCountries: string[];
  issuedRetroactively?: boolean | null;
  thirdPartyInvoicing?: boolean | null;
  invoiceNumberRef?: string;
  items: {
    itemNumber?: string;
    description: string;
    hsCode?: string;
    originCriterion?: string;
  }[];
}

/**
 * A preferential rate the goods could have had and did not claim: the origin
 * is a partner country, the agreement's schedule names the CTH, and there is
 * no certificate on the job. The customer's rule is to ask the importer.
 */
export interface FtaOpportunity {
  invoiceSrNo: number;
  itemSlNo: number;
  agreement: string;
  agreementName: string;
  notification: string;
  serial: string;
  standardBcdRate: number;
  preferentialRateText: string | null;
  /** Rupees of BCD (and the SWS on it) that the claim would save, when computable. */
  estimatedSaving?: number;
}

/** SINGLE WINDOW - Additional Product Information rows. */
export interface SingleWindowInfoRow {
  /**
   * The invoice the line is on. Item serials restart per invoice, so without it
   * a row cannot say which line it belongs to. Absent on drafts saved before it
   * was recorded, which were single-invoice in practice: read as 1.
   */
  invoiceSrNo?: number;
  itemSlNo: number;
  infoType: string;
  qualifier: string;
  code?: string;
  /** Free-text payload — a CAS number, an IUPAC name, a brand declaration. */
  information?: string;
  measurement?: number;
  unit?: string;
}

/**
 * Where a value on the Bill of Entry header came from.
 *
 * Recorded per field rather than inferred, because the whole failure mode this
 * replaces was a column quietly becoming a constant. A field whose source is
 * `default` is one nobody has confirmed, and the exporter says so.
 */
export type BoeFieldSource = 'document' | 'master' | 'mail' | 'operator' | 'default';

/** A resolved header value, with what decided it. */
export interface Resolved<T> {
  value: T;
  source: BoeFieldSource;
  /** The sentence in the customer's mail this came from, when source is 'mail'. */
  quote?: string;
  /** Why this value, in the operator's language — shown beside the field. */
  because?: string;
}

/**
 * The GENERAL sheet's operator flags: `Y` when true, blank when false.
 *
 * `undefined` and `false` are the same cell on this sheet — the vendor's own
 * export writes nothing for "no" — but they are kept apart here so the job
 * screen can tell an unticked box from one nobody has looked at.
 */
export interface BoeFlags {
  firstCheck?: boolean;
  greenChannel?: boolean;
  kachchaBe?: boolean;
  hss?: boolean;
  bondsCertificates?: boolean;
  transhipment?: boolean;
  itcLicDetails?: boolean;
  provisionalAssessment?: boolean;
  /** Derived from the filing and inward dates; the operator may clear either. */
  underSec46?: boolean;
  underSec48?: boolean;
  sec46OverrideReason?: string;
}

/**
 * The Bill of Entry header, as resolved rather than as read.
 *
 * Everything on GENERAL that is not simply copied off a document lives here:
 * the custom house, the BE type, the duty payment status, the filing posture
 * and the nine yes/no flags. `applyGeneralResolution` fills it from the
 * masters, the customer's instruction mail and the operator's own entries, in
 * that order of precedence.
 */
export interface BoeHeader {
  transportMode: Resolved<'Air' | 'Sea' | 'Land'>;
  customStation: Resolved<{ code: string; name: string }> | undefined;
  beType: Resolved<'Home Consumption' | 'Warehousing' | 'Ex-Bond'>;
  dutyPaymentStatus: Resolved<'T' | 'D'>;
  filingStatus: Resolved<'Normal' | 'Prior' | 'Advance'> | undefined;
  adCode: Resolved<string> | undefined;
  importerRefNo: Resolved<string> | undefined;
  /** The importer's AD codes, when there is more than one to choose between. */
  adCodeChoices?: { adCode: string; bankName?: string }[];
  flags: BoeFlags;
}

/**
 * The bonded warehouse a `W` or `EX` Bill of Entry names.
 *
 * The code is the only part that decodes: `MAA1U001` is a public warehouse
 * under Chennai Sea, checkable offline against the custom-house master. The
 * name and address are not encoded anywhere in it — they come from ICEGATE's
 * warehouse enquiry or from the operator, and are cached per company.
 */
export interface WarehouseDetails {
  code: string;
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  pin?: string;
  /** Always IN: a warehouse licensed under the Customs Act is in India. */
  country: string;
  /** ICES code of the licensing station, from the code's first four characters. */
  stationCode?: string;
  stationName?: string;
  type?: 'public' | 'private' | 'special';
}

/**
 * How much of a warehoused consignment this Bill of Entry releases.
 *
 * Goods leave a bond in whole packages, and ICES wants the count, the package
 * code, the gross weight of those packages and its unit (BE Message format
 * 2.25, header fields 35–38 — all mandatory on an ex-bond BE). The weight is
 * derived from the packing list's per-package figures where they exist, which
 * is why the packing list is read line by line.
 */
export interface ExBondRelease {
  packages: number;
  packageCode?: string;
  grossWeightKg?: number;
  unit?: string;
  /** Per item: how much of its warehoused quantity this BE draws down. */
  items?: { slNo: number; quantity: number; packages?: number }[];
  /** Set when the figures were computed rather than keyed. */
  derived?: boolean;
}

/**
 * What an ex-bond Bill of Entry out of a Section 65 warehouse actually clears.
 *
 * Only `resultant_product` carries SEC65_EXBOND_INFO rows. Circular 48/2020
 * para 8.1 allows warehoused goods to be cleared `as_such` when no manufacture
 * happened — with section 61 interest, and with no finished product to declare
 * — and capital goods leave the premises the same way. Filing SEC65 control
 * rows on either is ICES error 868.
 */
export type ExBondClearanceKind =
  | 'resultant_product'
  | 'as_such'
  | 'capital_goods'
  | 'job_work_return';

/**
 * One finished product, cleared under one GST invoice, out of a Section 65
 * warehouse.
 *
 * Nothing on the import side carries any of this. The Bill of Entry's items are
 * the imported *inputs*; these six values describe the *output* they were
 * manufactured into — which is why the sheet could not be derived and had to
 * become an operator surface.
 *
 * ICES carries them as BE_ITEM_SW_CTRL rows with Control Type Code `SEC65`
 * (BE Message format 2.25, CACHI01 Part 22/24): Control Result Code is the GST
 * invoice number, Control End Date its date, Control Result Text the CTH and
 * description joined, Control MSR and Control UQC the quantity and its unit.
 */
export interface Sec65FinishedGood {
  /** Control Result Code — 16 characters at most (ICES error 728). */
  gstInvoiceNo: string;
  /** Control End Date. */
  gstInvoiceDate: string;
  /** The finished product's own eight-digit CTH, not the input's. */
  cth: string;
  description: string;
  /** Control MSR — the quantity cleared, in the finished product's unit. */
  quantity: number;
  /** Control UQC. */
  uqc: string;
  /**
   * The item serials this entry is declared against. Undefined means every item
   * on the BE, which is the ordinary case: all the imported inputs went into
   * the one resultant product.
   */
  itemSrNos?: number[];
}

/**
 * The INBOND_EXBOND sheet, as resolved.
 *
 * Absent for a home-consumption BE, which is what leaves that sheet
 * header-only. Everything here is `W`/`EX`-only and none of it appears on a
 * shipping document — it is the warehouse licence, the bond executed with
 * Customs, and (for an ex-bond filing) the earlier into-bond BE being drawn
 * against.
 */
export interface InbondExbond {
  warehouse: Resolved<WarehouseDetails> | undefined;
  inBondBeNo: Resolved<string> | undefined;
  inBondBeDate: Resolved<string> | undefined;
  bondNo: Resolved<string> | undefined;
  bondDate: Resolved<string> | undefined;
  bondExpiryDate: Resolved<string> | undefined;
  /** `Y` or blank on the sheet; tri-state here so the job screen can ask. */
  isWarehouseSale?: boolean;
  /**
   * The warehouse holds a section 65 permission — a fact about the warehouse,
   * not about this filing. It is what INBOND_EXBOND column 14 reports; what
   * *this* BE clears out of that warehouse is `clearanceKind`.
   */
  isSec65ManufacturingWh?: boolean;
  /** Ex-bond only. */
  release?: Resolved<ExBondRelease>;
  /**
   * Ex-bond only, and only out of a Section 65 warehouse: what this filing
   * clears. Unset means the operator has not said, which warns rather than
   * assuming a resultant-product clearance.
   */
  clearanceKind?: ExBondClearanceKind;
  /** The finished products this BE clears. Empty or absent unless SEC65. */
  sec65FinishedGoods?: Resolved<Sec65FinishedGood[]>;
  /** The into-bond job this ex-bond filing draws against, when linked. */
  intoBondJobId?: string;
}

/**
 * One party in a high-seas chain of sales — the HSS sheet.
 *
 * ICES `<TABLE>HSS` (BE Message format 2.25, CACHI01 Part 12/24). `level` is
 * the spec's *preceding level*, counted backwards from the filing importer:
 * `0` is the party who sold to them, `1` that party's seller, and so on. The
 * filing importer is on GENERAL and is never in this list.
 *
 * See docs/boe-mapping/16-hss.md.
 */
export interface HssParty {
  /** Preceding level. `C(1)` on the sheet, so at most ten links. */
  level: number;
  iec: string;
  /** Branch of that IEC. ICES rejects one it has not registered (error 163). */
  branchSrNo?: number;
  name?: string;
  branchName?: string;
  /** The seller's own authorised-dealer code. Reaches no ICES field. */
  adCode?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
}

/**
 * One row of BONDS_CERTIFICATES — a bond registered with Customs, or a
 * certificate produced in lieu of one.
 *
 * The sheet merges two ICES tables, `<TABLE>BOND` (Part 10/24) and
 * `<TABLE>CERT` (Part 11/24); `kind` is the discriminator Logi-Sys puts in
 * column A. A bond carries a registration port and no date, a certificate a
 * date and no port — that is the two field lists, not a convention.
 *
 * See docs/boe-mapping/17-bonds-certificates.md.
 */
export interface BondOrCertificate {
  kind: 'bond' | 'certificate';
  /** A `BOND_CODES` key on a bond, a `CERTIFICATE_TYPES` key on a certificate. */
  type: string;
  /** Bond number `N(10)`, or certificate number `C(30)` — a string either way. */
  number: string;
  /** Certificates only; ICES has no date field on a bond. */
  date?: string;
  /** The Central Excise jurisdiction, for a certificate in lieu of a bond. */
  commissionerate?: string;
  division?: string;
  range?: string;
  /** Bonds only — the ICES station the bond is registered at. */
  registrationPortCode?: string;
  /**
   * True when the code was proposed from a licence or a scheme rather than
   * stated by the operator. A proposed row warns; see the `EZ`/`EC` question
   * in docs/boe-mapping/open-questions.md#epcg-bond-code.
   */
  proposed?: boolean;
}

/**
 * One production batch of a line of goods — the SW_PRODUCTION sheet.
 *
 * ICES `<TABLE>BE_ITEM_SW_PROD` (Part 21/24). Plural on purpose: the spec says
 * "Production batch nos are provided along with the consignments", and a
 * consignment of six lots of one drug declares six rows.
 *
 * See docs/boe-mapping/13-sw-production.md.
 */
export interface DraftBatch {
  batchNo?: string;
  /** This batch's quantity, not the line's. */
  quantity?: number;
  manufactureDate?: string;
  expiryDate?: string;
  /**
   * Optional to ICES, mandatory to the Logi-Sys uploader. Kept separate from
   * `expiryDate` because a best-before is a quality date and an expiry is a
   * safety date, and food packs carry both.
   */
  bestBeforeDate?: string;
}

/**
 * A document already uploaded to eSanchit, referenced by the number ICEGATE
 * gave back — the SUPPORTING_DOCS sheet.
 *
 * `irn` and `uploadedAt` are the only two fields here that no document, master
 * or extraction can produce; they come from eSanchit. A document without them
 * warns and files no row.
 *
 * See docs/boe-mapping/18-supporting-docs.md.
 */
export interface DraftSupportingDoc {
  fileName: string;
  docType: DocType;
  /** eSanchit image reference number, `C(16)`: YYYYMMDD + an eight-digit serial. */
  irn?: string;
  /** ISO timestamp; the sheet writes it as `DD-MM-YYYY HH:MM:SS`. */
  uploadedAt?: string;
  /** `C(17)` — the invoice, licence or certificate number this document is. */
  referenceNo?: string;
  /** Place of issue, and the document's own issue date. */
  issuedAt?: string;
  issueDate?: string;
  expiryDate?: string;
  issuingParty?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    postalCode?: string;
  };
  /**
   * Which line the document applies to. Absent means the whole Bill of Entry,
   * which the sheet writes as `0`/`0`.
   */
  invoiceSrNo?: number;
  itemSrNo?: number;
}

export interface ChecklistDraft {
  tenantId: string;
  transportMode: 'Air' | 'Sea' | 'Land';
  beType: 'Home Consumption' | 'Warehousing' | 'Ex-Bond';
  /**
   * Optional, because nothing in the shipping documents says which custom house
   * a consignment is filed at — it is the customer's instruction. The merge
   * leaves it unset and `applyGeneralResolution` fills it from the mail, the
   * importer's default, or the operator. An export with no station is blocked.
   */
  customStation?: { code: string; name: string };
  /** Unset until the IGM has been checked — see `filingStatusFrom`. */
  filingStatus?: 'Normal' | 'Prior' | 'Advance';
  /**
   * The resolved header. Absent on a draft that has only been merged — it is
   * filled by `applyGeneralResolution`, which needs a company, a database and
   * the job's mail thread, none of which the synchronous merge has.
   */
  boe?: BoeHeader;
  /**
   * The warehousing block. Absent for a home-consumption BE — which is exactly
   * what keeps INBOND_EXBOND header-only. Filled by
   * `applyInbondExbondResolution`, which runs after the header resolver
   * because it needs the settled BE type.
   */
  inbondExbond?: InbondExbond;

  /**
   * The chain of sales afloat, for the HSS sheet.
   *
   * Ordered by preceding level, `0` first. Empty or absent on an ordinary
   * import. `boe.flags.hss` and this list move together: the flag without the
   * chain is ICES error 116. See docs/boe-mapping/16-hss.md.
   */
  hssChain?: HssParty[];

  /**
   * The bonds and certificates this Bill of Entry draws against.
   *
   * `boe.flags.bondsCertificates` is derived from this being non-empty, which
   * is what all three populated vendor exports do. See
   * docs/boe-mapping/17-bonds-certificates.md.
   */
  bonds?: BondOrCertificate[];

  importer: {
    name: string;
    addressLines: string[];
    iec?: string;
    pan?: string;
    gstin?: string;
    gstStateCode?: string;
    gstStateName?: string;
    adCode?: string;
    branchSno?: string;
    /** Branch *name*, which the template asks for separately from branchSno. */
    branchName?: string;
    city?: string;
    /** The importer's party code in Logi-Sys, when we know it. */
    logisysPartyCode?: string;
    matchedFromMasters: boolean;
    /** Row in the uploaded organization repository this party is bound to. */
    organizationId?: string;
    matchStatus?: PartyMatchStatus;
  };
  supplier: {
    name: string;
    addressLines: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    branchName?: string;
    iec?: string;
    gstin?: string;
    organizationId?: string;
    matchStatus?: PartyMatchStatus;
  };

  shipment: {
    mawbNo?: string;
    mawbDate?: string;
    hawbNo?: string;
    hawbDate?: string;
    blNo?: string;
    blDate?: string;
    hblNo?: string;
    hblDate?: string;
    igmNo?: string;
    igmDate?: string;
    inwardDate?: string;
    /**
     * The consignment's line number on the IGM. Keyed from ICEGATE like the IGM
     * itself — no document the customer sends states it.
     */
    lineNo?: string;
    /**
     * The gateway port's IGM, for a consignment cleared at an ICD.
     *
     * When goods land at a sea port and move inland under bond, two manifests
     * exist: the ICD's, which goes in `igmNo`, and the gateway sea port's,
     * which goes here. On a direct-port filing these stay empty.
     */
    gatewayIgmNo?: string;
    gatewayIgmDate?: string;
    gatewayInwardDate?: string;
    /**
     * Whether anyone has actually looked ICEGATE up for an IGM against this BL.
     * Without it, an absent `igmNo` cannot be told apart from an unchecked one,
     * and those mean opposite things for `AdvancePriorNormal`.
     */
    igmChecked?: boolean;
    /** The day the Bill of Entry is presented — drives Sections 46 and 48. */
    beFilingDate?: string;
    eta?: string;
    vesselOrFlight?: string;
    /** Voyage number on its own, so it need not be parsed back out of vesselOrFlight. */
    voyageNo?: string;
    shippingLineOrCarrier?: string;
    portOfLoading?: string;
    /** Port of discharge off the transport document. */
    portOfDischarge?: string;
    /**
     * Place of final delivery off the bill of lading.
     *
     * The field the ICD test reads: a consignment delivered inland is `L` on
     * GENERAL however it crossed the ocean. It was already being extracted and
     * then dropped here.
     */
    placeOfDelivery?: string;
    /**
     * Airport of destination off the air waybill — the air equivalent of
     * `placeOfDelivery`, and for the same reason: it is the station the Bill of
     * Entry is filed at. It was extracted and then dropped here, so an air job
     * reached the header with no place to resolve a custom house from at all.
     */
    airportOfDestination?: string;
    consCountry?: string;
    countryOfOrigin?: string;
    packageCount?: number;
    packageUnit?: string;
    grossWeightKg?: number;
    netWeightKg?: number;
    /**
     * The weight unit code the BE writes — `KGS` on every vendor export we
     * hold. Resolved through the weight-unit master rather than written as a
     * literal, so a `KGM` or `LBS` document is converted instead of assumed.
     */
    weightUnitCode?: string;
    marksAndNos?: string;
    /**
     * Whether a person chose the marks.
     *
     * Sea filings print "AS PER BL" by convention, but a re-import or FOC
     * consignment carries a declaration instead ("RE-IMPORT OF INDIAN ORIGIN
     * GOODS & RE EXPORTED"). Without this flag a re-read of the documents
     * overwrites what the operator typed.
     */
    marksAndNosFromOperator?: boolean;
    containers: {
      number: string;
      sizeType?: string;
      sealNo?: string;
      /** Packages stuffed in this container, when the packing list breaks it down. */
      packagesStuffed?: number;
      grossWeightKg?: number;
    }[];
    /**
     * How many containers the bill of lading says there are.
     *
     * Kept beside the list because the two can disagree, and a disagreement is
     * the only cheap signal that boxes went missing on the way in: "SAY : SIX
     * CONTAINERS ONLY" against a list of one is a wrong Bill of Entry, and
     * without the stated figure nothing downstream can tell.
     */
    containerCountStated?: number;
  };

  invoiceMeta: {
    /**
     * Every currency this Bill of Entry converts at, and its customs rate.
     *
     * One BE can carry invoices in several currencies — `ex_job5` files twelve
     * invoices against `100 JPY = 60.8000 INR, 1 USD = 96.6000 INR` — so the
     * rate belongs to the BE, keyed by currency, not to a single invoice.
     */
    exchangeRates: Record<string, number>;
    /**
     * The bank's rate certificate, for a currency the Ministry of Finance
     * notification does not cover.
     *
     * ICES calls those "non-standard currencies" and makes the bank name,
     * certificate number and certificate date mandatory on their EXCHANGE_RATE
     * row (error 155); the certificate date must equal the filing date. Keyed
     * by currency, like the rates themselves.
     * See docs/boe-mapping/19-exchange-rate.md.
     */
    bankRateCertificates?: Record<string, { rate: number; bankName: string; certificateNo: string; certificateDate: string }>;
  };

  /**
   * The invoices this Bill of Entry declares, in serial order.
   *
   * One row each on the INVOICES sheet. `items` stays a flat, BE-wide list —
   * which is the shape the ITEMS sheet wants — and each item names the invoice
   * it belongs to through `invoiceSrNo`.
   */
  invoices: DraftInvoice[];
  items: DraftItem[];

  /**
   * The SVB / related-party record for this importer–supplier pair, when one
   * exists. Absent means nobody has recorded a relationship, which is not the
   * same as having recorded that there is none.
   */
  supplierRelationship?: SupplierRelationship;

  ftaClaim?: {
    scheme: string;
    cooNumber: string;
    cooDate?: string;
    countryOfIssue?: string;
    originCriterion?: string;
    directConsignment: boolean;
    /** Certificate issued after shipment — declared separately on the BE. */
    retroactiveIssuance?: boolean;
  };

  singleWindowInfo?: SingleWindowInfoRow[];

  /** Every certificate of origin on the job, for the per-item preferential claim. */
  certificatesOfOrigin?: DraftCertificateOfOrigin[];
  /** Preferential rates not claimed for want of a certificate — see `FtaOpportunity`. */
  ftaOpportunities?: FtaOpportunity[];

  supportingDocs: DraftSupportingDoc[];
  declarations: { code: string; text: string }[];

  duty: JobDutyResult | null;

  fieldMeta: Record<string, FieldMeta>;
  flags: DraftFlag[];
}

/**
 * The invoice a single-invoice caller means.
 *
 * A Bill of Entry always has at least one invoice; the ones that legitimately
 * want just one — the export filename's date stamp, a page heading — take the
 * first. Anything that values, declares or totals must iterate instead.
 */
export function primaryInvoice(draft: ChecklistDraft): DraftInvoice | undefined {
  return draft.invoices[0];
}

/** Convert one draft invoice and its share of the items into duty-engine input. */
export function toInvoiceInput(draft: ChecklistDraft, invoice: DraftInvoice): InvoiceInput {
  return {
    ...invoice,
    items: draft.items
      .filter((it) => it.invoiceSrNo === invoice.srNo)
      .map((it) => ({
        slNo: it.slNo,
        description: it.description,
        ritc: it.ritc,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        bcdRate: it.bcdRate,
        ...(it.bcdNotification !== undefined && { bcdNotification: it.bcdNotification }),
        ...(it.bcdExemption && {
          bcdExemption: {
            notification: it.bcdExemption.notification,
            percent: it.bcdExemption.percent,
            ...(it.bcdExemption.serial !== undefined && { serial: it.bcdExemption.serial }),
          },
        }),
        swsRate: it.swsRate,
        igstRate: it.igstRate,
        ...(it.igstNotification !== undefined && { igstNotification: it.igstNotification }),
        aidcRate: it.aidcRate,
        ...(it.aidcNotification !== undefined && { aidcNotification: it.aidcNotification }),
        compCessRate: it.compCessRate,
        ...(it.compCessNotification !== undefined && { compCessNotification: it.compCessNotification }),
        ...(it.healthCessRate !== undefined && { healthCessRate: it.healthCessRate }),
        ...(it.tariffValue && {
          tariffValue: {
            amountPerUnit: it.tariffValue.amountPerUnit,
            currency: it.tariffValue.currency,
            quantity: it.tariffValue.quantity,
          },
        }),
        ...(it.tradeRemedies?.length && {
          tradeRemedies: it.tradeRemedies.map((l) => ({
            kind: l.kind,
            ...(l.ratePercent !== undefined && { ratePercent: l.ratePercent }),
            ...(l.basis !== undefined && { basis: l.basis }),
            ...(l.amountPerUnit !== undefined && { amountPerUnit: l.amountPerUnit }),
            ...(l.currency !== undefined && { currency: l.currency }),
            ...(l.quantity !== undefined && { quantity: l.quantity }),
            ...(l.flag !== undefined && { flag: l.flag }),
          })),
        }),
      })),
  };
}

/** Every invoice on the draft as duty-engine input, in serial order. */
export function toInvoiceInputs(draft: ChecklistDraft): InvoiceInput[] {
  return draft.invoices.map((inv) => toInvoiceInput(draft, inv));
}

export type { TermsOfInvoice };
