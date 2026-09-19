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
  /**
   * Whether the notification sets an effective *rate* or forgoes a duty that
   * stays chargeable — and it changes the IGST, because section 3(8) CTA puts
   * "any duty of customs chargeable on that article" in the IGST base.
   *
   *   - `effective` (the default) — an exemption under section 25 for the
   *     goods themselves: an FTA concession, 45/2025-Customs, DFTP. The
   *     concessional rate *is* the rate of duty, so the IGST base carries the
   *     reduced BCD. `ex_job6` files a Japan-CEPA line at BCD 0% and its IGST
   *     is exactly 18% of the assessable value — nothing notional added.
   *
   *   - `scheme` — an export-promotion scheme claimed in `ITEMS.Exim_Notn`:
   *     Advance Authorisation, EPCG, DFIA, TRQ. The relief is conditional on
   *     an export obligation and the duty is *foregone*, not reduced, so it
   *     stays in the IGST base at the tariff rate. This is what Logi-Sys
   *     prints as the `BCD Fg / CVD Fg / IGST Fg` triple, and it is what the
   *     licence is debited by.
   *
   * Two independent confirmations, both exact to the paisa:
   *   - `ex_job28` (DFIA, BCD wholly forgone): IGST 1,540,305.15 is 18% of
   *     AV 7,905,081.60 + tariff BCD 592,881.12 + SWS 59,288.11 — not of AV.
   *   - `ex_job27` (TRQ, BCD 7.5% → 3.75%): IGST 2,038,100.80 is 18% of
   *     AV 10,459,845.00 + the *full* 784,488.38 + SWS 78,448.84, although
   *     only 392,244.19 was paid.
   */
  kind?: 'effective' | 'scheme';
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
  /**
   * IGST exemption, when one is claimed.
   *
   * An export-promotion scheme is the common case: an Advance Authorisation
   * under 021/2023-Cus or an EPCG authorisation under 026/2023-Cus exempts IGST
   * along with BCD, while a DFIA under 025/2023-Cus does not. Without this the
   * engine charges IGST on every import and overstates the duty payable — and
   * the duty foregone that `LICENSE.DebitDeutyValue` debits against the licence
   * would be wrong with it.
   */
  igstExemption?: ExemptionClaim;
  /** Compensation-cess exemption, on the same footing as `igstExemption`. */
  compCessExemption?: ExemptionClaim;
  /** AIDC % (Agriculture Infrastructure & Development Cess), on assessable value. */
  aidcRate?: number;
  aidcNotification?: string;
  /** Health cess % on assessable value. */
  healthCessRate?: number;
  /** GST compensation cess % on the IGST base. */
  compCessRate?: number;
  compCessNotification?: string;
  /**
   * A tariff value fixed under section 14(2) of the Customs Act (36/2001-Customs
   * (N.T.) and its fortnightly substitutions). When present it *is* the value
   * for duty: the item's invoice price and its share of freight and insurance
   * are replaced by amount per unit × quantity in the notification's unit.
   */
  tariffValue?: { amountPerUnit: number; currency: string; quantity: number };
  /** Anti-dumping, safeguard and countervailing duties on this item. */
  tradeRemedies?: TradeRemedyInput[];
}

/**
 * One trade-remedy duty line. A notification states either a percentage, an
 * amount per unit, or both joined by a Plus/Minus/Higher/Lower flag.
 */
export interface TradeRemedyInput {
  kind: 'ADD' | 'SAFEGUARD' | 'CVD';
  /** Ad valorem rate, %. */
  ratePercent?: number;
  /** `AV` — % of assessable value (anti-dumping, safeguard); `LANDED` — % of AV + BCD (CVD). */
  basis?: 'AV' | 'LANDED';
  /** Specific duty per unit, in `currency`, on `quantity` units. */
  amountPerUnit?: number;
  currency?: string;
  quantity?: number;
  /** How the ad valorem and specific parts combine. Absent = Plus. */
  flag?: '+' | '-' | 'H' | 'L';
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
  antiDumping: number;
  safeguard: number;
  cvd: number;
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
    antiDumping: number;
    safeguard: number;
    cvd: number;
  };
  /** IGST assessable value (AV + BCD + AIDC + health cess + SWS + trade remedies), rounded to the rupee. */
  igstAssessableValue: number;
  /** Total duty payable, rounded to the nearest rupee. */
  dutyPayable: number;
  /** e.g. "Rs. Four Lakh Nineteen Thousand Six Hundred Thirty Eight Only" */
  dutyPayableInWords: string;
}
