'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { matchArrivedDocuments, setRequestStatus, type JobActionState } from './actions';

const EMPTY: JobActionState = {};

export interface DocumentRequest {
  id: string;
  name: string;
  reason: string | null;
  ccrCode: string | null;
  status: 'pending' | 'received' | 'waived';
  /** The document this request was settled against, once one exists. */
  documentId: string | null;
  documentName: string | null;
}

const STATUS_STYLES: Record<DocumentRequest['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-800',
  waived: 'bg-slate-200 text-slate-600',
};

const BUTTON =
  'rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60';

function RequestRow({ jobId, request }: { jobId: string; request: DocumentRequest }) {
  const [state, formAction, pending] = useActionState(setRequestStatus, EMPTY);
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * Uploading settles the request in one go, so there is no separate "now mark
   * it received" step to forget. Fires straight off the picker.
   */
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`/api/jobs/${jobId}/requests/${request.id}/document`, {
      method: 'POST',
      body,
    });
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
          <div className="text-sm font-medium">{request.name}</div>
          {request.reason && <div className="mt-0.5 text-xs text-slate-500">{request.reason}</div>}
          {request.ccrCode && (
            <div className="mt-0.5 font-mono text-xs text-slate-400">{request.ccrCode}</div>
          )}
          {request.documentId && (
            <a
              href={`/api/jobs/${jobId}/documents/${request.documentId}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-xs text-indigo-600 hover:underline"
            >
              {request.documentName ?? 'Attached document'}
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[request.status]}`}
          >
            {request.status}
          </span>
          {request.status === 'pending' && (
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
            <input type="hidden" name="requestId" value={request.id} />
            {request.status === 'pending' ? (
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
        </div>
      </div>
      {(state.error ?? uploadError) && (
        <div className="mt-2 text-xs text-red-600">{state.error ?? uploadError}</div>
      )}
    </li>
  );
}

export function DocumentRequests({
  jobId,
  requests,
}: {
  jobId: string;
  requests: DocumentRequest[];
}) {
  const [matchState, matchAction, matching] = useActionState(matchArrivedDocuments, EMPTY);

  if (requests.length === 0) return null;

  const outstanding = requests.filter((r) => r.status === 'pending').length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">Documents to obtain</h2>
        <div className="flex items-center gap-3">
          {outstanding > 0 && (
            <form action={matchAction}>
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                disabled={matching}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                {matching ? 'Checking…' : 'Check what has arrived'}
              </button>
            </form>
          )}
          <span className="text-xs text-slate-500">
            {requests.length - outstanding} of {requests.length} settled
          </span>
        </div>
      </div>
      {(matchState.error ?? matchState.message) && (
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-600">
          {matchState.error ?? matchState.message}
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {requests.map((request) => (
          <RequestRow key={request.id} jobId={jobId} request={request} />
        ))}
      </ul>
      {outstanding === 0 && (
        <div className="border-t border-slate-100 bg-emerald-50 px-5 py-3 text-xs text-emerald-800">
          Nothing outstanding. The checklist can go back for revision.
        </div>
      )}
    </section>
  );
}
