'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface BranchOption {
  id: string;
  name: string;
}

/**
 * The handover from the documents branch to scrutiny.
 *
 * On the first upload the job's details are captured alongside the PDF. A
 * revision only replaces the file — the branch and job number are already
 * settled by then.
 */
export function ChecklistUpload({
  jobId,
  branches,
  isRevision,
}: {
  jobId: string;
  branches: BranchOption[];
  isRevision: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Capture the element now: currentTarget is nulled once the handler
    // returns, so reading it after the await below would throw and skip the
    // refresh — leaving a successful upload invisible in the UI.
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose the checklist PDF first.');
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/jobs/${jobId}/checklist`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Upload failed.');
      setBusy(false);
      return;
    }

    formEl.reset();
    setBusy(false);
    router.refresh();
  }

  const needsBranches = !isRevision && branches.length === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {!isRevision && (
        <>
          <div>
            <label htmlFor="branchId" className="mb-1 block text-xs font-medium text-slate-600">
              Branch
            </label>
            <select
              id="branchId"
              name="branchId"
              required
              disabled={needsBranches}
              defaultValue=""
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50"
            >
              <option value="" disabled>
                {needsBranches ? 'No branches configured' : 'Choose a branch'}
              </option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            {needsBranches && (
              <p className="mt-1 text-xs text-amber-700">
                Add a branch under Settings → Branches first.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="jobNumber" className="mb-1 block text-xs font-medium text-slate-600">
                Job number
              </label>
              <input
                id="jobNumber"
                name="jobNumber"
                required
                placeholder="14075"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="eta" className="mb-1 block text-xs font-medium text-slate-600">
                ETA
              </label>
              <input
                id="eta"
                name="eta"
                type="date"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </>
      )}

      <div>
        <label htmlFor="file" className="mb-1 block text-xs font-medium text-slate-600">
          Checklist PDF
        </label>
        <input
          id="file"
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-slate-200"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || needsBranches}
        className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? 'Uploading…' : isRevision ? 'Upload revised checklist' : 'Upload and start scrutiny'}
      </button>
    </form>
  );
}
