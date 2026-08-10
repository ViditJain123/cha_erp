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
 */
export function LogisysExport({ jobId, hasDraft }: { jobId: string; hasDraft: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  async function readDocuments() {
    setBusy(true);
    setError(null);
    setWarnings(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/draft`, { method: 'POST' });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? 'Could not read the documents.');
        return;
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    setError(null);
    setWarnings(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/export`);

      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? 'Export failed.');
        return;
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

      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {hasDraft ? (
        <button
          type="button"
          onClick={download}
          disabled={busy}
          className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Building…' : 'Download spreadsheet'}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={readDocuments}
            disabled={busy}
            className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Reading documents…' : 'Read documents'}
          </button>
          <p className="text-xs text-slate-500">
            The spreadsheet is built from the job&rsquo;s documents. Read them once, then export.
          </p>
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
