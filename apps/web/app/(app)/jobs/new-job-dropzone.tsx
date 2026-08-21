'use client';

import { useCallback, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DOC_TYPE_LABELS, type DocumentType } from '@/lib/document-types';

const MAX_FILES = 15;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Mirrors the bucket's allowed types — anything else is refused at the route. */
const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,application/pdf,image/jpeg,image/png';

interface UploadedFileResult {
  fileName: string;
  docType: DocumentType;
  duplicate: boolean;
}

interface UploadResponse {
  outcome: 'created_job' | 'attached' | 'ambiguous';
  jobId?: string;
  documentsAdded: number;
  documentsDuplicate: number;
  files: UploadedFileResult[];
  candidates?: { id: string; label: string }[];
  error?: string;
}

function kb(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Opening a job without a mailbox.
 *
 * The watcher is the intended way in, but a company that has not connected
 * Outlook — or was handed a folder of scans off WhatsApp — would otherwise have
 * no way to start at all. Dropped documents go through exactly the same triage
 * the watcher runs, so the job that comes out is the same shape either way.
 */
export function NewJobDropzone({
  /** Governs the copy only: without a mailbox this is the only way in. */
  mailboxConnected,
  startOpen,
}: {
  mailboxConnected: boolean;
  startOpen: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(startOpen);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    setError(null);
    setResult(null);
    setFiles((prev) => {
      // Name and size together: two different documents genuinely can share a
      // file name ("invoice.pdf"), and dropping the same folder twice should
      // not double it up.
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const next = [...prev];
      for (const file of Array.from(incoming)) {
        if (file.size === 0 || seen.has(`${file.name}:${file.size}`)) continue;
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name} is larger than 25 MB.`);
          continue;
        }
        if (next.length >= MAX_FILES) {
          setError(`Only ${MAX_FILES} documents at a time.`);
          break;
        }
        seen.add(`${file.name}:${file.size}`);
        next.push(file);
      }
      return next;
    });
  }, []);

  async function submit() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    const body = new FormData();
    for (const file of files) body.append('files', file);

    try {
      const res = await fetch('/api/jobs', { method: 'POST', body });
      const payload = (await res.json().catch(() => ({}))) as UploadResponse;

      if (!res.ok) {
        setError(payload.error ?? 'Could not read those documents.');
        return;
      }

      if (payload.outcome === 'created_job' && payload.jobId) {
        // Straight through to the job: there is nothing to read back that the
        // job page does not show better.
        router.push(`/jobs/${payload.jobId}`);
        return;
      }

      // Attached to an existing job, or too close to call. Both need saying
      // out loud rather than a silent redirect somewhere unexpected.
      setResult(payload);
      setFiles([]);
      router.refresh();
    } catch {
      setError('The upload did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New job from documents
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Start a job from documents</h2>
          <p className="mt-1 text-sm text-slate-500">
            {mailboxConnected
              ? 'For documents that never came through the mailbox — handed over at the desk, or sent on WhatsApp.'
              : 'Drop everything you were sent for the shipment — invoice, B/L or AWB, packing list, certificates. They are read and classified the same way a connected mailbox reads them.'}
          </p>
        </div>
        {!startOpen && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            Close
          </button>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) addFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`mt-4 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragging
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-slate-300 bg-slate-50 hover:border-indigo-400'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div aria-hidden className="text-3xl">
          📄
        </div>
        <p className="mt-2 text-sm font-medium text-slate-700">
          Drag the job&rsquo;s documents here
        </p>
        <p className="mt-1 text-xs text-slate-500">
          PDF, photographs, Word or Excel · up to {MAX_FILES} files · or click to browse
        </p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            // Cleared so removing a file and re-picking the same one still
            // fires a change event.
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {files.map((file) => (
            <li
              key={`${file.name}:${file.size}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                {file.name} <span className="text-slate-400">({kb(file.size)})</span>
              </span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}
                className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && <ResultPanel result={result} />}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || files.length === 0}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy
            ? 'Reading the documents…'
            : `Create job from ${files.length || 'these'} document${files.length === 1 ? '' : 's'}`}
        </button>
        {busy && (
          <span className="text-xs text-slate-500">
            Each document is classified before the job opens — this takes a moment.
          </span>
        )}
      </div>
    </section>
  );
}

/** What happened when the batch did not simply open a new job. */
function ResultPanel({ result }: { result: UploadResponse }) {
  if (result.outcome === 'ambiguous') {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <div className="font-medium">These documents match more than one job.</div>
        <p className="mt-1">
          Nothing was saved. Opening a job here would merge two shipments, which cannot be undone —
          open the right one and add the documents there.
        </p>
        {result.candidates && result.candidates.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {result.candidates.map((candidate) => (
              <li key={candidate.id}>
                <Link
                  href={`/jobs/${candidate.id}`}
                  className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  {candidate.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
      <div className="font-medium">These documents belong to a job you already have.</div>
      <p className="mt-1">
        {result.documentsAdded} added
        {result.documentsDuplicate > 0 && `, ${result.documentsDuplicate} already on file`}.
      </p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {result.files.map((file) => (
          <li key={file.fileName}>
            {file.fileName} — {DOC_TYPE_LABELS[file.docType]}
            {file.duplicate && ' (already on file)'}
          </li>
        ))}
      </ul>
      {result.jobId && (
        <Link
          href={`/jobs/${result.jobId}`}
          className="mt-2 inline-block rounded-lg border border-emerald-300 bg-white px-2 py-1 text-xs font-medium hover:bg-emerald-100"
        >
          Open the job
        </Link>
      )}
    </div>
  );
}
