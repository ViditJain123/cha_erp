import {
  BE_TYPE_CODE,
  FILING_CODE,
  TRANSPORT_MODE_CODE,
  branchNameForExport,
  iso2,
  unlocodeOf,
} from '@checklist/core';
import { BLANK, code, text, yn } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * GENERAL — one row, the header of the Bill of Entry.
 *
 * Three of this sheet's columns are where the hand-keyed attempt went wrong,
 * all in the same way: the template asks for a code and a person types the
 * name. `CountryOfOriginCode`, `PortOfShipmentCode` and `CountryOfShipmentCode`
 * became JAPAN, YOKOHAMA and JAPAN.
 *
 * `Importer`, `Branch Name` and `AD_Code` go wrong differently. Logi-Sys
 * resolves the party from its own repository on those three values and there
 * is no IEC or GSTIN column to fall back on, so a name that is merely correct
 * is not enough — it has to be the string Logi-Sys holds. They come from the
 * organization repository the CHA uploaded, bound to the job by
 * applyPartyResolution(); an unbound importer is a name off a bill of lading
 * and is warned about.
 */
export function generalRows(ctx: MapContext): SheetRow[] {
  const { draft } = ctx;

  const originCode = iso2(draft.shipment.countryOfOrigin);
  if (draft.shipment.countryOfOrigin && !originCode) {
    ctx.blocker(
      'GENERAL.CountryOfOriginCode',
      `Country of origin "${draft.shipment.countryOfOrigin}" has no ISO country code. ` +
        'Country of origin drives the duty rate and any FTA claim, so this cannot be left to Logi-Sys to infer.',
    );
  }

  const shipmentCountryCode = iso2(draft.shipment.consCountry);
  if (draft.shipment.consCountry && !shipmentCountryCode) {
    ctx.warn(
      'GENERAL.CountryOfShipmentCode',
      `Country of shipment "${draft.shipment.consCountry}" has no ISO country code.`,
    );
  }

  const portCode = unlocodeOf(draft.shipment.portOfLoading);
  if (draft.shipment.portOfLoading && !portCode) {
    ctx.warn(
      'GENERAL.PortOfShipmentCode',
      `Port of shipment "${draft.shipment.portOfLoading}" is not in the foreign-ports master, ` +
        'so no UN/LOCODE could be emitted. Add it to packages/core/src/masters/data.ts.',
    );
  }

  if (!draft.importer.organizationId) {
    ctx.warn(
      'GENERAL.Importer',
      `Importer "${draft.importer.name}" is not bound to a row in the organization repository, so this is ` +
        'the name off the shipping documents rather than the one Logi-Sys holds. Logi-Sys keys the party ' +
        'on it: pick the right organization on the job, or add the party in Logi-Sys and re-upload the repository.',
    );
  }

  if (!draft.importer.adCode) {
    ctx.warn('GENERAL.AD_Code', 'No AD code on the importer — Logi-Sys needs it to file.');
  }

  // "0", "." and "NA" are how the repository spells "no branch", and the
  // workbook that imported cleanly left this column empty for such a party.
  const branchName = branchNameForExport(draft.importer.branchName);

  return [
    {
      TransportModeCode: code(TRANSPORT_MODE_CODE[draft.transportMode]),
      CustomsHouseCode: code(draft.customStation.code),
      BETypeCode: code(BE_TYPE_CODE[draft.beType]),
      // CONFIRM: Logi-Sys may want its own party code here rather than a name.
      Importer: text(draft.importer.logisysPartyCode ?? draft.importer.name),
      'Branch Name': text(branchName),
      AD_Code: code(draft.importer.adCode),
      Importer_RefNo: text(ctx.job.reference),
      CountryOfOriginCode: code(originCode),
      PortOfShipmentCode: code(portCode),
      CountryOfShipmentCode: code(shipmentCountryCode),
      'BE-Heading': BLANK,
      // Duty paid by transaction, not deferred. The draft models no deferred
      // duty account, so this is constant until it does.
      DutyPaymentStatus_T_D: code('T'),
      AdvancePriorNormal: code(FILING_CODE[draft.filingStatus]),
      // None of these are modelled in the draft, and the printed checklist
      // shows them all as "No" for every job we have seen.
      IsUnderSec46: yn(false),
      IsUnderSec48: yn(false),
      IsFirstCheck: yn(false),
      IsGreenChannel: yn(false),
      IsKachchaBE: yn(false),
      IsHSS: yn(false),
      IsBondsCertificates: yn(false),
      IsTranshipment: yn(false),
      ITC_Lic_details: BLANK,
      IsUnderProvisionalAssessment: yn(false),
    },
  ];
}
