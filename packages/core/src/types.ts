/**
 * Core domain types for the Bill of Entry checklist duty engine.
 *
 * Modelled on the Logi-Sys job structure and the printed
 * "CheckList - Bill of Entry for Home Consumption" format.
 */

/** Terms of invoice as declared on the BE (drives which charges are added to reach CIF). */
export type TermsOfInvoice = 'FOB' | 'CIF' | 'CFR' | 'C&F' | 'CI' | 'EXW';

/** An amount in a specific currency. INR amounts use rate 1. */
export interface MoneyAmount {
  amount: number;
  currency: string;
}

/** Insurance can be an actual amount or a notional percentage of the invoice value. */
export type InsuranceSpec =
  | { kind: 'amount'; value: MoneyAmount }
  | { kind: 'percent'; percent: number };

export interface ExchangeRateTable {
  /** currency code (e.g. "USD") -> INR per unit, CBIC customs rate */
  [currency: string]: number;
}

export interface InvoiceInput {
  invoiceNumber: string;
  invoiceDate: string;
  termsOfInvoice: TermsOfInvoice;
  currency: string;
  /** Goods value as invoiced (sum of item ext prices), in invoice currency. */
  invoiceValue: number;
  /** Freight to be added (FOB/EXW invoices), in its own currency. */
  freight?: MoneyAmount;
  /** Insurance to be added (FOB/CFR invoices): actual amount or notional %. */
  insurance?: InsuranceSpec;
  /** Miscellaneous dutiable charges (e.g. freight lines billed on the invoice). */
  miscCharges?: MoneyAmount;
  /** Loading/handling additions, if any. */
  loadingCharges?: MoneyAmount;
  /** Discount subtracted before valuation, if any (positive number). */
  discount?: MoneyAmount;
  items: ItemInput[];
}

/** A duty exemption claimed against a notification (e.g. FTA/DFTP 100% BCD exemption). */
export interface ExemptionClaim {
  notification: string;
  serial?: string;
  /** Percentage of the duty exempted: 100 = fully exempt. */
  percent: number;
}

export interface ItemInput {
  slNo: number;
  description: string;
  /** 8-digit RITC/CTH code. */
  ritc: string;
  quantity: number;
  unit: string;
  /** Unit price in invoice currency. */
  unitPrice: number;
  /** Standard BCD rate %, before exemptions. */
  bcdRate: number;
  bcdNotification?: string;
  /** Preferential/FTA exemption on BCD, if claimed. */
  bcdExemption?: ExemptionClaim;
  /** Social Welfare Surcharge % on BCD (default 10). */
  swsRate?: number;
  /** IGST rate % with its schedule notification serial. */
  igstRate: number;
  igstNotification?: string;
  /** AIDC % (Agriculture Infrastructure & Development Cess), on assessable value. */
  aidcRate?: number;
  aidcNotification?: string;
  /** Health cess % on assessable value. */
  healthCessRate?: number;
  /** GST compensation cess % on the IGST base. */
  compCessRate?: number;
  compCessNotification?: string;
}

/** Per-item duty computation result. All INR values rounded to 2dp for display. */
export interface ItemDutyResult {
  slNo: number;
  /** Item's pro-rata share of the total assessable value (INR, 2dp). */
  assessableValue: number;
  bcd: number;
  aidc: number;
  healthCess: number;
  sws: number;
  igst: number;
  compCess: number;
  /** Sum of all duties for the item (2dp). */
  totalDuty: number;
  /** Effective BCD rate after exemption, for display. */
  effectiveBcdRate: number;
}

export interface JobDutyResult {
  /** Total assessable value in INR (2dp) — the "BE Gross Total" AV. */
  totalAssessableValue: number;
  items: ItemDutyResult[];
  totals: {
    bcd: number;
    aidc: number;
    healthCess: number;
    sws: number;
    igst: number;
    compCess: number;
  };
  /** IGST assessable value (AV + BCD + AIDC + health cess + SWS), rounded to the rupee. */
  igstAssessableValue: number;
  /** Total duty payable, rounded to the nearest rupee. */
  dutyPayable: number;
  /** e.g. "Rs. Four Lakh Nineteen Thousand Six Hundred Thirty Eight Only" */
  dutyPayableInWords: string;
}
