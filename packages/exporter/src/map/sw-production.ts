import { isoDate, num, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SW_PRODUCTION — Single Window batch details.
 *
 * Only food and pharma consignments carry these; the draft populates
 * `DraftItem.batch` for tariff chapters 2–22 (see SINGLE_WINDOW_RULES). For
 * everything else this yields no rows and the sheet stays header-only.
 *
 * A row is all-or-nothing: Logi-Sys makes the manufacture, expiry and
 * best-before dates mandatory on every row of this sheet, so a batch number
 * without its dates cannot be declared here at all. A Certificate of Analysis
 * often gives the batch number and nothing else, which is how a lubricant
 * consignment ended up with two half-filled rows and six rejections. Those rows
 * are dropped with a warning rather than emitted incomplete.
 */
export function swProductionRows(ctx: MapContext): SheetRow[] {
  const rows: SheetRow[] = [];

  for (const item of ctx.draft.items) {
    const batch = item.batch;
    if (!batch) continue;

    if (!batch.manufactureDate || !batch.expiryDate) {
      ctx.warn(
        'SW_PRODUCTION',
        `Item ${item.slNo} has batch ${batch.batchNo ?? '(unnumbered)'} but no ` +
          `${!batch.manufactureDate ? 'manufacture' : 'expiry'} date, so its batch details were ` +
          'left out — Logi-Sys requires the manufacture, expiry and best-before dates on every ' +
          'row of this sheet. Add them in Logi-Sys if the consignment needs them.',
      );
      continue;
    }

    rows.push({
      Inv_SrNo: num(1),
      Item_SrNo: num(item.slNo),
      Prod_Batch_ID: text(batch.batchNo),
      Prod_Batch_Quantity: num(batch.quantity),
      Prod_Batch_Unit: text(batch.quantity != null ? item.unit : undefined),
      Prod_Manufacturer_Date: isoDate(batch.manufactureDate),
      Prod_Expiry_Date: isoDate(batch.expiryDate),
      // The draft models no separate best-before date. For the goods that reach
      // this sheet the two are the same date on the pack, and Logi-Sys will not
      // accept the row without it.
      Prod_Best_before_Date: isoDate(batch.expiryDate),
    });
  }

  return rows;
}
