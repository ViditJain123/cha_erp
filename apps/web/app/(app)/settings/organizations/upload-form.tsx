'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ImportResult {
  rowCount: number;
  inserted: number;
  updated: number;
  retired: number;
  warnings: string[];
}

const PRIMARY =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';

/**
 * Uploads the Organization Repository export.
 *
 * Not a server action, because the file is a megabyte and a half of xlsx and
 * the body-size ceiling on an action is lower than that. It goes to a route
 * handler, like every other upload in the app.
 */
export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload(formData: FormData) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/organizations/import', { method: 'POST', body: formData });
      const body = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'The import failed.');
        return;
      }
      setResult(body);
      if (input.current) input.current.value = '';
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Upload the repository</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        In Logi-Sys, open the Organization Repository and export it as XLSX, then upload the file
        here. It is read as a full snapshot: parties in the file are added or updated, and parties
        no longer in it are marked inactive rather than deleted, so jobs already filed keep
        resolving.
      </p>
      <form action={upload} className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          name="file"
          required
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50"
        />
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? 'Loading…' : 'Upload'}
        </button>
        {busy && (
          <span className="text-sm text-slate-500">
            Five thousand parties takes a few seconds.
          </span>
        )}
      </form>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Read {result.rowCount.toLocaleString()} organizations: {result.inserted.toLocaleString()}{' '}
          added, {result.updated.toLocaleString()} updated, {result.retired.toLocaleString()}{' '}
          retired.
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-900">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
