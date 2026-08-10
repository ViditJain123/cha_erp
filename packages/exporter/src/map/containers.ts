import { parseContainerSizeType } from '@checklist/core';
import { BLANK, code, num } from '../cell.js';
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
  const { containers } = ctx.draft.shipment;

  if (ctx.draft.transportMode === 'Sea' && containers.length === 0) {
    ctx.warn('CONTAINERS', 'No containers found on the B/L for a sea shipment.');
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
      'IGM Sr.No': BLANK,
      'Container No': code(container.number),
      'Seal No': code(container.sealNo),
      // CONFIRM: the draft does not model LCL. Every job so far is full-container,
      // and a wrong value here changes how Customs treats the consignment.
      FCL_LCL: code('FCL'),
      ContainerTypeCode: code(typeCode),
      ContainerSize: code(size),
      'Truck Number': BLANK,
      EmptyContainerLocation: BLANK,
      PackagesStuffed: num(container.packagesStuffed),
      GrWt: num(container.grossWeightKg),
    };
  });
}
