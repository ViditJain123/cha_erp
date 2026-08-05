import type { InvoiceInput, JobDutyResult, TermsOfInvoice } from '@checklist/core';
import type { DocType } from './schemas.js';

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
  originCountry?: string;
  manufacturerName?: string;
  manufacturerAddress?: string;
  endUseCode: string;
  /** Single Window production details (food/pharma) */
  batch?: { batchNo?: string; manufactureDate?: string; expiryDate?: string; quantity?: number };
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
    matchedFromMasters: boolean;
  };
  supplier: { name: string; addressLines: string[]; country?: string };

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
    shippingLineOrCarrier?: string;
    portOfLoading?: string;
    consCountry?: string;
    countryOfOrigin?: string;
    packageCount?: number;
    packageUnit?: string;
    grossWeightKg?: number;
    marksAndNos?: string;
    containers: { number: string; sizeType?: string; sealNo?: string }[];
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
  };

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
