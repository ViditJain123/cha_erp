'use client';

import { useActionState, useState } from 'react';
import { saveEsanchitReference } from './actions';
import { Note, SMALL_FIELD, BUTTON, type ActionNote } from './ui';

/**
 * The eSanchit reference for one document — the IRN and its upload timestamp.
 *
 * These two are the only things on SUPPORTING_DOCS that nothing in this system
 * can derive: ICEGATE generates the IRN when the signed PDF is uploaded, and it
 * exists nowhere else. A document without one is not referenced on the workbook
 * at all, because a row whose IRN we invented points at nothing.
 *
 * See docs/boe-mapping/18-supporting-docs.md.
 */
export function EsanchitReference({
  jobId,
  documentId,
  irn,
  uploadedAt,
  referenceNo,
}: {
  jobId: string;
  documentId: string;
  irn: string;
  uploadedAt: string;
  referenceNo: string;
}) {
  const [state, action, pending] = useActionState<ActionNote, FormData>(saveEsanchitReference, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-indigo-600 hover:underline">
        {irn ? `eSanchit ${irn}` : 'Add eSanchit IRN'}
      </button>
    );
  }

  return (
    <form action={action} className="mt-1 space-y-1">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="documentId" value={documentId} />
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          name="irn"
          defaultValue={irn}
          placeholder="16-digit IRN"
          className={SMALL_FIELD}
          size={18}
        />
        <input
          type="datetime-local"
          name="uploadedAt"
          defaultValue={uploadedAt}
          className={SMALL_FIELD}
        />
        <input
          name="referenceNo"
          defaultValue={referenceNo}
          placeholder="reference no."
          maxLength={17}
          className={SMALL_FIELD}
          size={14}
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="text-[10px] text-slate-400">
        The IRN starts with the date it was issued, so it and the upload time have to agree. Clear
        it to take the document back off the workbook.
      </p>
      <Note state={state} />
    </form>
  );
}
