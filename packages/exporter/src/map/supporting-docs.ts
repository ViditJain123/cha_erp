import { ESANCHIT_DOC_CODES, chaProfile } from '@checklist/core';
import { BLANK, code, num, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SUPPORTING_DOCS — the eSanchit document list.
 *
 * Document-level rather than item-level, so `Item_SrNo` stays blank. The
 * issuing/beneficiary party blocks that Logi-Sys prints on its checklist come
 * from the eSanchit upload itself, not from us, so those columns are blank
 * here — we are declaring which documents exist, not re-declaring their
 * provenance.
 */
export function supportingDocsRows(ctx: MapContext): SheetRow[] {
  const icegateId = chaProfile().icegateId;

  return ctx.draft.supportingDocs.map((doc) => {
    const docCode = ESANCHIT_DOC_CODES[doc.docType];

    if (!docCode?.code) {
      ctx.warn(
        'SUPPORTING_DOCS.Doc_Type',
        `No eSanchit document-type code for "${doc.docType}" (${doc.fileName}).`,
      );
    }

    return {
      Inv_SrNo: num(1),
      Item_SrNo: BLANK,
      Doc_ICEGATE_ID: code(icegateId),
      Doc_IRN: BLANK,
      Doc_Upload_DateTime: BLANK,
      Doc_Type: code(docCode?.code),
      File_Type: text('pdf'),
      Icegate_File_Name: text(doc.fileName),
      Document_Name: text(docCode?.name),
    };
  });
}
