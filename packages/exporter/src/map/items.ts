import {
  ACCESSORY_STATUS,
  ADD_BASIS_ASSESSABLE,
  COMP_CESS_NOTIFICATION,
  CVD_CALCULATED_ON_LANDED,
  END_USE_CODES,
  IGST_RATE_NOTIFICATION,
  compCessForCth,
  eximSchemeCode,
  igstRateForCth,
  iso2,
  logisysNotn,
  pad8,
  tradeDescription,
} from '@checklist/core';
import type { DraftItem, NotificationLine, TradeRemedyLine } from '@checklist/extraction';
import { BLANK, code, decimal, int, isoDate, money, orElse, qty, rate5, text, weight, yn, type Cell } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * ITEMS — one row per line of goods, per invoice.
 *
 * The contract for every column is docs/boe-mapping/06-items.md; the section
 * numbers in the comments below are its sections. The draft arrives with the
 * document-side facts read by the merge and the master-side facts settled by
 * `resolveItems` (packages/extraction/src/items-resolve.ts), so this mapper
 * decides nothing a person or a master has not — it writes, refuses, or warns.
 */

/**
 * Tolerance on the quantity × unit price = amount check.
 *
 * Loose enough for rounding at 6dp on a six-figure line, tight enough that a
 * unit-conversion slip (which is always a factor of 1000) cannot slip through.
 */
const AMOUNT_TOLERANCE = 0.005;

/** §5 — Logi-Sys' word for "this line carries no central excise". */
const NO_EXCISE = 'NOEXCISE';

/**
 * Brand and model on a line that carries neither (§8). Mandatory columns; the
 * vendor's own exports and ICES ("If not applicable declare as N.A.") write
 * these two words.
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

/** A notification number in Logi-Sys' `NNN/YYYY` spelling, as a text cell. */
function notn(value: string | undefined): Cell {
  return code(logisysNotn(value) ?? value);
}

/**
 * §19 — the Plus/Minus/Higher/Lower flag. Written only when it changes the
 * duty: a purely ad valorem notification computes the same under every flag,
 * and the desk's hand-filled sheets leave the column blank for those.
 */
function flag(value: NotificationLine['flag']): Cell {
  return value && value !== '+' ? code(value) : BLANK;
}

/**
 * Columns Logi-Sys writes as an explicit zero on every ITEMS row of its own
 * export, whether or not the duty instrument applies.
 *
 * Taken verbatim from the I-10793 export, at its decimal places (`constant`,
 * with that file as the evidence). A real value for any of them overwrites the
 * zero in the row below.
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

/** §21 — the anti-dumping block for one remedy line. */
function addCells(line: TradeRemedyLine | undefined): SheetRow {
  if (!line) return {};
  const specific = line.amountPerUnit !== undefined;
  return {
    ADD_Notn: notn(line.notification),
    ADD_NotnSrNo: code(line.serial ?? line.cthSerial),
    CTHSrNo: code(line.cthSerial),
    SuppSrNo: code(line.supplierSerial),
    ...(line.quantity !== undefined && { ADD_Qty: qty(line.quantity) }),
    ADD_Basis: specific ? BLANK : code(ADD_BASIS_ASSESSABLE),
    ...(line.ratePercent !== undefined && { 'ADD_%Rate': decimal(line.ratePercent, 2) }),
    ADD_Currency: code(line.currency),
    ...(specific && { ADD_AmountPerUnit: rate5(line.amountPerUnit) }),
    ADD_AmountUnit: code(line.amountUnit),
  };
}

/** §21 — the CVD block. */
function cvdCells(line: TradeRemedyLine | undefined): SheetRow {
  if (!line) return {};
  return {
    CVD_Notn: notn(line.notification),
    CVD_NotnSrNo: code(line.serial ?? line.cthSerial),
    ...(line.ratePercent !== undefined && { CVD_Rate: money(line.ratePercent) }),
    CVD_CalculatedOn: code(CVD_CALCULATED_ON_LANDED),
    CVD_ItemSrNo: code(line.cthSerial),
    CVD_SupplierSrNo: code(line.supplierSerial),
  };
}

