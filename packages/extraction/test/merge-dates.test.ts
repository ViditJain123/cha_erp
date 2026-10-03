import { describe, expect, it } from 'vitest';
import { mergeToDraft } from '../src/merge.js';
import type { ExtractedDoc, InvoiceExtract, InvoiceItem } from '../src/schemas.js';

/**
 * The filing date decides which IGST notification a line carries.
 *
 * ex_job21 was filed on 2025-03-13 under 1/2017-IT(R) S.No. III61B, and the
 * merge — which only knew today — wrote 9/2025 S.No. II68 on it. Now a date
 * before 9/2025 took effect gets the predecessor's number, no serial, and an
 * error naming the work a person has to do.
 */
function line(): InvoiceItem {
  return {
    description: 'PP GRANULES (POLYPROPYLENE)',
    hsCode: '39021000',
    quantity: 100,
    unit: 'KGS',
    unitPrice: 2,
    amount: 200,
    isCharge: false,
    batchNo: null,
    manufactureDate: null,
    expiryDate: null,
    bestBeforeDate: null,
    countryOfOrigin: null,
    noCommercialValue: false,
  } as InvoiceItem;
}

function invoice(): ExtractedDoc {
  const one = {
    invoiceNumber: 'INV-1',
    invoiceDate: '2025-03-01',
    sellerName: 'ACME TRADING LLC',
    sellerAddressLines: ['PO BOX 1'],
    sellerCity: 'Muscat',
    sellerCountry: 'Oman',
    buyerName: 'IMPORTER PVT LTD',
    buyerAddressLines: ['Mumbai'],
    buyerGstin: null,
    buyerIec: null,
    currency: 'USD',
    deliveryTermsRaw: 'CIF NHAVA SHEVA',
    termsOfInvoice: 'CIF',
    paymentTerms: null,
    purchaseOrderNumber: null,
    items: [line()],
    freightCharge: null,
    insuranceCharge: null,
    totalAmount: 200,
    netWeightKg: null,
    grossWeightKg: null,
    countryOfOrigin: 'Oman',
    portOfLoading: null,
    portOfDischarge: null,
    uncertainFields: [],
  };
  const data = { invoices: [one] } as unknown as InvoiceExtract;
  return { fileName: 'INV.pdf', docType: 'invoice', data, model: 'test' };
}

describe('IGST notification by filing date', () => {
  it('files 1/2017-IT(R) with no serial before 9/2025 took effect, and flags it', () => {
    const draft = mergeToDraft([invoice()], { today: '2025-03-13' });
    const item = draft.items[0]!;
    expect(item.igstNotification).toBe('001/2017');
    expect(item.notificationSerials?.igst).toBeUndefined();
    expect(draft.flags.some((f) => f.severity === 'error' && f.path === 'items.0.igstRate' && /1\/2017-IT\(R\)/.test(f.message))).toBe(true);
  });

  it('files 9/2025 with its serial from the day it took effect', () => {
    const draft = mergeToDraft([invoice()], { today: '2025-09-22' });
    const item = draft.items[0]!;
    expect(item.igstNotification).toBe('009/2025');
    expect(item.notificationSerials?.igst).toBe('II114');
    expect(draft.flags.some((f) => f.path === 'items.0.igstRate' && f.severity === 'error')).toBe(false);
  });
});
