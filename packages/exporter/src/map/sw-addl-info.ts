import { swInfoTypeCode, swQualifierCode } from '@checklist/core';
import { code, int, orElse, qty, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SW_ADDL_INFO — Single Window additional product information.
 *
 * One row per declaration the participating government agency wants: the
 * standard UQC, and for chemicals the CPC category, CAS number and IUPAC name.
 *
 * `Info_Type` and `info_Qualifier` are code columns, not label columns. The
 * draft carries the prose the Logi-Sys UI shows ("Item Characteristics",
 * "Standard UQC"); Logi-Sys' own export writes `CHR` and `SQC`. A row whose
 * label has no code is dropped with a warning rather than emitted with the
 * label in it — an unmapped label in a code column is what fails validation,
 * and the same all-or-nothing rule already governs SW_PRODUCTION.
 *
 * Note the header spelling: this sheet uses `Inv_SrNo` / `Item_SrNo` with
 * underscores, where ITEMS and INVOICES use `InvSrNo` / `ItemSrNo` without.
 * The writer resolves columns by exact header text, so the difference matters.
 */
export function swAddlInfoRows(ctx: MapContext): SheetRow[] {
  const rows = ctx.draft.singleWindowInfo ?? [];
  const out: SheetRow[] = [];

  for (const row of rows) {
    const infoType = swInfoTypeCode(row.infoType);
    const qualifier = swQualifierCode(row.qualifier);

    if (!infoType || !qualifier) {
      ctx.warn(
        'SW_ADDL_INFO',
        `Item ${row.itemSlNo}: no Logi-Sys code for ` +
          `${!infoType ? `information type "${row.infoType}"` : `qualifier "${row.qualifier}"`}, ` +
          'so that Single Window declaration was left out. Add it in Logi-Sys if the ' +
          'participating agency needs it.',
      );
      continue;
    }

    out.push({
      Inv_SrNo: int(1),
      Item_SrNo: int(row.itemSlNo),
      Info_Type: code(infoType),
      info_Qualifier: code(qualifier),
      Info_Code_Description: code(row.code),
      Information: text(row.information),
      // Logi-Sys writes 0.000000 rather than nothing on the rows that carry no
      // measurement — the CPC, CAS and IUPAC rows of its own export.
      Measure: orElse(qty(row.measurement), qty(0)),
      Measure_Unit: code(row.unit),
    });
  }

  return out;
}
