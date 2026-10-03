import { singleWindowRuleForChapter } from '@checklist/core';
import { int, isoDate, qty, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SW_PRODUCTION — Single Window batch details.
 *
 * ICES `<TABLE>BE_ITEM_SW_PROD` (BE Message format 2.25, CACHI01 Part 21/24).
 * **One row per (line × batch)**: the spec says "Production batch nos are
 * provided along with the consignments", plural, and a consignment of six lots
 * of one drug declares six rows. Contract: docs/boe-mapping/13-sw-production.md.
 *
 * Scope is the PGA, not the chapter: mandatory for a Drug Controller case and
 * for FSSAI ("This table is applicable/Mandatory for FSSAI also"), and nothing
 * for anything else. That was the docstring long before it was the code — the
 * mapper used to emit for any line carrying a batch number, which is most of
 * them, because a certificate of analysis states lots for lubricants and resins
 * too. It cost 34 of the corpus's warnings, every one of them on a chapter with
 * no participating agency: 39, 34, 29, 27, 17, 12. Logi-Sys agrees — its own
 * export ships this sheet empty on all eight jobs we can compare against,
 * including the five that carry batch numbers.
 *
 * So a line is considered here only when `singleWindowRuleForChapter` knows an
 * agency for its chapter, the same gate `statement.ts` and `single-window.ts`
 * already use. `SINGLE_WINDOW_RULES` is incomplete — it holds FSSAI and no
 * Drug Controller entry — so this under-declares rather than over-declares
 * today. That is the right way round: a batch row Logi-Sys did not want is a
 * rejected upload, and the fix for the missing agency is the master, not a
 * guess here.
 *
 * A row is all-or-nothing. Logi-Sys makes the manufacture, expiry **and
 * best-before** dates mandatory on every row — stricter than ICES, which marks
 * best-before optional — so a batch number without its dates cannot be declared
 * here at all. A certificate of analysis often gives the batch number and
 * nothing else, which is how a lubricant consignment ended up with two
 * half-filled rows and six rejections on the real ErrorList. Those rows are
 * dropped with a warning naming the batch rather than emitted incomplete.
 */
export function swProductionRows(ctx: MapContext): SheetRow[] {
  const rows: SheetRow[] = [];

  for (const item of ctx.draft.items) {
    const batches = item.batches ?? [];
    if (!batches.length) continue;

    const chapter = Number(item.ritc.replace(/\D/g, '').slice(0, 2));
    if (!(chapter > 0 && singleWindowRuleForChapter(chapter))) continue;

    for (const batch of batches) {
      const missing = [
        !batch.manufactureDate && 'manufacture',
        !batch.expiryDate && 'expiry',
        !batch.bestBeforeDate && 'best-before',
      ].filter(Boolean) as string[];

      if (missing.length) {
        ctx.warn(
          'SW_PRODUCTION',
          `Item ${item.invoiceSrNo}/${item.slNo} has batch ${batch.batchNo ?? '(unnumbered)'} but no ` +
            `${missing.join(' or ')} date, so its batch details were left out — Logi-Sys requires ` +
            'the manufacture, expiry and best-before dates on every row of this sheet. Add them in ' +
            'Logi-Sys if the consignment needs them.',
        );
        continue;
      }

      rows.push({
        Inv_SrNo: int(item.invoiceSrNo),
        Item_SrNo: int(item.slNo),
        Prod_Batch_ID: text(batch.batchNo),
        // N(16,6) in the spec. No vendor export holds a batch row, so the
        // precision is the spec's rather than an observed one.
        Prod_Batch_Quantity: qty(batch.quantity),
        Prod_Batch_Unit: text(batch.quantity != null ? item.unit : undefined),
        Prod_Manufacturer_Date: isoDate(batch.manufactureDate),
        Prod_Expiry_Date: isoDate(batch.expiryDate),
        // A quality date, not the safety date above. Writing the expiry into
        // this column — which this mapper used to do — declares a fact about
        // the pack that no document on the job supports.
        Prod_Best_before_Date: isoDate(batch.bestBeforeDate),
      });
    }

    // The lots have to account for the line. A shortfall is a missing batch and
    // a surplus is a wrong number; neither is ours to adjust.
    const declared = batches.reduce((sum, b) => sum + (b.quantity ?? 0), 0);
    if (declared > 0 && item.quantity != null && Math.abs(declared - item.quantity) > 0.000001) {
      ctx.warn(
        'SW_PRODUCTION',
        `Item ${item.invoiceSrNo}/${item.slNo} declares ${declared} ${item.unit} across its batches ` +
          `but ${item.quantity} ${item.unit} on the line. One batch is missing or one quantity is ` +
          'wrong — the sheet states what the documents say and does not reconcile them.',
      );
    }
  }

  return rows;
}
