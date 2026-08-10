import { TOI_CODE, iso2 } from '@checklist/core';
import { BLANK, code, isoDate, money, num, text, yn } from '../cell.js';
import type { Cell } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * INVOICES — one row per invoice. The draft models exactly one.
 *
 * The sheet has 97 columns; about two dozen carry data and the rest are for
 * situations this filing is not in (SVB loading, AEO, third-party sellers, the
 * fourteen `A -` … `N -` valuation additions). Blank is the correct value for
 * those, not zero.
 */
export function invoicesRows(ctx: MapContext): SheetRow[] {
  const { invoice, invoiceMeta, supplier, customStation } = ctx.draft;

  const supplierCountry = iso2(supplier.country);
  if (supplier.country && !supplierCountry) {
    ctx.warn('INVOICES.Supplier_Country_Code', `Supplier country "${supplier.country}" has no ISO country code.`);
  }
  if (!supplier.city) {
    ctx.warn('INVOICES.Supplier_City', 'Supplier city was not extracted from the invoice.');
  }

  // Insurance is either a stated amount or a notional percentage of value.
  // The template has both, and they are mutually exclusive.
  let insurancePercent: Cell = BLANK;
  let insuranceAmount: Cell = BLANK;
  let insuranceCurrency: Cell = BLANK;
  if (invoice.insurance?.kind === 'percent') {
    insurancePercent = num(invoice.insurance.percent);
  } else if (invoice.insurance?.kind === 'amount') {
    insuranceAmount = money(invoice.insurance.value.amount);
    insuranceCurrency = code(invoice.insurance.value.currency);
  }

  return [
    {
      InvSrNo: num(1),
      Invoice_No: text(invoice.invoiceNumber),
      Invoice_Date: isoDate(invoice.invoiceDate),
      // C&F and CFR are the same Incoterm; CIF is not. Keying this by hand
      // turned a cost-and-freight invoice into cost-insurance-freight, which
      // would have changed the assessable value.
      TOI: code(TOI_CODE[invoice.termsOfInvoice]),
      TOI_Place: BLANK,
      Inv_Currency: code(invoice.currency),
      Product_Value: money(invoice.invoiceValue),
      Is_Single_Frt_Ins_Other_Chrg: yn(false),

      'Frt_%': BLANK,
      Frt_Amount: money(invoice.freight?.amount),
      Frt_Currency: code(invoice.freight?.currency),

      'Ins_%': insurancePercent,
      Ins_Amount: insuranceAmount,
      Ins_Currency: insuranceCurrency,

      'Misc_Charge_%': BLANK,
      Misc_Charge_Amount: money(invoice.miscCharges?.amount),
      Misc_Charge_Currency: code(invoice.miscCharges?.currency),

      'Discount_%': BLANK,
      Discount_Amount: money(invoice.discount?.amount),
      Discount_Currency: code(invoice.discount?.currency),

      'Loading_%': BLANK,
      Loading_Amount: money(invoice.loadingCharges?.amount),
      Loading_Currency: code(invoice.loadingCharges?.currency),

      Supplier_Name: text(supplier.name),
      Supplier_Address: text(supplier.addressLines.join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '')),
      Supplier_City: text(supplier.city),
      Supplier_Country_Code: code(supplierCountry),
      Is_Related: yn(invoiceMeta.relatedParty),

      Custom_House_Code: code(customStation.code),
      Terms_of_Payment: text(invoiceMeta.termsOfPayment),
      // CONFIRM: both of these may want a code rather than the printed label.
      Nature_of_Trans: text(invoiceMeta.natureOfTransaction),
      Valuation_Method: text(invoiceMeta.paymentMethod),
    },
  ];
}
