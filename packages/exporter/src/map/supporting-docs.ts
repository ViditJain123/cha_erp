import { chaProfile, ESANCHIT_DOC_CODES } from '@checklist/core';
import type { DraftSupportingDoc } from '@checklist/extraction';
import { BLANK, code, int, isoDate, isoDateTime, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SUPPORTING_DOCS — the eSanchit document list.
 *
 * ICES `<TABLE>SUPPORTINGDOCS` (BE Message format 2.25, CACHI01 Part 24/24),
 * which the spec makes "mandatory for all Bills of Entry".
 * Contract: docs/boe-mapping/18-supporting-docs.md.
 *
 * **Nothing here is a document — every row is a pointer to one ICEGATE already
 * holds.** `Doc_IRN` is the number eSanchit issues when the signed PDF is
 * uploaded, and a row whose IRN we invented points at nothing. So a document
 * without one files no row and warns instead, naming the file.
 *
 * This mapper used to return `[]` unconditionally, because `Doc_IRN`,
 * `Doc_Upload_DateTime` and `Item_SrNo` looked unknowable and a three-document
 * job produced 33 of the 43 rejections on the first upload. Seven Logi-Sys
 * exports answer all three: the serials are `0`/`0` for a shipment-level
 * document, exactly as STATEMENT uses them, and the IRN and timestamp exist
 * before the workbook is built because the documents are uploaded *first* and
 * the Bill of Entry is filed against them.
 *
 * Logi-Sys' uploader is stricter than ICES and makes eleven columns mandatory
 * (the real ErrorList): `Item_SrNo`, `Doc_IRN`, `Doc_Upload_DateTime`,
 * `Reference_No.`, `Doc_Issued_At`, `Doc_Issued_Date`, the two issuing-party
 * columns and the two beneficiary-party ones.
 */
export function supportingDocsRows(ctx: MapContext): SheetRow[] {
  const docs = ctx.draft.supportingDocs ?? [];
  if (!docs.length) return [];

  const icegateId = chaProfile().icegateId;
  if (!icegateId) {
    ctx.blocker(
      'SUPPORTING_DOCS',
      'No ICEGATE user ID on the CHA profile. It is mandatory on every row of this sheet and is one ' +
        'value for the whole filing, so the documents cannot be referenced without it.',
    );
    return [];
  }

  const importer = ctx.draft.importer;
  const rows: SheetRow[] = [];
  const waiting: string[] = [];

  for (const doc of docs) {
    if (!doc.irn || !doc.uploadedAt) {
      waiting.push(`${ESANCHIT_DOC_CODES[doc.docType]?.name ?? doc.docType} (${doc.fileName})`);
      continue;
    }

    const docTypeCode = ESANCHIT_DOC_CODES[doc.docType]?.code;
    if (!docTypeCode) {
      ctx.warn(
        'SUPPORTING_DOCS',
        `No eSanchit document-type code for "${doc.docType}" (${doc.fileName}), so it is not ` +
          'referenced on the workbook. A wrong six-digit code tells Customs the document is ' +
          'something it is not — add it in Logi-Sys.',
      );
      continue;
    }

    checkIrnAgainstTimestamp(ctx, doc);

    if (!doc.referenceNo) {
      ctx.warn(
        'SUPPORTING_DOCS',
        `No reference number for ${doc.fileName}. Logi-Sys makes this column mandatory even though ` +
          'ICES does not — for an invoice it is the invoice number, for a licence or certificate ' +
          'that document’s own number. Key it in Logi-Sys.',
      );
    }

    rows.push({
      // `0`/`0` is how this sheet says "the whole Bill of Entry", as ex_job31's
      // bill of lading and DGCA NOCs do.
      Inv_SrNo: int(doc.invoiceSrNo ?? 0),
      Item_SrNo: int(doc.itemSrNo ?? 0),
      Doc_ICEGATE_ID: code(icegateId),
      Doc_IRN: code(doc.irn),
      Doc_Upload_DateTime: isoDateTime(doc.uploadedAt),
      Doc_Type: code(docTypeCode),
      File_Type: text(fileExtension(doc.fileName)),
      Icegate_File_Name: text(doc.fileName),
      Document_Name: text(doc.fileName),
      // C(17), and the width bites: ex_job31 holds a document name truncated to
      // exactly seventeen characters.
      'Reference_No.': code(doc.referenceNo?.slice(0, 17)),
      Doc_Issued_At: text(doc.issuedAt),
      Doc_Issued_Date: isoDate(doc.issueDate),
      Doc_Expiry_Date: isoDate(doc.expiryDate),
      Doc_Issuing_Party_Name: text(doc.issuingParty?.name),
      // Both party-code columns are the IE Code and both are explicitly "not
      // validated" by ICES. Every vendor row leaves them blank; so do we.
      Doc_Issuing_Party_Code: BLANK,
      Doc_Issuing_Party_Add1: text(doc.issuingParty?.address1),
      Doc_Issuing_Party_Add2: text(doc.issuingParty?.address2),
      Doc_Issuing_Party_City: text(doc.issuingParty?.city),
      Doc_Issuing_Party_Pin_Code: code(doc.issuingParty?.postalCode),
      // The beneficiary of a document on an import Bill of Entry is the importer.
      Doc_Beneficiary_Party_Name: text(importer?.name),
      Doc_Beneficiary_Party_Code: BLANK,
      Doc_Beneficiary_Party_Add1: text(importer?.addressLines?.[0]),
      Doc_Beneficiary_Party_Add2: text(importer?.addressLines?.[1]),
      Doc_Beneficiary_Party_City: text(importer?.city),
      Doc_Beneficiary_Party_Pin_Code: BLANK,
    });
  }

  if (waiting.length) {
    ctx.warn(
      'SUPPORTING_DOCS',
      `${waiting.length} supporting document${waiting.length === 1 ? ' is' : 's are'} not listed in ` +
        'the workbook — Logi-Sys requires the eSanchit IRN and upload timestamp on every row, and ' +
        `those only exist once the file is uploaded. Upload ${waiting.length === 1 ? 'it' : 'them'} ` +
        `in eSanchit and record the IRN: ${waiting.join(', ')}.`,
    );
  }

  return rows;
}

/**
 * An eSanchit IRN carries its own upload date: `2026081400154694` is
 * `YYYYMMDD` plus an eight-digit serial. When that disagrees with the timestamp
 * beside it, one of the two was pasted against the wrong document.
 */
function checkIrnAgainstTimestamp(ctx: MapContext, doc: DraftSupportingDoc): void {
  const irnDate = doc.irn?.slice(0, 8);
  const stamp = doc.uploadedAt?.slice(0, 10).replace(/-/g, '');
  if (irnDate && stamp && /^\d{8}$/.test(irnDate) && irnDate !== stamp) {
    ctx.warn(
      'SUPPORTING_DOCS',
      `The eSanchit IRN for ${doc.fileName} begins ${irnDate} but its upload timestamp is ` +
        `${doc.uploadedAt}. The IRN carries the upload date in its first eight digits, so one of ` +
        'the two belongs to a different document.',
    );
  }
}

/** `File_Type` — `pdf` in every vendor row. */
function fileExtension(fileName: string): string | undefined {
  const ext = fileName.split('.').pop();
  return ext && ext !== fileName ? ext.toLowerCase() : undefined;
}
