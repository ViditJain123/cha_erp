import { normalizePackageUnit, resolveIndianStation } from '@checklist/core';
import { BLANK, code, isoDate, text, weight } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * Strip the voyage off the end of a combined vessel/voyage string.
 *
 * `merge.ts` fills `voyageNo` for sea shipments, so this only has to undo the
 * duplication for drafts written before that, or edited by hand.
 */
function vesselNameOf(vesselOrFlight: string | undefined, voyageNo: string | undefined): string | undefined {
  if (!vesselOrFlight) return undefined;
  if (!voyageNo) return vesselOrFlight;
  const trimmed = vesselOrFlight.trim();
  const withoutVoyage = trimmed
    .replace(new RegExp(`[\\s/]*${voyageNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
    .trim();
  return withoutVoyage || trimmed;
}

/**
 * Whether the station this BE is filed at is inland.
 *
 * The sixth character of an ICES site code is its kind, and it beats the
 * master's name-derived `mode` — see `docs/boe-mapping/01-general.md` §1.
 * Only an inland filing has a gateway port behind it, so only an inland filing
 * has Gateway_IGM columns to fill.
 */
function isInlandStation(stationCode: string | undefined): boolean {
  if (!stationCode || stationCode.length < 6) return false;
  return ['6', '2', 'B'].includes(stationCode[5]!.toUpperCase());
}

/**
 * SHIPMENT — one row, the transport document.
 *
 * Dictated in `docs/boe-mapping/03-shipment.md`. Every column below either
 * carries a value, or names itself in a warning. The rule this sheet exists to
 * satisfy is the repo's own: a column with no available source does not quietly
 * become blank.
 */
export function shipmentRows(ctx: MapContext): SheetRow[] {
  const { shipment } = ctx.draft;
  const isAir = ctx.draft.boe?.transportMode?.value === 'Air' || shipment.mawbNo != null;

  // An ex-bond Bill of Entry states what it *releases*, not what originally
  // arrived. ICES asks for the number of packages released and their gross
  // weight (BE Message format 2.25, header fields 35 and 37, both mandatory for
  // an ex-bond BE), and the Logi-Sys template has nowhere else to put them —
  // INBOND_EXBOND carries the warehouse and the into-bond BE, not the quantity.
  // So on an ex-bond filing these two columns are the release.
  const release =
    ctx.draft.boe?.beType.value === 'Ex-Bond' ? ctx.draft.inbondExbond?.release?.value : undefined;

  const packageCount = release?.packages ?? shipment.packageCount;
  const grossWeightKg = release?.grossWeightKg ?? shipment.grossWeightKg;

  if (release && release.grossWeightKg == null) {
    ctx.warn(
      'SHIPMENT.GrWt',
      `This ex-bond Bill of Entry releases ${release.packages} package(s) but no gross weight was ` +
        'derived for them, so the whole consignment’s weight is being written. Customs assesses ' +
        'the released weight — check the packing list gives a per-package weight, or key it in.',
    );
  }

  const pkgUnit = normalizePackageUnit(release?.packageCode ?? shipment.packageUnit);
  const rawPkgUnit = release?.packageCode ?? shipment.packageUnit;
  if (rawPkgUnit && !pkgUnit) {
    ctx.warn(
      'SHIPMENT.PkgUnitCode',
      `Package unit "${rawPkgUnit}" is not in the package-unit master.`,
    );
  } else if (!rawPkgUnit) {
    ctx.warn(
      'SHIPMENT.PkgUnitCode',
      'No package kind (BAG, CTN, PLT…) was found on any document. The BE states what the ' +
        'packages are, not only how many.',
    );
  }

  if (packageCount == null) {
    ctx.warn(
      'SHIPMENT.No_of_Pkg',
      'Package count not found on the transport document, packing list, invoice or certificate ' +
        'of origin. Key it in Logi-Sys — a container count is not a package count.',
    );
  }

  if (grossWeightKg == null) {
    ctx.warn('SHIPMENT.GrWt', 'Gross weight not found on any document; the BE declares it.');
  }
  if (shipment.netWeightKg == null) {
    ctx.warn('SHIPMENT.NtWt', 'Net weight not found on any document; the BE declares it alongside gross.');
  }

  // ---- The transport document ----
  //
  // "Main carrier hoona chaiye": these two columns carry the MAIN CARRIER's
  // document — the MAWB for air, the master B/L for sea. `merge.ts` refuses to
  // put a forwarder's house B/L here, so when they are empty and a house
  // document exists, that is why.
  const masterNo = shipment.mawbNo ?? shipment.blNo;
  const masterDate = shipment.mawbDate ?? shipment.blDate;
  const houseNo = shipment.hawbNo ?? shipment.hblNo;
  const houseDate = shipment.hawbDate ?? shipment.hblDate;

  if (!masterNo) {
    ctx.warn(
      'SHIPMENT.MAWB_MBL_No',
      houseNo
        ? `Only a house document (${houseNo}) is on this job. MAWB_MBL_No declares the main ` +
            'carrier’s air waybill or bill of lading — obtain it and key it in Logi-Sys.'
        : 'No master air waybill or bill of lading was found. The BE cannot be filed without one.',
    );
  } else if (!masterDate) {
    ctx.warn(
      'SHIPMENT.AWB_BL_Date',
      `${masterNo} has no date. The BE dates the transport document — read it off the ` +
        'shipped-on-board stamp or the date of issue.',
    );
  }
  if (houseNo && !houseDate) {
    ctx.warn('SHIPMENT.HAWB_HBL_Date', `House document ${houseNo} has no date on it.`);
  }

  // ---- Carrier and conveyance ----
  if (!shipment.shippingLineOrCarrier) {
    ctx.warn(
      'SHIPMENT.CarrierName',
      isAir
        ? 'Carrier not resolved. It is the airline behind the MAWB’s 3-digit prefix, not the ' +
            'issuing agent — add the prefix to the airline master if it is missing.'
        : 'Shipping line not found on the bill of lading. It is often only in the letterhead or ' +
            'the signature block.',
    );
  }
  if (!isAir && !vesselNameOf(shipment.vesselOrFlight, shipment.voyageNo)) {
    ctx.warn('SHIPMENT.VesselName', 'Vessel name not found on the bill of lading.');
  }
  if (!shipment.voyageNo) {
    ctx.warn(
      'SHIPMENT.FlightNo_VoyageNo',
      isAir ? 'Flight number not found on the air waybill.' : 'Voyage number not found on the bill of lading.',
    );
  }

  // ---- ICEGATE values ----
  //
  // Nothing the customer sends states these; they are read off ICEGATE and
  // keyed on the job screen. They only warn once somebody has said they looked
  // — before that, `IsUnderSec46`/`AdvancePriorNormal` already tell the
  // operator on the job screen that nobody has checked.
  if (shipment.igmChecked) {
    if (!shipment.igmNo) ctx.warn('SHIPMENT.IGM_No', 'ICEGATE was checked but no IGM number was recorded.');
    if (!shipment.igmDate) ctx.warn('SHIPMENT.IGM_Date', 'IGM date not recorded.');
    if (!shipment.lineNo)
      ctx.warn('SHIPMENT.LineNo', 'IGM line number not recorded — it is on the same ICEGATE enquiry as the IGM.');
    if (!shipment.inwardDate)
      ctx.warn(
        'SHIPMENT.Flight_Inward_Date',
        'Entry inwards date not recorded. Sections 46 and 48 are both measured from it.',
      );
  }

  // ---- Gateway ----
  //
  // A consignment cleared at an ICD arrived at a sea port first, and both
  // manifests go on the BE: the ICD's in IGM_No, the gateway port's here. On a
  // direct-port filing there is no gateway and these stay blank without comment.
  const stationCode = ctx.draft.customStation?.code;
  if (isInlandStation(stationCode) && !shipment.gatewayIgmNo) {
    const station = stationCode ? resolveIndianStation(stationCode) : undefined;
    ctx.warn(
      'SHIPMENT.Gateway_IGM_No',
      `This BE is filed at ${station?.name ?? stationCode}, an inland station, so the goods ` +
        'were manifested at a gateway port first. Key the gateway IGM number, date and inward ' +
        'date on the job screen — IGM_No carries the ICD’s own manifest.',
    );
  }

  if (!shipment.marksAndNos) {
    ctx.warn('SHIPMENT.Marks_&_Nos', 'Marks & numbers empty — the BE never leaves this cell blank.');
  }

  // Weights are declared in the unit the weight-unit master resolved, never a
  // literal: a B/L printing KGM or LBS is converted in `merge.ts`, and a figure
  // whose unit could not be read warns there rather than being called KGS here.
  const weightUnit = shipment.weightUnitCode ?? 'KGS';

  return [
    {
      // Always blank. Logi-Sys resolves the line from CarrierName alone — the
      // three vendor exports we hold (liv_job1/JobData_I-10793, ex_job6's
      // logisys-EP061126-1, and the corrected final.xlsx) leave it empty on
      // every row, including the ones that name a carrier. There is no carrier
      // code master to fill it from, and inventing one would be a code constant.
      CarrierCode: BLANK,
      CarrierName: text(shipment.shippingLineOrCarrier),
      VesselName: isAir ? BLANK : text(vesselNameOf(shipment.vesselOrFlight, shipment.voyageNo)),
      Flight_Inward_Date: isoDate(shipment.inwardDate),
      FlightNo_VoyageNo: text(shipment.voyageNo),
      LineNo: code(shipment.lineNo),
      IGM_No: code(shipment.igmNo),
      IGM_Date: isoDate(shipment.igmDate),
      // Master transport document: the MAWB for air, the master B/L for sea.
      MAWB_MBL_No: code(masterNo),
      AWB_BL_Date: isoDate(masterDate),
      HAWB_HBL_No: code(houseNo),
      HAWB_HBL_Date: isoDate(houseDate),
      No_of_Pkg: weight(packageCount),
      PkgUnitCode: code(pkgUnit),
      GrWt: weight(grossWeightKg),
      GrWtUnitCode: code(grossWeightKg != null ? weightUnit : undefined),
      NtWt: weight(shipment.netWeightKg),
      NtWtUnitCode: code(shipment.netWeightKg != null ? weightUnit : undefined),
      'Marks_&_Nos': text(shipment.marksAndNos),
      // The same station as GENERAL's CustomsHouseCode, and unset for the same
      // reason when nobody has chosen one — GENERAL blocks the export in that
      // case, so this never ships blank on its own.
      //
      // On an ICD job this is the ICD, not the gateway sea port the vessel
      // reported at. The gateway appears only in the three columns below.
      Port_of_Reporting: code(stationCode),
      Gateway_IGM_No: code(shipment.gatewayIgmNo),
      Gateway_IGM_Date: isoDate(shipment.gatewayIgmDate),
      Gateway_Inward_Date: isoDate(shipment.gatewayInwardDate),
    },
  ];
}
