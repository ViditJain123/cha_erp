import { ESANCHIT_DOC_CODES } from '@checklist/core';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SUPPORTING_DOCS — the eSanchit document list, which we deliberately do not fill.
 *
 * Logi-Sys makes ten columns mandatory on every row of this sheet, and two of
 * them — `Doc_IRN` and `Doc_Upload_DateTime` — are issued by eSanchit at the
 * moment the document is uploaded. Nothing we know at export time can satisfy
 * them, and `Item_SrNo` is mandatory too on a sheet whose rows are
 * document-level rather than item-level. A three-document job produced 33 of
 * the 43 rejections on the first upload.
 *
 * So the sheet stays header-only and the documents are attached through
 * eSanchit/Logi-Sys instead. This function exists to say so out loud, and to
 * tell the operator which files are waiting.
 */
export function supportingDocsRows(ctx: MapContext): SheetRow[] {
  const docs = ctx.draft.supportingDocs;
  if (docs.length) {
    const names = docs
      .map((doc) => `${ESANCHIT_DOC_CODES[doc.docType]?.name ?? doc.docType} (${doc.fileName})`)
      .join(', ');
    ctx.warn(
      'SUPPORTING_DOCS',
      `${docs.length} supporting document${docs.length === 1 ? '' : 's'} are not listed in the ` +
        `workbook — Logi-Sys requires the eSanchit IRN and upload timestamp on every row, and ` +
        `those only exist once the file is uploaded. Attach them in eSanchit: ${names}.`,
    );
  }

  return [];
}
