import {
  DEFAULT_VALUATION_METHOD,
  RD_BASIS_ASSESSABLE,
  TERMS_OF_PAYMENT,
  TOI_CODE,
  branchNameForExport,
  iso2,
  termsOfPayment,
  valuationMethod,
} from '@checklist/core';
import type { DraftInvoice } from '@checklist/extraction';
import { BLANK, code, int, isoDate, money, percent, rate5, text, yn } from '../cell.js';
import type { Cell } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * Which charges the price already contains, by terms of invoice.
 *
 * This is the gate for the whole charge block, and it is not a convention: the
 * four codes ICES accepts (BE Message format 2.25, "Terms of invoice — CIF CF
 * CI FOB") each say which of the two additions is already inside the invoice
 * value. Declaring freight on a CIF invoice charges it twice.
 */
const TOI_INCLUDES: Record<string, { freight: boolean; insurance: boolean }> = {
  CIF: { freight: true, insurance: true },
  'C&F': { freight: true, insurance: false },
  'C&I': { freight: false, insurance: true },
  FOB: { freight: false, insurance: false },
};

/**
 * The minimum high-seas-sale loading, in per cent of the import CIF value.
 *
 * CBEC's 2004 practice, and the customer's rule on `INVOICES!AB10`: where the
 * HSS price exceeds the import price by less than this, the BE declares the
 * 2% rate; where it exceeds it by more, the BE declares the actual difference.
 */
const HSS_MINIMUM_LOAD_PERCENT = 2;

/** A charge slot: a percentage, an amount and the currency they are in. */
interface Charge {
  percentage: Cell;
  amount: Cell;
  currency: Cell;
}

/**
 * A charge Logi-Sys writes as an explicit nil rather than an empty cell.
 *
 * Its own export writes `0.0000 / 0.00` for every charge it is not claiming and
 * still names a currency, so a blank here is a shape the vendor never produces.
 */
function nil(currency: Cell): Charge {
  return { percentage: percent(0), amount: money(0), currency };
}

/**
 * INVOICES — one row per invoice on the Bill of Entry.
 *
 * Dictated in `docs/boe-mapping/05-invoices.md`. Every column there declares a
 * source; the ones that are constants here name the vendor workbook that proves
 * them.
 */
export function invoicesRows(ctx: MapContext): SheetRow[] {
  const { invoices } = ctx.draft;

  if (!invoices.length) {
    ctx.blocker(
      'INVOICES',
      'No invoice on the job. A Bill of Entry declares goods against an invoice; there is nothing to declare.',
    );
    return [];
  }

  const supplierCells = supplierColumns(ctx);
  // `Is_Single_Frt_Ins_Other_Chrg` says the freight/insurance/other block is
  // one figure for the whole Bill of Entry rather than keyed per invoice —
  // which it can only be when there is one invoice. `Y` on the single-invoice
  // vendor workbooks (`liv_job1`, `final (1).xlsx`); the customer's rule on
  // `INVOICES!H6` is "if multiple then N, else Y".
  const singleCharge = invoices.length === 1;

  return invoices.map((invoice) => ({
    ...supplierCells,
    ...invoiceRow(ctx, invoice, singleCharge),
  }));
}

function invoiceRow(ctx: MapContext, invoice: DraftInvoice, singleCharge: boolean): SheetRow {
  const at = (column: string) => `INVOICES[${invoice.srNo}].${column}`;
  const invoiceCurrency = code(invoice.currency);

  // C&F and CFR are the same Incoterm; CIF is not. Keying this by hand turned a
  // cost-and-freight invoice into cost-insurance-freight, which would have
  // changed the assessable value.
  const toi = TOI_CODE[invoice.termsOfInvoice];
  if (!toi) {
    ctx.blocker(
      at('TOI'),
      `Terms of invoice "${invoice.termsOfInvoice}" has no Logi-Sys equivalent — the import file ` +
        'accepts only FOB, CIF, C&F and C&I. Terms of invoice decides which charges are already ' +
        'in the invoice value, so it cannot be rounded to the nearest one.',
    );
  }
  const included = TOI_INCLUDES[toi ?? 'CIF'] ?? TOI_INCLUDES.CIF!;

  // ---- Freight (I/J/K) ----------------------------------------------------
  // Active only when the price does not already contain it. Either a rate or an
  // amount, never both — the customer's "either of this two" on `INVOICES!I6` —
  // and both come off the freight certificate, not off a notional percentage.
  let freight = nil(invoiceCurrency);
  if (!included.freight) {
    if (invoice.freight && invoice.freight.amount > 0) {
      freight = {
        percentage: percent(0),
        amount: money(invoice.freight.amount),
        currency: code(invoice.freight.currency),
      };
    } else {
      ctx.warn(
        at('Frt_Amount'),
        `Invoice ${invoice.invoiceNumber} is ${toi}, so freight is not in the price and has to be ` +
          'declared — no freight certificate on the job states it. Add the certificate, or key the ' +
          'freight in Logi-Sys. It is not filled with a notional percentage here: the 20% of ' +
          'Rule 10(2) is a valuation fallback for the officer, not a figure to declare as actual.',
      );
    }
  }

  // ---- Insurance (L/M/N) --------------------------------------------------
  // An actual amount off the certificate, else the importer's marine open
  // policy as a rate. The rate is applied by Logi-Sys, which computes the rupee
  // figure itself — `ex_job6` files `Ins_% 1.1250` and the checklist prints
  // "204144.55 INR (1.125%)". An actual is usually in rupees, because the
  // policy is Indian (`INVOICES!N10`); the rate case leaves the currency at the
  // invoice's, which is what the vendor workbooks write beside a zero.
  let insurance = nil(invoiceCurrency);
  if (!included.insurance) {
    if (invoice.insurance?.kind === 'percent') {
      insurance = { percentage: percent(invoice.insurance.percent), amount: money(0), currency: invoiceCurrency };
    } else if (invoice.insurance?.kind === 'amount') {
      insurance = {
        percentage: percent(0),
        amount: money(invoice.insurance.value.amount),
        currency: code(invoice.insurance.value.currency),
      };
    } else {
      ctx.warn(
        at('Ins_Amount'),
        `Invoice ${invoice.invoiceNumber} is ${toi}, so insurance is not in the price and has to be ` +
          'declared — no insurance certificate on the job and no marine open-policy rate on the ' +
          "importer's organization. Set the rate in Settings → Organizations, or key the premium.",
      );
    }
  }

  // ---- Miscellaneous (O/P/Q) ---------------------------------------------
  // The rate is always nil and the amount is the actual (`INVOICES!O10`). What
  // lands here is every charge on the invoice that is not for goods — packing,
  // dismantling, handling, a freight line billed on a C&F invoice — and the
  // ex-works leg a freight certificate states separately. `ex_job1` files
  // `Misc. Charges 590.75 USD` off a FREIGHT-CHARGE line, out of a
  // `Product_Value` of 15283.84 rather than the 15874.59 the invoice totals.
  //
  // This is also the column that keeps the workbook honest: `computeValuation`
  // in the duty engine adds these charges to the assessable value, so writing
  // nil here declares one value to Customs and computes duty on another.
  const misc: Charge =
    invoice.miscCharges && invoice.miscCharges.amount > 0
      ? {
          percentage: percent(0),
          amount: money(invoice.miscCharges.amount),
          currency: code(invoice.miscCharges.currency),
        }
      : { percentage: percent(0), amount: money(0), currency: BLANK };
  if (
    invoice.miscCharges &&
    invoice.miscCharges.amount > 0 &&
    invoice.miscCharges.currency !== invoice.currency
  ) {
    ctx.warn(
      at('Misc_Charge_Currency'),
      `Invoice ${invoice.invoiceNumber}: miscellaneous charges are in ${invoice.miscCharges.currency} ` +
        `and the invoice is in ${invoice.currency}. ICES takes this column in the invoice currency ` +
        '(BE Message format 2.25, MISC_CH) — convert at the customs rate for the BE date before filing.',
    );
  }

  // ---- Discount (U/V/W) ---------------------------------------------------
  const discount: Charge = invoice.discount
    ? {
        percentage: percent(0),
        amount: money(invoice.discount.amount),
        currency: code(invoice.discount.currency),
      }
    : nil(invoiceCurrency);

  // ---- High seas sale (AA/AB) --------------------------------------------
  const hss = hssColumns(ctx, invoice);

  // ---- Related party, revenue deposit and SVB (AC–AT) ---------------------
  // `RD_%` is a revenue deposit on a related-party import and is enabled only
  // when the parties are related (`INVOICES!AC11`); it arrives by customer
  // instruction, never off a document.
  const related = invoice.relatedParty;
  const svb = ctx.draft.supplierRelationship;
  if (related && !svb?.svbRefNo) {
    ctx.warn(
      at('SVB_Ref_No'),
      `Invoice ${invoice.invoiceNumber} declares the buyer and seller related, and no SVB reference ` +
        'is recorded for this importer–supplier pair. A related-party import is normally registered ' +
        'with the Special Valuation Branch; add the order in Settings → Organizations if there is one.',
    );
  }

  // ---- Terms of payment (AY/AZ) ------------------------------------------
  const terms = termsOfPayment(invoice.termsOfPayment);
  if (invoice.termsOfPayment && terms.code === TERMS_OF_PAYMENT.OTHERS) {
    ctx.warn(
      at('Terms_of_Payment'),
      `Invoice ${invoice.invoiceNumber} states payment terms "${invoice.termsOfPayment}", which is ` +
        'none of the six Logi-Sys codes (LC / FOC / DP / DA / SD / OTHERS). Filed as OTHERS.',
    );
  }
  // The LC number only means something beside an LC. Filing one against D/A
  // terms is a statement that the goods were paid for a way they were not.
  const lc = terms.code === TERMS_OF_PAYMENT.LC ? invoice.lcNumber : undefined;
  if (terms.code === TERMS_OF_PAYMENT.LC && !invoice.lcNumber) {
    ctx.warn(
      at('LC_No'),
      `Invoice ${invoice.invoiceNumber} is on a letter of credit but quotes no LC number.`,
    );
  }

  // ---- Valuation method (BD) ---------------------------------------------
  const method = valuationMethod(invoice.paymentMethod) ?? DEFAULT_VALUATION_METHOD;
  if (invoice.paymentMethod && !valuationMethod(invoice.paymentMethod)) {
    ctx.warn(
      at('Valuation_Method'),
      `Valuation method "${invoice.paymentMethod}" is not one of the Customs Valuation Rules ` +
        `Logi-Sys lists, so the export declares ${DEFAULT_VALUATION_METHOD}. Check it against the ` +
        'invoice if the parties are related or the price is provisional.',
    );
  }

  // The date is on every invoice ever filed, so an empty one means it was not
  // read rather than that it does not exist — and ICES will not take the BE
  // without it. Named, so the operator fills it rather than discovering it at
  // the gateway.
  if (!invoice.invoiceDate) {
    ctx.warn(at('Invoice_Date'), `No date read off invoice ${invoice.invoiceNumber} — Logi-Sys needs it to file.`);
  }

  return {
    InvSrNo: int(invoice.srNo),
    Invoice_No: text(invoice.invoiceNumber),
    Invoice_Date: isoDate(invoice.invoiceDate),
    TOI: code(toi),
    // ICES field 76, "Terms Place" — the place named after the Incoterm. Every
    // vendor workbook leaves it empty even where the invoice states one, so it
    // is written only when we read one and never warned about.
    TOI_Place: text(invoice.termsPlace),
    Inv_Currency: invoiceCurrency,
    Product_Value: money(invoice.invoiceValue),
    Is_Single_Frt_Ins_Other_Chrg: yn(singleCharge),

    'Frt_%': freight.percentage,
    Frt_Amount: freight.amount,
    Frt_Currency: freight.currency,

    'Ins_%': insurance.percentage,
    Ins_Amount: insurance.amount,
    Ins_Currency: insurance.currency,

    'Misc_Charge_%': misc.percentage,
    Misc_Charge_Amount: misc.amount,
    Misc_Charge_Currency: misc.currency,

    // Buying agency commission (Rule 10(1)(a)(i)) and value loading. Nil on all
    // five vendor workbooks and all seven checklists; an Indian service, so the
    // currency Logi-Sys names beside the zero is rupees.
    'Agency_%': percent(0),
    Agency_Amount: money(0),
    Agency_Currency: code('INR'),

    'Discount_%': discount.percentage,
    Discount_Amount: discount.amount,
    Discount_Currency: discount.currency,

    'Loading_%': percent(0),
    Loading_Amount: money(0),
    Loading_Currency: code('INR'),

    'HSS_%': hss.percentage,
    HSS_Amount: hss.amount,

    // Revenue deposit, on the assessable value. Two decimals here, not the four
    // the charge block uses — the accepted workbook writes `0.00`.
    'RD_%': money(related ? svb?.revenueDepositPercent ?? 0 : 0),
    RD_Basis: code(RD_BASIS_ASSESSABLE),

    Is_Related: yn(related),
    // The literal word, in capitals, and blank when the parties are not
    // related — `INVOICES!AJ10`. `Base` and `Condition` qualify the
    // relationship and mean nothing without one.
    Relation: related ? code('YES') : BLANK,
    Base: related ? text(svb?.base) : BLANK,
    Condition: related ? text(svb?.condition) : BLANK,

    SVB_Ref_No: text(svb?.svbRefNo),
    SVB_Date: isoDate(svb?.svbDate),
    // Custom_House_Code is the custom house that imposed the SVB load, not the
    // station this BE is filed at — that is GENERAL.CustomsHouseCode. Logi-Sys'
    // own export leaves it empty; filling it is a repeat mistake.
    Custom_House_Code: text(svb?.svbCustomHouse),
    SVB_Loading_Basis: code(svb?.loadingBasis),
    SVB_Rate_Assessable: svb?.rateAssessable != null ? rate5(svb.rateAssessable) : BLANK,
    SVB_Status_Assessable: code(svb?.statusAssessable),
    SVB_Rate_Duty: svb?.rateDuty != null ? rate5(svb.rateDuty) : BLANK,
    SVB_Status_Duty: code(svb?.statusDuty),

    // "If given" — the invoice usually quotes the buyer's order and sometimes a
    // sale contract. Blank without a warning when it quotes neither.
    PO_No: text(invoice.purchaseOrderNumber),
    PO_Date: isoDate(invoice.purchaseOrderDate),
    'Contract.No': text(invoice.contractNumber),
    Contract_Date: isoDate(invoice.contractDate),

    Terms_of_Payment: code(terms.code),
    Other_Terms_of_Payment_Remark: code(terms.remark),
    LC_No: text(lc),
    LC_Date: terms.code === TERMS_OF_PAYMENT.LC ? isoDate(invoice.lcDate) : BLANK,

    Nature_of_Trans: text(invoice.natureOfTransaction),
    Valuation_Method: code(method),
  };
}

/**
 * The high-seas-sale loading.
 *
 * Only on a job the operator has marked as a high seas sale. The rule
 * (`INVOICES!AB10`): the HSS price must exceed the import price by at least 2%,
 * so a smaller difference is declared as the 2% *rate* and a larger one as the
 * actual *amount*.
 */
function hssColumns(ctx: MapContext, invoice: DraftInvoice): { percentage: Cell; amount: Cell } {
  const nilPair = { percentage: percent(0), amount: money(0) };
  if (!ctx.draft.boe?.flags?.hss) return nilPair;

  const hssValue = invoice.hssValue;
  if (hssValue == null) {
    ctx.warn(
      `INVOICES[${invoice.srNo}].HSS_Amount`,
      `The job is flagged as a high seas sale but no high-seas-sale price is recorded for invoice ` +
        `${invoice.invoiceNumber}. The BE must load the import value by at least ` +
        `${HSS_MINIMUM_LOAD_PERCENT}% — key the HSS invoice value on the job.`,
    );
    return nilPair;
  }

  const difference = hssValue - invoice.invoiceValue;
  if (difference < 0) {
    ctx.blocker(
      `INVOICES[${invoice.srNo}].HSS_Amount`,
      `The high-seas-sale price (${hssValue}) for invoice ${invoice.invoiceNumber} is below the ` +
        `import price (${invoice.invoiceValue}). A high seas sale cannot be at a loss on the BE; ` +
        'one of the two figures is wrong.',
    );
    return nilPair;
  }
  const minimum = (invoice.invoiceValue * HSS_MINIMUM_LOAD_PERCENT) / 100;
  return difference > minimum
    ? { percentage: percent(0), amount: money(difference) }
    : { percentage: percent(HSS_MINIMUM_LOAD_PERCENT), amount: money(0) };
}

/**
 * The supplier columns, which are the same on every row.
 *
 * One BE has one supplier on our jobs — every golden is a single overseas
 * seller invoicing several times. A second seller would be a second party to
 * bind, so it warns rather than putting the first one's name on their invoice.
 */
function supplierColumns(ctx: MapContext): SheetRow {
  const { supplier } = ctx.draft;

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

  return {
    Supplier_Name: text(supplier.name),
    Supplier_Address: text(supplier.addressLines.join(', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '')),
    Supplier_City: text(supplier.city),
    Supplier_Country_Code: code(supplierCountry),
    // A supplier with several branches in the repository is a different party
    // per branch, so leaving this empty can bind the wrong one.
    Supplier_Branch: text(branchNameForExport(supplier.branchName)),
  };
}
