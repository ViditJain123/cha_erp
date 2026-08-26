'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Delete a job.
 *
 * The only irreversible action on this screen, so it is the only one that makes
 * you type something. The confirmation is the job's own number — or its title
 * where there is no number yet — because the mistake worth stopping is not "did
 * not mean to click delete", it is "meant to delete a different job". A yes/no
 * dialog catches the first and not the second.
 *
 * It sits at the bottom of the sidebar, apart from the working controls, and
 * stays collapsed until asked for.
 */
export function DeleteJob({
  jobId,
  label,
  counts,
}: {
  jobId: string;
  /** What the user has to type: the job number, or the title as a fallback. */
  label: string;
  counts: { documents: number; drafts: number; exports: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim() === label.trim();

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        // The route checks this against the job it loaded, so a stale id in an
        // open tab cannot delete whatever now sits at that URL.
        body: JSON.stringify({ confirm: jobId, reason }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? 'Could not delete this job.');
        return;
      }
      // Nothing here to go back to.
      router.push('/jobs');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const attached = [
    counts.documents && `${counts.documents} document${counts.documents === 1 ? '' : 's'}`,
    counts.drafts && `${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}`,
    counts.exports && `${counts.exports} export${counts.exports === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];

  if (!open) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Delete job</h2>
        <p className="mb-4 text-xs text-slate-500">
          Removes the job, its documents and every checklist generated from it. There is no undo.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-block rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete this job
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-red-800">Delete job</h2>

      <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
        This permanently deletes the job
        {attached.length ? <> and its {attached.join(', ')}</> : null}, including the files in
        storage. It cannot be undone.
      </p>

      <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="confirm-delete">
        Type <span className="font-mono text-slate-900">{label}</span> to confirm
      </label>
      <input
        id="confirm-delete"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
      />

      <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="delete-reason">
        Reason <span className="font-normal text-slate-400">(optional, kept on the record)</span>
      </label>
      <input
        id="delete-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Documents were uploaded against the wrong shipment"
        className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {error ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={!matches || busy}
          className="inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped('');
            setError(null);
          }}
          disabled={busy}
          className="inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
