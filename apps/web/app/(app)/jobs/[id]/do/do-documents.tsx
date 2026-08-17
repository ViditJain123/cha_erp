'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDoDocument,
  removeDoDocument,
  setDoDocumentStatus,
  type DoActionState,
} from './actions';
import { BUTTON, Card, Note, SMALL_FIELD } from '../ui';

const EMPTY: DoActionState = {};

export interface DoDocumentRow {
  id: string;
  name: string;
  requiredFor: 'do' | 'hss';
  status: 'pending' | 'received' | 'waived';
  documentId: string | null;
  documentName: string | null;
}

const STATUS_STYLES: Record<DoDocumentRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-800',
  waived: 'bg-slate-200 text-slate-600',
};

function Row({ jobId, row }: { jobId: string; row: DoDocumentRow }) {
  const [state, formAction, pending] = useActionState(setDoDocumentStatus, EMPTY);
  const [removeState, removeAction, removing] = useActionState(removeDoDocument, EMPTY);
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** Uploading settles the row in one go — no separate "mark it received" to forget. */
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`/api/jobs/${jobId}/do/documents/${row.id}`, { method: 'POST', body });
    // Clear it either way: picking the same file twice must fire onChange again.
    input.value = '';
    setUploading(false);

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setUploadError(payload.error ?? 'Upload failed.');
      return;
    }
    router.refresh();
  }

  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{row.name}</div>
          {row.requiredFor === 'hss' && (
            <div className="mt-0.5 text-xs text-violet-600">High sea sales</div>
          )}
          {row.documentId && (
            <a
              href={`/api/jobs/${jobId}/documents/${row.documentId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-xs text-indigo-600 hover:underline"
            >
              {row.documentName ?? 'Attached document'}
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
          >
            {row.status}
          </span>
          {row.status === 'pending' && (
            <>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept="application/pdf,.pdf,image/jpeg,image/png,.doc,.docx,.xls,.xlsx"
                onChange={onFileChosen}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading || pending}
                className={BUTTON}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
          <form action={formAction} className="flex gap-1">
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="rowId" value={row.id} />
            {row.status === 'pending' ? (
              <>
                <button
                  type="submit"
                  name="status"
                  value="received"
                  disabled={pending || uploading}
                  className={BUTTON}
                >
                  Received
                </button>
                <button
                  type="submit"
                  name="status"
                  value="waived"
                  disabled={pending || uploading}
                  className={BUTTON}
                >
                  Not needed
                </button>
              </>
            ) : (
              <button
                type="submit"
                name="status"
                value="pending"
                disabled={pending}
                className={BUTTON}
              >
                Reopen
              </button>
            )}
          </form>
          <form action={removeAction}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="rowId" value={row.id} />
            <button
              type="submit"
              disabled={removing}
              aria-label={`Remove ${row.name}`}
              className="px-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-60"
            >
              ×
            </button>
          </form>
        </div>
      </div>
      {(state.error ?? removeState.error ?? uploadError) && (
        <div className="mt-2 text-xs text-red-600">
          {state.error ?? removeState.error ?? uploadError}
        </div>
      )}
    </li>
  );
}

export function DoDocuments({
  jobId,
  rows,
  isHighSeaSale,
}: {
  jobId: string;
  rows: DoDocumentRow[];
  isHighSeaSale: boolean;
}) {
  const [state, formAction, pending] = useActionState(addDoDocument, EMPTY);

  // The active set follows the flag: a job that is not a high sea sale does not
  // have to chase HSS paperwork to move on.
  const active = isHighSeaSale ? rows : rows.filter((r) => r.requiredFor === 'do');
  const outstanding = active.filter((r) => r.status === 'pending').length;

  return (
    <Card
      title="Documents the line wants"
      step={4}
      done={active.length > 0 && outstanding === 0}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          There is no master of what each line asks for yet, so list them here as you go.
        </p>
      ) : (
        <>
          <div className="mb-2 text-xs text-slate-500">
            {active.length - outstanding} of {active.length} settled
          </div>
          <ul className="-mx-5 divide-y divide-slate-100 border-y border-slate-100">
            {rows.map((row) => (
              <Row key={row.id} jobId={jobId} row={row} />
            ))}
          </ul>
        </>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input
          name="name"
          placeholder="Delivery order request letter"
          required
          className={`min-w-56 flex-1 ${SMALL_FIELD}`}
        />
        <select name="requiredFor" defaultValue="do" className={SMALL_FIELD}>
          <option value="do">For the DO</option>
          <option value="hss">For high sea sales</option>
        </select>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </form>

      <Note state={state} />
    </Card>
  );
}
