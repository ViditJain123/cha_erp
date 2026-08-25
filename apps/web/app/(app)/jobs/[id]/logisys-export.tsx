'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Export to Logi-Sys.
 *
 * This used to be a bare `<a href>`, which meant two things went unseen: the
 * exporter's warnings about columns it could not fill were written to the job
 * event and never shown, and any error rendered as raw JSON in the browser.
 * For a customs filing the quiet failure is the expensive one — an incomplete
 * Bill of Entry that looks like a complete one — so the download goes through
 * fetch and reports what came back with it.
 *
 * It also used to offer "read documents" only until a draft existed, and the
 * download button forever after. Both halves of the pipeline are repeatable on
 * the server — drafts are versioned rather than overwritten, and every export
 * builds a fresh workbook and files its own row — so that was the UI hiding a
 * capability rather than the system lacking one. It mattered: a job read before
 * a mapping fix could never be re-read, so the only way to pick up the fix was
 * a new job. Both actions are now available whenever a draft exists.
 */
export function LogisysExport({
  jobId,
  hasDraft,
  draftVersion,
  documentCount,
}: {
  jobId: string;
  hasDraft: boolean;
  draftVersion?: number | null;
  documentCount?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'reading' | 'building'>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function begin(phase: 'reading' | 'building') {
    setBusy(phase);
    setError(null);
    setWarnings(null);
    setNote(null);
  }

  /** Read the job's documents into a new draft version. Returns false on failure. */
  async function readDocuments(): Promise<boolean> {
    const res = await fetch(`/api/jobs/${jobId}/draft`, { method: 'POST' });
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'Could not read the documents.');
      return false;
    }
    const { version } = (await res.json()) as { version?: number };
    if (version) setNote(`Read the documents again — this is revision ${version} of the draft.`);
    return true;
  }

  /** Build the workbook from the latest draft and hand it to the browser. */
  async function downloadWorkbook(): Promise<boolean> {
    const res = await fetch(`/api/jobs/${jobId}/export`);
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'Export failed.');
      return false;
    }

    const header = res.headers.get('x-logisys-warnings');
    if (header) {
      const list = JSON.parse(decodeURIComponent(header)) as string[];
      if (list.length) setWarnings(list);
    }

    const blob = await res.blob();
    const name =
      /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
      'logisys.xlsx';

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }

  /** Just the workbook, from the draft as it stands. */
  async function download() {
    begin('building');
    try {
      await downloadWorkbook();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** The whole pipeline: read the documents afresh, then export what that gives. */
  async function redo() {
    begin('reading');
    setConfirming(false);
    try {
      // The draft is filed either way. If the export then refuses — a tariff
      // code the new reading could not resolve, a line that stopped
      // reconciling — that refusal is about this new revision, and the refresh
      // below has to happen so the page shows it.
      if (!(await readDocuments())) return;
      setBusy('building');
      await downloadWorkbook();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  /** First read, for a job that has never been read. */
  async function firstRead() {
    begin('reading');
    try {
      await readDocuments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const primary =
    'inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50';
  const secondary =
    'inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

  /**
   * What the wait looks like while it happens.
   *
   * This is rendered in the same place the confirmation panel was, because the
   * first version put it nowhere: confirming dismissed the panel containing the
   * button just pressed, and the only remaining sign of life was a label swap
   * on a greyed-out secondary button further up. Reading is one model call per
   * document and the route allows five minutes for it, so silence for that long
   * reads as a dead button — which is exactly how it was reported.
   */
  const progress = busy && (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800"
    >
      <span
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-700"
      />
      <div>
        <p className="font-medium">
          {busy === 'reading'
            ? `Reading ${documentCount ? `${documentCount} ` : ''}document${documentCount === 1 ? '' : 's'}…`
            : 'Building the workbook…'}
        </p>
        <p className="mt-0.5 text-indigo-700">
          {busy === 'reading'
            ? 'One model call per document, so this usually takes a minute or two. Keep this page open — the download starts on its own when the reading is done.'
            : 'Almost there. The file will download when it is ready.'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {hasDraft ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={download} disabled={busy !== null} className={primary}>
              {busy === 'building' ? 'Building…' : 'Download spreadsheet'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy !== null || confirming}
              className={secondary}
            >
              {busy === 'reading' ? 'Reading documents…' : 'Read and export again'}
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Download builds the workbook again from the reading already on file
            {draftVersion ? ` (revision ${draftVersion})` : ''}. Read and export again starts over
            from the documents themselves.
          </p>

          {progress}

          {confirming && !busy && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="mb-2">
                This reads every document on the job again — one model call each — and files the
                result as a new draft revision. Nothing is overwritten: the revision you have now
                stays on record, so a Bill of Entry filed from it is still reconstructible.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={redo} className={primary}>
                  Read and export again
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={firstRead} disabled={busy !== null} className={primary}>
            {busy ? 'Reading documents…' : 'Read documents'}
          </button>
          <p className="text-xs text-slate-500">
            The spreadsheet is built from the job&rsquo;s documents. Read them once, then export.
          </p>
          {progress}
        </div>
      )}

      {note && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p>{note}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p className="whitespace-pre-line">{error}</p>
        </div>
      )}

      {warnings && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="mb-1 font-medium">
            Downloaded, but {warnings.length} field{warnings.length === 1 ? '' : 's'} could not be
            filled — complete {warnings.length === 1 ? 'it' : 'them'} in Logi-Sys:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
