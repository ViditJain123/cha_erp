import { BLANK, isoDate, num, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SW_PRODUCTION — Single Window batch details.
 *
 * Only food and pharma consignments carry these; the draft populates
 * `DraftItem.batch` for tariff chapters 2–22 (see SINGLE_WINDOW_RULES). For
 * everything else this yields no rows and the sheet stays header-only.
 */
export function swProductionRows(ctx: MapContext): SheetRow[] {
  return ctx.draft.items
    .filter((item) => item.batch)
    .map((item) => ({
      Inv_SrNo: num(1),
      Item_SrNo: num(item.slNo),
      Prod_Batch_ID: text(item.batch?.batchNo),
      Prod_Batch_Quantity: num(item.batch?.quantity),
      Prod_Batch_Unit: text(item.batch?.quantity != null ? item.unit : undefined),
      Prod_Manufacturer_Date: isoDate(item.batch?.manufactureDate),
      Prod_Expiry_Date: isoDate(item.batch?.expiryDate),
      Prod_Best_before_Date: BLANK,
    }));
}
