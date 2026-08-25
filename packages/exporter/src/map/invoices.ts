import { TOI_CODE, branchNameForExport, iso2 } from '@checklist/core';
import { BLANK, code, int, isoDate, money, orElse, percent, text, yn } from '../cell.js';
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

  // Logi-Sys resolves the supplier from its own repository on name and branch,
  // exactly as it does the importer. An unbound supplier is the name printed
  // on the invoice, which is routinely an abbreviation of the one Logi-Sys
  // holds — "ASIA SHIGEN INTERNATIONAL" against
  // "ASIA SHIGEN INTERNATIONAL CO., LTD".
  if (!supplier.organizationId) {
    ctx.warn(
      'INVOICES.Supplier_Name',
      `Supplier "${supplier.name}" is not bound to a row in the organization repository, so this is the ` +
        'name off the invoice rather than the one Logi-Sys holds. Pick the right organization on the job, ' +
        'or add the party in Logi-Sys and re-upload the repository.',
    );
  }
  const supplierBranch = branchNameForExport(supplier.branchName);

  // C&F and CFR are the same Incoterm; CIF is not. Keying this by hand turned a
  // cost-and-freight invoice into cost-insurance-freight, which would have
  // changed the assessable value.
  const toi = TOI_CODE[invoice.termsOfInvoice];
  if (!toi) {
    ctx.blocker(
      'INVOICES.TOI',
      `Terms of invoice "${invoice.termsOfInvoice}" has no Logi-Sys equivalent — the import file ` +
        'accepts only FOB, CIF, C&F and C&I. Terms of invoice decides which charges are already ' +
        'in the invoice value, so it cannot be rounded to the nearest one.',
    );
  }

  // Insurance is either a stated amount or a notional percentage of value.
  // The template has both, and they are mutually exclusive.
  let insurancePercent: Cell = BLANK;
  let insuranceAmount: Cell = BLANK;
  let insuranceCurrency: Cell = BLANK;
  if (invoice.insurance?.kind === 'percent') {
    insurancePercent = percent(invoice.insurance.percent);
  } else if (invoice.insurance?.kind === 'amount') {
    insuranceAmount = money(invoice.insurance.value.amount);
    insuranceCurrency = code(invoice.insurance.value.currency);
  }

  // Logi-Sys writes the whole charge block as explicit zeros on its own export
  // — every percentage at 0.0000, every amount at 0.00 — and names a currency
  // even on the rows that are zero. Charges denominated abroad follow the
  // invoice; agency and loading are Indian services and are quoted in rupees.
  const invoiceCurrency = code(invoice.currency);
  const chargeZero = (
    amount: Cell,
    percentage: Cell,
    currency: Cell,
    zeroCurrency: Cell,
  ) => ({
    percentage: orElse(percentage, percent(0)),
    amount: orElse(amount, money(0)),
    currency: orElse(currency, zeroCurrency),
  });

  const frt = chargeZero(money(invoice.freight?.amount), BLANK, code(invoice.freight?.currency), invoiceCurrency);
  const ins = chargeZero(insuranceAmount, insurancePercent, insuranceCurrency, invoiceCurrency);
  const misc = chargeZero(money(invoice.miscCharges?.amount), BLANK, code(invoice.miscCharges?.currency), invoiceCurrency);
  const disc = chargeZero(money(invoice.discount?.amount), BLANK, code(invoice.discount?.currency), invoiceCurrency);
  const load = chargeZero(money(invoice.loadingCharges?.amount), BLANK, code(invoice.loadingCharges?.currency), code('INR'));

  return [
    {
      InvSrNo: int(1),
      Invoice_No: text(invoice.invoiceNumber),
      Invoice_Date: isoDate(invoice.invoiceDate),
      TOI: code(toi),
      TOI_Place: BLANK,
      Inv_Currency: code(invoice.currency),
      Product_Value: money(invoice.invoiceValue),
      Is_Single_Frt_Ins_Other_Chrg: yn(false),

      'Frt_%': frt.percentage,
      Frt_Amount: frt.amount,
      Frt_Currency: frt.currency,

      'Ins_%': ins.percentage,
      Ins_Amount: ins.amount,
      Ins_Currency: ins.currency,

      'Misc_Charge_%': misc.percentage,
      Misc_Charge_Amount: misc.amount,
      Misc_Charge_Currency: misc.currency,

      'Agency_%': percent(0),
      Agency_Amount: money(0),
      Agency_Currency: code('INR'),

      'Discount_%': disc.percentage,
      Discount_Amount: disc.amount,
      Discount_Currency: disc.currency,

      'Loading_%': load.percentage,
      Loading_Amount: load.amount,
      Loading_Currency: load.currency,

      'HSS_%': percent(0),
      HSS_Amount: money(0),

      Supplier_Name: text(supplier.name),
      Supplier_Address: text(supplier.addressLines.join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '')),
      Supplier_City: text(supplier.city),
      Supplier_Country_Code: code(supplierCountry),
      // A supplier with several branches in the repository is a different
      // party per branch, so leaving this empty can bind the wrong one.
      Supplier_Branch: text(supplierBranch),
      Is_Related: yn(invoiceMeta.relatedParty),

      Custom_House_Code: code(customStation.code),
      Terms_of_Payment: text(invoiceMeta.termsOfPayment),
      // CONFIRM: both of these may want a code rather than the printed label.
      Nature_of_Trans: text(invoiceMeta.natureOfTransaction),
      Valuation_Method: text(invoiceMeta.paymentMethod),
    },
  ];
}
