import { iso6346Code, parseContainerSizeType } from '@checklist/core';
import { BLANK, code, int, orElse, weight } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * CONTAINERS — one row per container.
 *
 * The reason the old single-row-per-sheet exporter could not have worked: this
 * job has six containers, and the hand-keyed attempt carried one. A Bill of
 * Entry that declares one of six containers is not a smaller filing, it is a
 * wrong one.
 */
export function containersRows(ctx: MapContext): SheetRow[] {
  const { containers, containerCountStated } = ctx.draft.shipment;

  if (ctx.draft.transportMode === 'Sea' && containers.length === 0) {
    ctx.warn('CONTAINERS', 'No containers found on the B/L for a sea shipment.');
  }

  // The count the B/L states against the count we are about to file. This is
  // the warning that matters most on this sheet: a workbook carrying three of
  // six containers looks exactly like a correct one, and nothing else in the
  // file says otherwise. It does not block the export — the operator may know
  // the list is right and the total misprinted — but it is said plainly.
  if (containerCountStated != null && containerCountStated !== containers.length) {
    ctx.warn(
      'CONTAINERS.Container No',
      `The B/L states ${containerCountStated} container${containerCountStated === 1 ? '' : 's'} and ` +
        `this workbook declares ${containers.length}. Check the container list on the job against the ` +
        'B/L before filing — a Bill of Entry that declares some of the containers is a wrong one, not a short one.',
    );
  }

  // `IGM Sr.No` is mandatory, and nothing we read carries it. Leaving it blank
  // is what rejected job dbf3530c: Logi-Sys returned four errors, one per
  // container, and refused the whole workbook — so the invoice and the products
  // never landed either. Number them positionally, as Logi-Sys' own export
  // does (1, 2, 3, 4 across its four containers), and say so out loud.
  if (containers.length) {
    ctx.warn(
      'CONTAINERS.IGM Sr.No',
      `Numbered the ${containers.length} container${containers.length === 1 ? '' : 's'} ` +
        `1–${containers.length} in B/L order. Logi-Sys makes this column mandatory and no ` +
        'document we read carries the IGM line number — check them against the IGM before filing.',
    );
  }

  return containers.map((container, i) => {
    const { size, typeCode } = parseContainerSizeType(container.sizeType);

    if (container.sizeType && !size) {
      ctx.warn(
        `CONTAINERS[${i}].ContainerSize`,
        `Could not read a container size out of "${container.sizeType}".`,
      );
    }
    if (!container.sealNo) {
      ctx.warn(`CONTAINERS[${i}].Seal No`, `No seal number for container ${container.number}.`);
    }

    return {
      'IGM Sr.No': int(i + 1),
      'Container No': code(container.number),
      'Seal No': code(container.sealNo),
      // CONFIRM: the draft does not model LCL. Every job so far is full-container,
      // and a wrong value here changes how Customs treats the consignment.
      FCL_LCL: code('FCL'),
      ContainerTypeCode: code(iso6346Code(size, typeCode)),
      ContainerSize: code(size),
      'Truck Number': BLANK,
      EmptyContainerLocation: BLANK,
      // Logi-Sys writes 0 rather than nothing in these two on its own export.
      PackagesStuffed: orElse(int(container.packagesStuffed), int(0)),
      GrWt: orElse(weight(container.grossWeightKg), weight(0)),
    };
  });
}
