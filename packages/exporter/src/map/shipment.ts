import { normalizePackageUnit } from '@checklist/core';
import { BLANK, code, isoDate, num, text } from '../cell.js';
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

/** SHIPMENT — one row, the transport document. */
export function shipmentRows(ctx: MapContext): SheetRow[] {
  const { shipment } = ctx.draft;

  const pkgUnit = normalizePackageUnit(shipment.packageUnit);
  if (shipment.packageUnit && !pkgUnit) {
    ctx.warn(
      'SHIPMENT.PkgUnitCode',
      `Package unit "${shipment.packageUnit}" is not in the package-unit master.`,
    );
  }

  if (shipment.netWeightKg == null) {
    ctx.warn('SHIPMENT.NtWt', 'Net weight not found on any document; the BE declares it alongside gross.');
  }

  return [
    {
      // No carrier-code master exists; Logi-Sys resolves the line by name.
      CarrierCode: BLANK,
      CarrierName: text(shipment.shippingLineOrCarrier),
      VesselName: text(vesselNameOf(shipment.vesselOrFlight, shipment.voyageNo)),
      Flight_Inward_Date: isoDate(shipment.inwardDate),
      FlightNo_VoyageNo: text(shipment.voyageNo),
      LineNo: BLANK,
      IGM_No: code(shipment.igmNo),
      IGM_Date: isoDate(shipment.igmDate),
      // Master transport document: the MAWB for air, the MBL for sea.
      MAWB_MBL_No: code(shipment.mawbNo ?? shipment.blNo),
      AWB_BL_Date: isoDate(shipment.mawbDate ?? shipment.blDate),
      HAWB_HBL_No: code(shipment.hawbNo ?? shipment.hblNo),
      HAWB_HBL_Date: isoDate(shipment.hawbDate),
      No_of_Pkg: num(shipment.packageCount),
      PkgUnitCode: code(pkgUnit),
      GrWt: num(shipment.grossWeightKg),
      GrWtUnitCode: code(shipment.grossWeightKg != null ? 'KGS' : undefined),
      NtWt: num(shipment.netWeightKg),
      NtWtUnitCode: code(shipment.netWeightKg != null ? 'KGS' : undefined),
      'Marks_&_Nos': text(shipment.marksAndNos),
      Port_of_Reporting: code(ctx.draft.customStation.code),
      Gateway_IGM_No: BLANK,
      Gateway_IGM_Date: BLANK,
      Gateway_Inward_Date: BLANK,
    },
  ];
}
