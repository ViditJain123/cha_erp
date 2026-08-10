import { code, num, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SW_ADDL_INFO — Single Window additional product information.
 *
 * One row per declaration the participating government agency wants: the
 * standard UQC, and for chemicals the CPC category, CAS number and IUPAC name.
 *
 * Note the header spelling: this sheet uses `Inv_SrNo` / `Item_SrNo` with
 * underscores, where ITEMS and INVOICES use `InvSrNo` / `ItemSrNo` without.
 * The writer resolves columns by exact header text, so the difference matters.
 */
export function swAddlInfoRows(ctx: MapContext): SheetRow[] {
  const rows = ctx.draft.singleWindowInfo ?? [];

  return rows.map((row) => ({
    Inv_SrNo: num(1),
    Item_SrNo: num(row.itemSlNo),
    Info_Type: text(row.infoType),
    info_Qualifier: text(row.qualifier),
    Info_Code_Description: code(row.code),
    Information: text(row.information),
    Measure: num(row.measurement),
    Measure_Unit: code(row.unit),
  }));
}
