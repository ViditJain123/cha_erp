import { swInfoTypeCode, swQualifierCode } from '@checklist/core';
import { BLANK, code, int, orElse, qty, text } from '../cell.js';
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
 * label has no code is dropped rather than emitted with the label in it — an
 * unmapped label in a code column is what fails validation (ICES 453 / 454),
 * and the same all-or-nothing rule already governs SW_PRODUCTION.
 *
 * Dropping it **warns** for every family but one. The standard-quantity row is
 * the single declaration ICES wants on every line of every Bill of Entry, so
 * losing it is not a gap an operator can fill later: the workbook would be
 * filed short and rejected (486 / 493 / 497). That one blocks.
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
      const what = !infoType
        ? `information type "${row.infoType}"`
        : `qualifier "${row.qualifier}"`;
      const at = `Item ${row.invoiceSrNo ?? 1}/${row.itemSlNo}`;
      // The SUQC row is the one declaration ICES wants on every line of every
      // Bill of Entry, so losing it is not a gap the operator can fill later:
      // the workbook would be filed short and rejected (486 / 493 / 497).
      // Every other family is optional to some agency, and warns as before.
      if (/standard uqc|statistical unit quantity/i.test(row.qualifier ?? '')) {
        ctx.blocker(
          'SW_ADDL_INFO',
          `${at}: no Logi-Sys code for ${what}. The standard-quantity declaration is ` +
            'mandatory on every line (ICES 486), so the workbook would be rejected.',
        );
      } else {
        ctx.warn(
          'SW_ADDL_INFO',
          `${at}: no Logi-Sys code for ${what}, so that Single Window declaration was ` +
            'left out. Add it in Logi-Sys if the participating agency needs it.',
        );
      }
      continue;
    }

    // ICES: "The Value is to be provided in either Code, Text or Msr and not in
    // more than one field" (errors 456 / 458 / 460 / 489). The measure is the
    // SUQC row's alone; every other family carries a code or text, and Logi-Sys
    // writes 0.000000 with a blank unit on those rows rather than nothing.
    const carriesMeasure = qualifier === 'SQC';
    if (!carriesMeasure && (row.measurement || row.unit)) {
      ctx.warn(
        'SW_ADDL_INFO',
        `Item ${row.invoiceSrNo ?? 1}/${row.itemSlNo}: a measurement was recorded against ` +
          `qualifier ${qualifier}, which carries a code or text instead. It was left out ` +
          '(ICES 456/458).',
      );
    }

    out.push({
      Inv_SrNo: int(row.invoiceSrNo ?? 1),
      Item_SrNo: int(row.itemSlNo),
      Info_Type: code(infoType),
      info_Qualifier: code(qualifier),
      Info_Code_Description: code(row.code),
      Information: text(row.information),
      // Logi-Sys writes 0.000000 rather than nothing on the rows that carry no
      // measurement — the CPC, CAS and IUPAC rows of its own export.
      Measure: carriesMeasure ? orElse(qty(row.measurement), qty(0)) : qty(0),
      Measure_Unit: carriesMeasure ? code(row.unit) : BLANK,
    });
  }

  return out;
}
