import type { InvoiceInput, JobDutyResult, TermsOfInvoice } from '@checklist/core';
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

export interface DraftItem {
  slNo: number;
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
  /** Single Window production details (food/pharma) */
  batch?: { batchNo?: string; manufactureDate?: string; expiryDate?: string; quantity?: number };
  /** (expiry − today) / (expiry − manufacture), % — PGA shelf-life requirement */
  residualShelfLifePercent?: number;
}

/** SINGLE WINDOW - Additional Product Information rows. */
export interface SingleWindowInfoRow {
  itemSlNo: number;
  infoType: string;
  qualifier: string;
  code?: string;
  /** Free-text payload — a CAS number, an IUPAC name, a brand declaration. */
  information?: string;
  measurement?: number;
  unit?: string;
}

export interface ChecklistDraft {
  tenantId: string;
  transportMode: 'Air' | 'Sea';
  beType: 'Home Consumption';
  customStation: { code: string; name: string };
  filingStatus: 'Normal' | 'Prior' | 'Advance';

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
    igmNo?: string;
    igmDate?: string;
    inwardDate?: string;
    eta?: string;
    vesselOrFlight?: string;
    /** Voyage number on its own, so it need not be parsed back out of vesselOrFlight. */
    voyageNo?: string;
    shippingLineOrCarrier?: string;
    portOfLoading?: string;
    consCountry?: string;
    countryOfOrigin?: string;
    packageCount?: number;
    packageUnit?: string;
    grossWeightKg?: number;
    netWeightKg?: number;
    marksAndNos?: string;
    containers: {
      number: string;
      sizeType?: string;
      sealNo?: string;
      /** Packages stuffed in this container, when the packing list breaks it down. */
      packagesStuffed?: number;
      grossWeightKg?: number;
    }[];
  };

  invoiceMeta: {
    termsOfPayment?: string;
    paymentMethod: string;
    natureOfTransaction: string;
    relatedParty: boolean;
    exchangeRate: { currency: string; rate: number };
  };

  /** Valuation input for the duty engine (goods items only; charges folded in). */
  invoice: Omit<InvoiceInput, 'items'>;
  items: DraftItem[];

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

  supportingDocs: { fileName: string; docType: DocType }[];
  declarations: { code: string; text: string }[];

  duty: JobDutyResult | null;

  fieldMeta: Record<string, FieldMeta>;
  flags: DraftFlag[];
}

/** Convert draft items + invoice meta back into the duty-engine input. */
export function toInvoiceInput(draft: ChecklistDraft): InvoiceInput {
  return {
    ...draft.invoice,
    items: draft.items.map((it) => ({
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
    })),
  };
}

export type { TermsOfInvoice };
