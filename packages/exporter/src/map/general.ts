import {
  BE_TYPE_CODE,
  TRANSPORT_MODE_CODE,
  branchNameForExport,
  foreignPortByUnlocode,
  iso2,
  unlocodeOf,
} from '@checklist/core';
import { BLANK, code, text, ynBlank } from '../cell.js';
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
 *
 * The remaining thirteen went wrong in a third way, which was worse because it
 * was invisible: they were constants. The custom house was
 * `awb ? 'INBOM4' : 'INNSA1'`, the duty payment status was the literal 'T', the
 * filing posture was a coin flip on transport mode, and the nine yes/no columns
 * were always blank. Every one of those now comes off `draft.boe`, which
 * `applyGeneralResolution` fills from the customer's mail, the importer master
 * and the operator — and which is absent, rather than defaulted, when nothing
 * answered. This mapper's job is to refuse to write a value nobody chose.
 *
 * The per-column contract is `docs/boe-mapping/01-general.md`.
 */
export function generalRows(ctx: MapContext): SheetRow[] {
  const { draft } = ctx;
  const boe = draft.boe;

  if (!boe) {
    ctx.blocker(
      'GENERAL',
      'The Bill of Entry header has not been resolved for this job, so the custom house, BE type, ' +
        'duty payment status and filing status are all unknown. Re-read the documents from the job ' +
        'screen — the export cannot invent them.',
    );
  }

  const originCode = iso2(draft.shipment.countryOfOrigin);
  if (draft.shipment.countryOfOrigin && !originCode) {
    ctx.blocker(
      'GENERAL.CountryOfOriginCode',
      `Country of origin "${draft.shipment.countryOfOrigin}" has no ISO country code. ` +
        'Country of origin drives the duty rate and any FTA claim, so this cannot be left to Logi-Sys to infer.',
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

  // Country of shipment, in the order the sources deserve to be trusted.
  //
  // The load port is the better source than the draft's own country string,
  // because a UN/LOCODE *contains* its country: CNTAO is CN by construction,
  // where the name printed beside it in the port list is "Chinese Mainland" and
  // resolves to nothing. So the port decides, and `consCountry` is the fallback
  // for a port we could not code.
  const portCountryCode = portCode
    ? (foreignPortByUnlocode(portCode)?.countryCode ?? iso2(portCode.slice(0, 2)))
    : undefined;
  const shipmentCountryCode = portCountryCode ?? iso2(draft.shipment.consCountry);
  if (draft.shipment.consCountry && !shipmentCountryCode) {
    ctx.warn(
      'GENERAL.CountryOfShipmentCode',
      `Country of shipment "${draft.shipment.consCountry}" has no ISO country code.`,
    );
  }
  if (!shipmentCountryCode) {
    ctx.warn(
      'GENERAL.CountryOfShipmentCode',
      'No country of shipment: neither a load port nor a consignment country was read off the ' +
        'transport document. Customs treats this as a different question from country of origin.',
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

  // ---- The header values, each of which may legitimately be unknown ----

  const station = boe?.customStation;
  if (!station) {
    ctx.blocker(
      'GENERAL.CustomsHouseCode',
      'No custom house. Which station a consignment is filed at is the customer’s instruction, not ' +
        'something the shipping documents say — set it on the job, or record the importer’s default. ' +
        'A Bill of Entry filed at the wrong custom house is rejected outright.',
    );
  }

  // An AD code is how the bank realises the remittance against this BE. When
  // the importer has several, picking one here would be a coin toss printed on
  // a customs document.
  //
  // Precedence, per docs/boe-mapping/README.md: master < operator. So a code a
  // person picked wins, and otherwise the bound organization row decides —
  // `importer.adCode` is what applyPartyResolution read off that row, and it is
  // the fresher of the two whenever the party has just been re-bound. A
  // header resolved against the old party must not outvote the new one.
  const chosenAdCode = boe?.adCode?.source === 'operator' ? boe.adCode.value : undefined;
  const adCode = chosenAdCode ?? draft.importer.adCode ?? boe?.adCode?.value;
  if (!adCode) {
    const choices = boe?.adCodeChoices;
    if (choices && choices.length > 1) {
      ctx.blocker(
        'GENERAL.AD_Code',
        `The importer banks through ${choices.length} AD codes ` +
          `(${choices.map((c) => c.adCode).join(', ')}) and none is chosen for this shipment. ` +
          'Pick the one the remittance is against.',
      );
    } else {
      ctx.warn('GENERAL.AD_Code', 'No AD code on the importer — Logi-Sys needs it to file.');
    }
  }

  const filingStatus = boe?.filingStatus;
  if (!filingStatus) {
    ctx.warn(
      'GENERAL.AdvancePriorNormal',
      'Advance, Prior or Normal is left blank: it is decided by whether an IGM has been filed against ' +
        'this BL and whether entry inwards has been granted, and neither has been keyed on the job.',
    );
  }

  const flags = boe?.flags ?? {};
  if (flags.underSec46 === undefined && draft.shipment.inwardDate && !draft.shipment.beFilingDate) {
    ctx.warn(
      'GENERAL.IsUnderSec46',
      'Sections 46 and 48 are left blank: they need the date the Bill of Entry is presented, which is ' +
        'not on the job.',
    );
  }

  // "0", "." and "NA" are how the repository spells "no branch", and the
  // workbook that imported cleanly left this column empty for such a party.
  const branchName = branchNameForExport(draft.importer.branchName);

  return [
    {
      TransportModeCode: code(boe ? TRANSPORT_MODE_CODE[boe.transportMode.value] : undefined),
      CustomsHouseCode: code(station?.value.code),
      BETypeCode: code(boe ? BE_TYPE_CODE[boe.beType.value] : undefined),
      // CONFIRM: Logi-Sys may want its own party code here rather than a name.
      Importer: text(draft.importer.logisysPartyCode ?? draft.importer.name),
      'Branch Name': text(branchName),
      AD_Code: code(adCode),
      // The importer's own reference — a PO or indent number they asked us to
      // carry — not our job number, which is what used to be written here.
      Importer_RefNo: text(boe?.importerRefNo?.value),
      CountryOfOriginCode: code(originCode),
      PortOfShipmentCode: code(portCode),
      CountryOfShipmentCode: code(shipmentCountryCode),
      'BE-Heading': BLANK,
      DutyPaymentStatus_T_D: code(boe?.dutyPaymentStatus.value),
      AdvancePriorNormal: code(
        filingStatus
          ? { Advance: 'A', Prior: 'P', Normal: 'N' }[filingStatus.value]
          : undefined,
      ),
      // Y or blank, never N.
      //
      // A workbook Logi-Sys exported itself
      // (`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx`) leaves every one
      // of these empty rather than writing N, and so does the corrected workbook
      // that was accepted for job ce9c889d. The vendor's own file is the
      // authority on its own format — the same way it is for the explicit zeros
      // on the INVOICES charge block, where the vendor writes 0 where we had
      // blank. What changed here is that "true" is now expressible: these used
      // to be unconditionally blank because nothing could set them.
      IsUnderSec46: ynBlank(flags.underSec46),
      IsUnderSec48: ynBlank(flags.underSec48),
      IsFirstCheck: ynBlank(flags.firstCheck),
      IsGreenChannel: ynBlank(flags.greenChannel),
      IsKachchaBE: ynBlank(flags.kachchaBe),
      IsHSS: ynBlank(flags.hss),
      // Derived, not an independent flag: all three populated vendor exports
      // set it to `Y` and carry rows, and ICES has nothing to reconcile it
      // against but the sheet itself. The operator tick still forces it on, for
      // a security keyed straight into Logi-Sys.
      IsBondsCertificates: ynBlank(flags.bondsCertificates || (draft.bonds ?? []).length > 0),
      IsTranshipment: ynBlank(flags.transhipment),
      ITC_Lic_details: ynBlank(flags.itcLicDetails),
      IsUnderProvisionalAssessment: ynBlank(flags.provisionalAssessment),
    },
  ];
}
