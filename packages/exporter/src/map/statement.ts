import { BLANK, code, int } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * The declarations Logi-Sys files with every Bill of Entry, and what each is
 * about.
 *
 * Taken from the workbook Logi-Sys exported for job I-10793, which carries
 * exactly these six rows. The scope is not decoration: the `Inv_SrNo` /
 * `Item_SrNo` pair is what says whether a declaration covers the whole filing,
 * one invoice, or one line — `CUG00` sits at (0,0) because it is job-wide,
 * `CUV01` at (1,0) because it is about invoice 1's valuation, and `PC002` at
 * (1,1) because it is about that invoice's first product.
 */
const DECLARATIONS: { code: string; scope: 'job' | 'invoice' | 'item' }[] = [
  { code: 'CUG00', scope: 'job' },
  { code: 'CUG01', scope: 'job' },
  { code: 'CUV01', scope: 'invoice' },
  { code: 'CUV02', scope: 'invoice' },
  { code: 'CUV03', scope: 'invoice' },
  // CONFIRM: only ever seen on a single-item job, where (1,1) is consistent
  // with both "once per filing" and "once per line". Read as per-line, because
  // an item-scoped declaration that named only item 1 on a six-line Bill of
  // Entry would be under-declaring the other five.
  { code: 'PC002', scope: 'item' },
];

/** STATEMENT — the standing declarations that accompany the Bill of Entry. */
export function statementRows(ctx: MapContext): SheetRow[] {
  const rows: SheetRow[] = [];

  const row = (invSrNo: number, itemSrNo: number, statementCode: string): SheetRow => ({
    Inv_SrNo: int(invSrNo),
    Item_SrNo: int(itemSrNo),
    StatementType: code('DEC'),
    StatementCode: code(statementCode),
    StatementRemarks: BLANK,
  });

  for (const declaration of DECLARATIONS) {
    switch (declaration.scope) {
      case 'job':
        rows.push(row(0, 0, declaration.code));
        break;
      case 'invoice':
        rows.push(row(1, 0, declaration.code));
        break;
      case 'item':
        for (const item of ctx.draft.items) rows.push(row(1, item.slNo, declaration.code));
        break;
    }
  }

  return rows;
}
