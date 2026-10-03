import { describe, expect, it } from 'vitest';
import { mergeToDraft } from '../src/merge.js';
import type { CoaExtract, ExtractedDoc, InvoiceExtract, InvoiceItem } from '../src/schemas.js';

/**
 * The batch details a line carries, and where each date comes from.
 *
 * SW_PRODUCTION needs a manufacture, an expiry **and** a best-before date on
 * every row — Logi-Sys' rule, stricter than ICES, which marks best-before
 * optional. `bestBeforeDate` had a place on `DraftBatch` and on the sheet but
 * no field on either extraction schema, so nothing could ever fill it and every
 * batch on a regulated line was dropped for want of it. These pin the path.
 *
 * An expiry is a safety date and a best-before a quality one. They are never
 * copies of each other; a pack that prints only one must yield only one.
 */

function item(over: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    description: 'ORANGE JUICE CONCENTRATE',
    hsCode: '22029990',
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

    ...over,
  } as InvoiceItem;
}

function invoice(items: InvoiceItem[]): ExtractedDoc {
  const one = {
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-06-01',
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
    items,
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

function coa(products: CoaExtract['products']): ExtractedDoc {
  const data = {
    certificateDate: '2026-05-20',
    issuerName: 'ACME QC',
    referencePo: null,
    products,
  } as unknown as CoaExtract;
  return { fileName: 'COA.pdf', docType: 'certificate_of_analysis', data, model: 'test' };
}

const batchesOf = (docs: ExtractedDoc[]) => mergeToDraft(docs).items[0]?.batches ?? [];

describe('best-before on the invoice line', () => {
  it('reaches the batch', () => {
    const batches = batchesOf([
      invoice([
        item({
          batchNo: 'BF1126125E',
          manufactureDate: '2026-01-10',
          expiryDate: '2028-01-09',
          bestBeforeDate: '2027-07-09',
        }),
      ]),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.bestBeforeDate).toBe('2027-07-09');
    expect(batches[0]!.expiryDate).toBe('2028-01-09');
  });

  it('is left unset when the invoice prints only an expiry', () => {
    const batches = batchesOf([
      invoice([item({ batchNo: 'B-1', manufactureDate: '2026-01-10', expiryDate: '2028-01-09' })]),
    ]);
    expect(batches[0]!.expiryDate).toBe('2028-01-09');
    expect(batches[0]!.bestBeforeDate).toBeUndefined();
  });

  it('makes a batch on its own, with no batch number or other date', () => {
    // The one date a pack prints is still a fact about the consignment.
    const batches = batchesOf([invoice([item({ bestBeforeDate: '2027-07-09' })])]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.bestBeforeDate).toBe('2027-07-09');
  });
});

describe('best-before on the certificate of analysis', () => {
  const lot = (over: Partial<CoaExtract['products'][number]>) => ({
    productCode: null,
    description: 'ORANGE JUICE CONCENTRATE',
    batchNo: null,
    manufactureDate: null,
    expiryDate: null,
    bestBeforeDate: null,
    ...over,
  });

  it('fills the date the invoice line leaves blank', () => {
    const batches = batchesOf([
      invoice([item({ batchNo: 'B-1', manufactureDate: '2026-01-10', expiryDate: '2028-01-09' })]),
      coa([lot({ batchNo: 'B-1', bestBeforeDate: '2027-07-09' })]),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.bestBeforeDate).toBe('2027-07-09');
  });

  it('carries one per lot when the certificate breaks the line into several', () => {
    const batches = batchesOf([
      invoice([item()]),
      coa([
        lot({ batchNo: 'L-1', manufactureDate: '2026-01-10', expiryDate: '2028-01-09', bestBeforeDate: '2027-07-09' }),
        lot({ batchNo: 'L-2', manufactureDate: '2026-02-11', expiryDate: '2028-02-10', bestBeforeDate: '2027-08-10' }),
      ]),
    ]);
    expect(batches.map((b) => b.batchNo)).toEqual(['L-1', 'L-2']);
    expect(batches.map((b) => b.bestBeforeDate)).toEqual(['2027-07-09', '2027-08-10']);
  });
});
