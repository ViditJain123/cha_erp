import { declarationStatements, singleWindowRuleForChapter } from '@checklist/core';
import { BLANK, code, int } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * STATEMENT — the declarations filed with the Bill of Entry (ICES CACHI01 Part
 * 23). docs/boe-mapping/07-statement.md is the contract.
 *
 * Derived here from the draft as it stands, never read from
 * `draft.declarations`: a stored draft carries the codes without their scope,
 * and an operator's edit to a tariff code or an exemption changes which
 * declarations apply. The rules themselves live in `declarationStatements`.
 *
 * The `Inv_SrNo` / `Item_SrNo` pair is the scope: (0,0) for the whole filing,
 * (inv,0) for one invoice, (inv,item) for one line.
 */
export function statementRows(ctx: MapContext): SheetRow[] {
  const statements = declarationStatements(ctx.draft);

  // A PGA-regulated line may need REM rows explaining a mandatory document that
  // is not uploaded. Which documents are mandatory for a CTH is not in any
  // master, so this is left to the operator rather than guessed.
  const regulated = ctx.draft.items.filter((item) => {
    const chapter = Number(item.ritc.replace(/\D/g, '').slice(0, 2));
    return chapter > 0 && singleWindowRuleForChapter(chapter);
  });
  if (regulated.length) {
    ctx.warn(
      'STATEMENT',
      `Item${regulated.length > 1 ? 's' : ''} ${regulated.map((i) => `${i.invoiceSrNo}/${i.slNo}`).join(', ')} ` +
        'fall under a participating government agency. If a mandatory supporting document for the ' +
        'CTH is not being uploaded, add a REM statement naming its document code and the reason in Logi-Sys.',
    );
  }

  return statements.map((s) => ({
    Inv_SrNo: int(s.invSrNo),
    Item_SrNo: int(s.itemSrNo),
    StatementType: code(s.type),
    StatementCode: code(s.code),
    StatementRemarks: BLANK,
  }));
}
