import {
  DEFAULT_VALUATION_METHOD,
  RD_BASIS_ASSESSABLE,
  TOI_CODE,
  branchNameForExport,
  iso2,
  termsOfPayment,
  valuationMethod,
} from '@checklist/core';
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
  const { invoice, invoiceMeta, supplier } = ctx.draft;

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
  // Miscellaneous charges are always declared as nil. Logi-Sys' own export
  // writes 0.0000 / 0.00 and leaves the currency empty even on jobs whose
  // invoice carries other charges, so anything we extracted into
  // `invoice.miscCharges` is deliberately not written here — a value in this
  // block changes the assessable value.
  const misc = { percentage: percent(0), amount: money(0), currency: BLANK };
  const disc = chargeZero(money(invoice.discount?.amount), BLANK, code(invoice.discount?.currency), invoiceCurrency);
  const load = chargeZero(money(invoice.loadingCharges?.amount), BLANK, code(invoice.loadingCharges?.currency), code('INR'));

  // A dropdown column and a free-text one. The invoice's own wording goes in
  // the remark; the coded column gets a value Logi-Sys will accept.
  const terms = termsOfPayment(invoiceMeta.termsOfPayment);

  const method = valuationMethod(invoiceMeta.paymentMethod) ?? DEFAULT_VALUATION_METHOD;
  if (invoiceMeta.paymentMethod && !valuationMethod(invoiceMeta.paymentMethod)) {
    ctx.warn(
      'INVOICES.Valuation_Method',
      `Valuation method "${invoiceMeta.paymentMethod}" is not one of the Customs Valuation Rules ` +
        `Logi-Sys lists, so the export declares ${DEFAULT_VALUATION_METHOD}. Check it against the ` +
        'invoice if the parties are related or the price is provisional.',
    );
  }

  return [
    {
      InvSrNo: int(1),
      Invoice_No: text(invoice.invoiceNumber),
      Invoice_Date: isoDate(invoice.invoiceDate),
      TOI: code(toi),
      TOI_Place: BLANK,
      Inv_Currency: code(invoice.currency),
      Product_Value: money(invoice.invoiceValue),
      // Invoice → Other Charges, "Single Freight, Insurance & other charges for
      // all Invoices". It says the charge block above applies across the whole
      // Bill of Entry rather than being keyed per invoice — which is what the
      // draft models, since it carries exactly one invoice and one set of
      // charges. Logi-Sys ships the box ticked and the accepted workbook says Y;
      // this was hardcoded N.
      Is_Single_Frt_Ins_Other_Chrg: yn(true),

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

      // Revenue deposit. Nothing we read ever asks for one, but Logi-Sys writes
      // the pair rather than leaving it empty, and so does its own export.
      // Two decimals here, not the four the charge block above uses — the
      // accepted workbook writes `0.00`.
      'RD_%': money(0),
      RD_Basis: code(RD_BASIS_ASSESSABLE),

      Supplier_Name: text(supplier.name),
      Supplier_Address: text(supplier.addressLines.join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '')),
      Supplier_City: text(supplier.city),
      Supplier_Country_Code: code(supplierCountry),
      // A supplier with several branches in the repository is a different
      // party per branch, so leaving this empty can bind the wrong one.
      Supplier_Branch: text(supplierBranch),
      Is_Related: yn(invoiceMeta.relatedParty),

      // Custom_House_Code is left blank on purpose. The station belongs on
      // GENERAL.CustomsHouseCode; Logi-Sys' own export leaves this INVOICES
      // column empty, and filling it is a repeat mistake.
      Terms_of_Payment: code(terms.code),
      Other_Terms_of_Payment_Remark: code(terms.remark),
      // CONFIRM: this one may want a code rather than the printed label. The
      // dropdown's words and the export's words agree for "Sale", which is
      // every job so far, so there is nothing yet to tell them apart.
      Nature_of_Trans: text(invoiceMeta.natureOfTransaction),
      Valuation_Method: code(method),
    },
  ];
}