export function itemsRows(ctx: MapContext): SheetRow[] {
  const { draft } = ctx;

  if (draft.items.length === 0) {
    ctx.blocker('ITEMS', 'The draft has no line items — there is nothing to declare.');
  }

  const svb = draft.supplierRelationship?.isRelated ? draft.supplierRelationship : undefined;

  return draft.items.map((item: DraftItem, i) => {
    const path = `ITEMS[${i}]`;
    const label = `Item ${item.invoiceSrNo}/${item.slNo}`;

    // ---- §4 CTH ----
    const cth = pad8(item.ritc);
    if (!cth) {
      ctx.blocker(
        `${path}.CTH`,
        `${label} has no usable tariff code (got "${item.ritc}"). ` +
          'The CTH determines the duty rate, so it cannot be left for Logi-Sys to fill.',
      );
    }
    // A description this importer has never filed, not yet looked at. Only
    // drafts that record provenance can say so; older drafts carry no sources.
    if (item.sources?.ritc && item.sources.ritc !== 'master' && item.sources.ritc !== 'operator') {
      ctx.blocker(
        `${path}.CTH`,
        `${label}: "${item.description.slice(0, 60)}" is new for this importer — confirm its classification ` +
          `(CTH ${item.ritc || 'none'}) on the job before it is filed. It is remembered from then on.`,
      );
    }

    // ---- §3 quantity × price ----
    // They come apart when a unit is converted (156.450 MT at 1,207.57/MT is
    // 156,450 KGS at 1.20757/KG) and only one side is rescaled — which
    // overstates the line by a factor of 1000 and would be a misdeclaration.
    const computed = item.quantity * item.unitPrice;
    if (item.amount > 0 && Math.abs(computed - item.amount) > AMOUNT_TOLERANCE * item.amount) {
      ctx.blocker(
        path,
        `${label}: quantity × unit price (${item.quantity} × ${item.unitPrice} = ` +
          `${computed.toFixed(2)}) does not match the line amount ${item.amount}. ` +
          'This usually means a unit conversion rescaled the quantity but not the price.',
      );
    }

    // ---- §9 end use ----
    if (!item.endUseCode) {
      ctx.warn(`${path}.End_Use`, `${label}: no end use — no instruction from the importer and no default. Set it on the job.`);
    } else if (!END_USE_CODES[item.endUseCode]) {
      ctx.blocker(`${path}.End_Use`, `${label}: "${item.endUseCode}" is not an ICES end-use code.`);
    }

    // ---- §11 origin ----
    const originCountry = iso2(item.originCountry ?? draft.shipment.countryOfOrigin);
    if (!originCountry) {
      ctx.blocker(
        `${path}.Country_of_Origin`,
        `${label}: country of origin "${item.originCountry ?? draft.shipment.countryOfOrigin ?? ''}" has no ISO code — ` +
          'the column is mandatory and coded. Ask the importer.',
      );
    }

    // ---- §8 brand ----
    if (item.sources?.brand === 'default') {
      ctx.warn(`${path}.Brand`, `${label}: the invoice prints no brand; filed as ${UNBRANDED}. Confirm on the job.`);
    }

    // ---- §12 accessories ----
    const accessoryStatus = item.accessoryStatus ?? ACCESSORY_STATUS.NONE;
    if (accessoryStatus === ACCESSORY_STATUS.SUPPLIED_WITH_ITEM && !item.accessoriesDetails?.trim()) {
      ctx.blocker(`${path}.Accessories_Details`, `${label}: accessories are declared as supplied with the item, but not described.`);
    }

    // ---- §10 Exim scheme ----
    const eximCode = item.eximScheme ? eximSchemeCode(item.eximScheme.code) : undefined;
    if (item.eximScheme && !eximCode) {
      ctx.blocker(`${path}.Exim_Code`, `${label}: "${item.eximScheme.code}" is not a known Exim scheme code.`);
    }

    // ---- §17 preferential origin ----
    const fta = item.fta;
    const ftaPath = `${path}.COO`;
    if (fta?.retroactiveCheck && !fta.retroactiveCheck.compliant) {
      ctx.blocker(ftaPath, `${label}: ${fta.retroactiveCheck.reason}`);
    }
    // The claim that goes in Basic_Notn: an FTA in the BASIC slot, else a
    // general exemption the notification step chose (45/2025, 24/2005 …).
    const basicFromFta = fta && fta.slot === 'BASIC' ? fta : undefined;
    const saptaFromFta = fta && fta.slot === 'SAPTA' ? fta : undefined;
    // A pre-per-item draft carries its claim only as bcdExemption + ftaClaim.
    const legacyClaim = !fta && item.bcdExemption ? item.bcdExemption : undefined;
    const draftClaim = !fta && legacyClaim ? draft.ftaClaim : undefined;
    const cooNumber = fta?.cooNumber ?? draftClaim?.cooNumber;
    const claimed = Boolean(fta || draftClaim);
    if (claimed && !cooNumber) {
      ctx.blocker(ftaPath, `${label}: a preferential rate is claimed with no certificate of origin number.`);
    }

    const serials = item.notificationSerials ?? {};
    const basicNotn = basicFromFta?.notification ?? legacyClaim?.notification ?? item.bcdNotification;
    const basicSerial = basicFromFta?.serial ?? legacyClaim?.serial ?? serials.basic;
    // P only for a preferential (trade-agreement) rate in Basic; a general
    // exemption like 45/2025 is not a preferential rate.
    const preferential = Boolean(basicFromFta || (legacyClaim && (legacyClaim.scheme || draftClaim)));

    // ---- §21 trade remedies ----
    if (item.tradeRemedyCandidates?.length) {
      ctx.blocker(
        `${path}.ADD_Notn`,
        `${label}: ${item.tradeRemedyCandidates.length} trade-remedy row(s) may apply and none is chosen — ` +
          item.tradeRemedyCandidates
            .slice(0, 3)
            .map((c) => `${c.kind} ${c.notification} row ${c.cthSerial ?? '?'} (${c.producer} / ${c.exporter})`)
            .join('; ') +
          '. Pick one on the job.',
      );
    }
    const remedy = (kind: TradeRemedyLine['kind']) => item.tradeRemedies?.find((l) => l.kind === kind);
    const safeguard = remedy('SAFEGUARD');

    // ---- §23 manufacturer ----
    const manufacturerCountry = iso2(item.manufacturerCountry) ?? countryFromAddress(item.manufacturerAddress);

    // ---- §20 tariff value ----
    const tv = item.tariffValue;

    // ---- §25 SVB ----
    const svbCells: SheetRow = svb
      ? {
          SVBRefNo: code(svb.svbRefNo),
          SVBRefDate: isoDate(svb.svbDate),
          SVBCustomHouse: code(svb.svbCustomHouse),
          SVB_Loading_Basis: code(svb.loadingBasis),
          ...(svb.rateAssessable !== undefined && { SVB_Rate_Assessable: rate5(svb.rateAssessable) }),
          SVB_Status_Assessable: code(svb.statusAssessable),
          ...(svb.rateDuty !== undefined && { SVB_Rate_Duty: rate5(svb.rateDuty) }),
          SVB_Status_Duty: code(svb.statusDuty),
        }
      : {};

    const prev = item.previousBe;

    return {
      ...ITEM_ZEROS,

      // §1
      InvSrNo: int(item.invoiceSrNo),
      ItemSrNo: int(item.slNo),

      // §3
      Product_Description: text(item.description),
      QTY: qty(item.quantity),
      Unit: code(item.unit),
      Unit_Price: qty(item.unitPrice),

      // §4, §5, §6
      CTH: code(cth),
      RITC: code(cth),
      CETH: code(NO_EXCISE),
      PolicyPara: code(item.eximScheme?.policyPara),
      PolicyYear: code(item.eximScheme?.policyYear),

      // §7, §8, §9, §11
      General_Description: orElse(text(item.generalDescription), text(tradeDescription(item.description))),
      Brand: orElse(text(item.brand), code(UNBRANDED)),
      Model: orElse(text(item.model), code(NO_MODEL)),
      End_Use: code(item.endUseCode || undefined),
      Country_of_Origin: code(originCountry),

      // §12
      Accessories_Status: int(Number(accessoryStatus)),
      Accessories_Details: text(item.accessoriesDetails),

      // §10
      Exim_Code: code(eximCode),
      Exim_Notn: notn(item.eximScheme?.notification),
      Exim_NotnSrNo: code(item.eximScheme?.serial),

      // §14, §15
      Standard_Preferential: code(preferential ? 'P' : 'S'),
      Basic_Notn: notn(basicNotn),
      Basic_NotnSrNo: code(basicSerial),

      // §16
      SWS_Notn: notn(item.swsExemption?.notification),
      SWS_NotnSrNo: code(item.swsExemption?.serial ?? serials.sws),

      // §18
      IGST_LevyNotn: orElse(notn(item.igstNotification), code(IGST_RATE_NOTIFICATION)),
      IGST_LevyNotnSrNo: orElse(code(serials.igst), code(igstSerialFor(cth, item.igstNotification))),
      IGST_LevyNotnFlag: flag(item.igstLevyFlag),
      IGST_ExemptionNotnType: code(item.igstExemption?.type),
      IGST_ExemptionNotn: notn(item.igstExemption?.notification),
      IGST_ExemptionNotnSrNo: code(item.igstExemption?.serial),
      IGST_ExemptionNotnFlag: flag(item.igstExemption?.flag),
      IGST_CompCessNotn: orElse(notn(item.compCessNotification), code(COMP_CESS_NOTIFICATION)),
      IGST_CompCessNotnSrNo: orElse(code(serials.compCess), code(compCessSerialFor(cth, item.compCessNotification))),
      IGST_CompCessNotnFlag: flag(item.compCessLevyFlag),
      IGST_CompCessExemptionNotnType: code(item.compCessExemption?.type),
      IGST_CompCessExemptionNotn: notn(item.compCessExemption?.notification),
      IGST_CompCessExemptionNotnSrNo: code(item.compCessExemption?.serial),
      IGST_CompCessExemptionNotnFlag: flag(item.compCessExemption?.flag),

      // §16 — no current levy for these on imports this CHA files
      Road_Infra_Cess_Notn: BLANK,
      Road_Infra_Cess_NotnSrNo: BLANK,
      NCD_Notn: BLANK,
      NCD_NotnSrNo: BLANK,
      Aggregate_Duty_Notn: BLANK,
      Aggregate_Duty_NotnSrNo: BLANK,

      // §21
      Safeguard_Duty_Notn: notn(safeguard?.notification),
      Safeguard_Duty_NotnSrNo: code(safeguard?.serial ?? safeguard?.cthSerial),

      // §17 — the SAPTA slot
      SAPTA_Notn: notn(saptaFromFta?.notification),
      SAPTA_NotnSrNo: code(saptaFromFta?.serial),

      // §20
      Tariff_Value_Notn: notn(tv?.notification),
      Tariff_Value_NotnSrNo: code(tv?.serial),
      ...(tv && { Tarrif_Value_Qty: weight(tv.quantity) }),
      Tarrif_Value_Currency: code(tv?.currency),
      ...(tv && { Tarrif_Value_Amount: money(tv.amountPerUnit) }),

      // §21
      ...addCells(remedy('ADD')),

      // §22 — operator-only
      Other_Duty_Notn: BLANK,
      Other_Duty_NotnSrNo: BLANK,
      Other_Duty_Flag: BLANK,
      Other_Duty_AmountUnit: BLANK,
      Duty_Type: BLANK,
      Addl_Duty_Flag: BLANK,

      // §23, §24
      MFG_Name: text(item.manufacturerName),
      MFG_Address: text(item.manufacturerAddress),
      MFG_Country: code(manufacturerCountry),
      MFG_State: text(item.manufacturerState),
      MFG_PIN: code(item.manufacturerPin),
      Source_Country: code(iso2(item.sourceCountry)),
      Transit_Country: code(iso2(item.transitCountry) ?? (claimed ? originCountry : undefined)),

      // §25
      ...svbCells,
      DUTY_ExemptionType: BLANK,

      // §16
      CHealthCess_Notn: notn(item.healthCess?.notification),
      CHealthCess_NotnSrNo: code(item.healthCess?.serial),

      // §17
      isFTAbenefitClaimed: yn(claimed),
      COO_No: code(cooNumber),
      COO_Date_of_Issue: isoDate(fta?.cooDate ?? draftClaim?.cooDate),
      COO_Issuing_Country: code(iso2(fta?.countryOfIssue ?? draftClaim?.countryOfIssue)),
      COO_Origin_Criteria: code(fta?.originCriterion ?? draftClaim?.originCriterion),
      COO_Origin_Criteris_Remarks: text(fta?.originCriterionRemarks),
      COO_Accumulation_Cumulation: code(fta?.accumulation),
      COO_Retroactive_Issuance: claimed
        ? yn(fta?.retroactiveIssuance ?? draftClaim?.retroactiveIssuance ?? false)
        : BLANK,
      COO_Direct_Consignment: claimed ? yn(fta?.directConsignment ?? draftClaim?.directConsignment ?? true) : BLANK,
      COO_TariffShift: code(fta?.tariffShift),
      COO_ItemSrNoCert: code(fta?.itemSrNoInCertificate),

      // §26
      Foc_Item: yn(Boolean(item.foc)),

      // §16 — AIDC
      AIDC_LevyNotn: notn(item.aidcLevy?.notification ?? item.aidcNotification),
      AIDC_LevyNotnSrNo: code(item.aidcLevy?.serial ?? serials.aidc),
      AIDC_ExemptionNotn: notn(item.aidcExemption?.notification),
      AIDC_ExemptionNotnSrNo: code(item.aidcExemption?.serial),
      AIDCNotn_Excise: BLANK,
      ADICNotnSr_Excise: BLANK,

      // §27, §28
      MaterialCode: code(item.materialCode),
      Previous_BENo: code(prev?.beNo),
      Previous_BEDate: isoDate(prev?.beDate),
      Previous_BEIGMNo: code(prev?.igmNo),
      Previous_BEIGMDate: isoDate(prev?.igmDate),
      Previous_BECurrency: code(prev?.currency),
      ...(prev?.unitPrice !== undefined && { Previous_BEUnitPrice: qty(prev.unitPrice) }),
      Previous_BECustomHouse: code(prev?.customHouse),

      // §21 — CVD
      ...cvdCells(remedy('CVD')),
    };
  });
}
