import { iso2, pad8 } from '@checklist/core';
import { BLANK, code, decimal, int, isoDate, money, qty, rate5, text, weight, yn } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * Tolerance on the quantity × unit price = amount check.
 *
 * Loose enough for rounding at 6dp on a six-figure line, tight enough that a
 * unit-conversion slip (which is always a factor of 1000) cannot slip through.
 */
const AMOUNT_TOLERANCE = 0.005;

/** Pull a country out of the tail of a free-text address, when it names one. */
function countryFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const tokens = address.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  for (const token of tokens.reverse()) {
    const found = iso2(token);
    if (found) return found;
  }
  return undefined;
}

/**
 * Columns Logi-Sys writes as an explicit zero on every ITEMS row of its own
 * export, whether or not the duty instrument applies.
 *
 * They are taken verbatim from the I-10793 export, at its decimal places. Two
 * of that file's constants are deliberately absent: `ADD_Basis` ('AV') and
 * `CVD_CalculatedOn` ('1'), which are not zeros but assessment bases, and
 * nothing tells us they hold for a consignment that carries no anti-dumping or
 * countervailing duty.
 */
const ITEM_ZEROS = {
  Inbond_InvSrNo: int(0),
  Inbond_ItemSrNo: int(0),
  Accessories_Status: int(0),
  WH_SalePrice_INR: money(0),
  Tarrif_Value_Qty: weight(0),
  Tarrif_Value_Amount: money(0),
  ADD_Qty: qty(0),
  // A rate, not an amount — but the vendor writes it at 2dp all the same.
  'ADD_%Rate': decimal(0, 2),
  ADD_AmountPerUnit: rate5(0),
  'Other_Duty_%Rate': decimal(0, 3),
  Other_Duty_AmountPerUnit: decimal(0, 3),
  SVB_Rate_Assessable: rate5(0),
  SVB_Rate_Duty: rate5(0),
  Previous_BEUnitPrice: qty(0),
  GST_Comp_Cess_SalePrice_INR: qty(0),
  CVD_Rate: money(0),
} satisfies SheetRow;

/**
 * ITEMS — one row per line item.
 *
 * The widest sheet at 127 columns. Most describe duty instruments this filing
 * does not use (anti-dumping, safeguard, CVD, tariff values, re-import
 * references); those stay blank.
 */
export function itemsRows(ctx: MapContext): SheetRow[] {
  const { draft } = ctx;

  if (draft.items.length === 0) {
    ctx.blocker('ITEMS', 'The draft has no line items — there is nothing to declare.');
  }

  return draft.items.map((item, i) => {
    const cth = pad8(item.ritc);
    if (!cth) {
      ctx.blocker(
        `ITEMS[${i}].CTH`,
        `Item ${item.slNo} has no usable tariff code (got "${item.ritc}"). ` +
          'The CTH determines the duty rate, so it cannot be left for Logi-Sys to fill.',
      );
    }

    // Quantity and unit price must agree with the line amount. They come apart
    // when a unit is converted (156.450 MT at 1,207.57/MT is 156,450 KGS at
    // 1.20757/KG) and only one side is rescaled — which overstates the line by
    // a factor of 1000 and would be a misdeclaration.
    const computed = item.quantity * item.unitPrice;
    if (item.amount > 0 && Math.abs(computed - item.amount) > AMOUNT_TOLERANCE * item.amount) {
      ctx.blocker(
        `ITEMS[${i}]`,
        `Item ${item.slNo}: quantity × unit price (${item.quantity} × ${item.unitPrice} = ` +
          `${computed.toFixed(2)}) does not match the line amount ${item.amount}. ` +
          'This usually means a unit conversion rescaled the quantity but not the price.',
      );
    }

    const originCountry = iso2(item.originCountry ?? draft.shipment.countryOfOrigin);
    const manufacturerCountry =
      iso2(item.manufacturerCountry) ?? countryFromAddress(item.manufacturerAddress);

    const serials = item.notificationSerials ?? {};
    const fta = draft.ftaClaim;

    return {
      ...ITEM_ZEROS,

      InvSrNo: int(1),
      ItemSrNo: int(item.slNo),

      Product_Description: text(item.description),
      QTY: qty(item.quantity),
      Unit: code(item.unit),
      Unit_Price: qty(item.unitPrice),
      CTH: code(cth),
      RITC: code(cth),
      // The Central Excise Tariff Heading is the same 8-digit classification as
      // the CTH for an import, and Logi-Sys treats the column as mandatory.
      CETH: code(cth),
      PolicyPara: BLANK,
      PolicyYear: BLANK,

      General_Description: text(item.generalDescription),
      Brand: text(item.brand),
      Model: text(item.model),
      End_Use: code(item.endUseCode),
      Country_of_Origin: code(originCountry),
      Accessories_Details: BLANK,

      // Preferential when an FTA exemption is claimed on this line, standard
      // otherwise. CONFIRM the exact tokens.
      Standard_Preferential: code(item.bcdExemption ? 'P' : 'S'),
      Basic_Notn: code(item.bcdExemption?.notification ?? item.bcdNotification),
      Basic_NotnSrNo: code(item.bcdExemption?.serial ?? serials.basic),
      SWS_Notn: BLANK,
      SWS_NotnSrNo: code(serials.sws),

      IGST_LevyNotn: code(item.igstNotification),
      IGST_LevyNotnSrNo: code(serials.igst),
      IGST_CompCessNotn: code(item.compCessNotification),
      IGST_CompCessNotnSrNo: code(serials.compCess),

      AIDC_LevyNotn: code(item.aidcNotification),
      AIDC_LevyNotnSrNo: code(serials.aidc),

      MFG_Name: text(item.manufacturerName),
      MFG_Address: text(item.manufacturerAddress),
      MFG_Country: code(manufacturerCountry),
      MFG_State: BLANK,
      MFG_PIN: BLANK,
      Source_Country: BLANK,
      Transit_Country: BLANK,

      isFTAbenefitClaimed: yn(Boolean(fta)),
      COO_No: code(fta?.cooNumber),
      COO_Date_of_Issue: isoDate(fta?.cooDate),
      COO_Issuing_Country: code(iso2(fta?.countryOfIssue)),
      COO_Origin_Criteria: code(fta?.originCriterion),
      COO_Origin_Criteris_Remarks: BLANK,
      COO_Accumulation_Cumulation: BLANK,
      COO_Direct_Consignment: fta ? yn(fta.directConsignment) : BLANK,
      COO_Retroactive_Issuance: fta ? yn(fta.retroactiveIssuance ?? false) : BLANK,
      COO_TariffShift: BLANK,
      COO_ItemSrNoCert: BLANK,

      Foc_Item: yn(false),
    };
  });
}
