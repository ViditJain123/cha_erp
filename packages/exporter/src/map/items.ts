import {
  COMP_CESS_NOTIFICATION,
  IGST_RATE_NOTIFICATION,
  compCessForCth,
  igstRateForCth,
  iso2,
  pad8,
  tradeDescription,
} from '@checklist/core';
import { BLANK, code, decimal, int, isoDate, money, orElse, qty, rate5, text, weight, yn } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * Tolerance on the quantity × unit price = amount check.
 *
 * Loose enough for rounding at 6dp on a six-figure line, tight enough that a
 * unit-conversion slip (which is always a factor of 1000) cannot slip through.
 */
const AMOUNT_TOLERANCE = 0.005;

/** Logi-Sys' word for "this line carries no central excise". */
const NO_EXCISE = 'NOEXCISE';

/**
 * Brand and model on a bulk-chemical line.
 *
 * Both columns are mandatory and neither has a value for goods sold by tonne
 * under a tariff description. The vendor's own exports write these two words.
 */
const UNBRANDED = 'UNBRANDED';
const NO_MODEL = 'NA';

/**
 * The IGST schedule serial for a CTH, for a draft that did not carry one.
 *
 * Only ever offered beside 9/2025 itself: filing this notification's serial
 * next to some other notification number would be a worse declaration than a
 * blank. Residual matches stay blank, deliberately — Schedule II's catch-all
 * answers the rate but names no goods, and a serial says the notification
 * described these goods.
 */
function igstSerialFor(cth: string | undefined, notification: string | undefined): string | undefined {
  if (!cth) return undefined;
  if (notification && notification !== IGST_RATE_NOTIFICATION) return undefined;
  const igst = igstRateForCth(cth);
  if (!igst || igst.residual) return undefined;
  return `${igst.entry.schedule}${igst.entry.serial}`;
}

/**
 * The compensation cess serial for a CTH, for a draft that did not carry one.
 *
 * Unlike the IGST side this does answer on a residual match, because S.No. 56
 * is a real entry that names the goods ("all goods other than those mentioned
 * at S. Nos. 1 to 55") rather than a catch-all rate. A contested or specific
 * cess stays blank: the merge flags it for manual entry, and guessing one of
 * two serials here would file past that flag.
 */
function compCessSerialFor(cth: string | undefined, notification: string | undefined): string | undefined {
  if (!cth) return undefined;
  if (notification && notification !== COMP_CESS_NOTIFICATION) return undefined;
  const cess = compCessForCth(cth);
  if (!cess) return undefined;
  if (!cess.residual && cess.alternatives.length) return undefined;
  return cess.entry.serial;
}

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
      // Imported goods have no Central Excise Tariff Heading — central excise
      // survives only on tobacco and petroleum manufactured in India — and
      // NOEXCISE is the word Logi-Sys puts in the column to say so. We used to
      // repeat the CTH here, which the vendor's validator accepts (it only ever
      // said "this field is mandatory") but which asserts an excise
      // classification that does not exist. Both of the vendor's own exports
      // say NOEXCISE.
      CETH: code(NO_EXCISE),
      PolicyPara: BLANK,
      PolicyYear: BLANK,

      // Defaults, not decisions: the merge sets all three on the draft, so a
      // reviewer's edit is what normally arrives here. These fallbacks are for
      // drafts saved before that — the export route reads the stored draft and
      // never re-merges it, so an old draft would otherwise export three blanks.
      General_Description: orElse(
        text(item.generalDescription),
        text(tradeDescription(item.description)),
      ),
      Brand: orElse(text(item.brand), code(UNBRANDED)),
      Model: orElse(text(item.model), code(NO_MODEL)),
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

      IGST_LevyNotn: orElse(code(item.igstNotification), code(IGST_RATE_NOTIFICATION)),
      IGST_LevyNotnSrNo: orElse(code(serials.igst), code(igstSerialFor(cth, item.igstNotification))),
      IGST_CompCessNotn: orElse(code(item.compCessNotification), code(COMP_CESS_NOTIFICATION)),
      IGST_CompCessNotnSrNo: orElse(
        code(serials.compCess),
        code(compCessSerialFor(cth, item.compCessNotification)),
      ),

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
