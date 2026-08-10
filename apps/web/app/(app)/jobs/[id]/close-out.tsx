'use client';

import { useActionState } from 'react';
import {
  prepareFinalNotice,
  requestChecklistRevision,
  sendFinalNotice,
  type JobActionState,
} from './actions';

const EMPTY: JobActionState = {};

function Note({ state }: { state: JobActionState }) {
  if (state.error) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {state.error}
      </div>
    );
  }
  if (!state.message) return null;
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
      {state.message}
    </div>
  );
}

/**
 * The last two steps of scrutiny: get the checklist revised now that everything
 * is in, then tell the shipper it is final and hand the job on.
 */
export function CloseOut({
  jobId,
  outstanding,
  hasChecklist,
  shipperEmail,
  canSend,
}: {
  jobId: string;
  outstanding: number;
  hasChecklist: boolean;
  shipperEmail: string;
  canSend: boolean;
}) {
  const [revisionState, revisionAction, revising] = useActionState(
    requestChecklistRevision,
    EMPTY,
  );
  const [finalState, finalAction, sending] = useActionState(sendFinalNotice, EMPTY);
  const [draftState, draftAction, drafting] = useActionState(prepareFinalNotice, EMPTY);
  const draft = draftState.draft;

  if (outstanding > 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Closing out</h2>
        <p className="mt-1 text-xs text-slate-500">
          {outstanding} document(s) still outstanding. Once they are settled you can ask for a
          revised checklist and close the job out.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Closing out</h2>
      <p className="mt-1 text-xs text-slate-500">
        Everything asked for is in. Get the checklist updated, then tell the shipper it is final.
      </p>

      <div className="mt-4 space-y-4">
        <form action={revisionAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <button
            type="submit"
            disabled={revising}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            {revising ? 'Sending back…' : 'Ask for a revised checklist'}
          </button>
          <p className="mt-1 text-xs text-slate-400">
            Returns the job to the documents branch. Skip this if the checklist needs no change.
          </p>
        </form>
        <Note state={revisionState} />

        <div className="border-t border-slate-100 pt-4">
          {!draft ? (
            <form action={draftAction}>
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                disabled={drafting}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {drafting ? 'Writing…' : 'Tell the shipper it is final'}
              </button>
              <Note state={draftState} />
            </form>
          ) : (
            <form action={finalAction} className="space-y-3">
              <input type="hidden" name="jobId" value={jobId} />
              <div>
                <label htmlFor="finalTo" className="mb-1 block text-xs font-medium text-slate-600">
                  To
                </label>
                <input
                  id="finalTo"
                  name="to"
                  type="email"
                  required
                  defaultValue={shipperEmail}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label
                  htmlFor="finalSubject"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Subject
                </label>
                <input
                  id="finalSubject"
                  name="subject"
                  required
                  defaultValue={draft.subject}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="finalBody" className="mb-1 block text-xs font-medium text-slate-600">
                  Message
                </label>
                <textarea
                  id="finalBody"
                  name="body"
                  rows={9}
                  required
                  defaultValue={draft.body}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  name="attachChecklist"
                  defaultChecked={hasChecklist}
                  disabled={!hasChecklist}
                />
                Attach the latest checklist PDF
              </label>
              <button
                type="submit"
                disabled={sending || !canSend}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Send and finish scrutiny'}
              </button>
              <p className="text-xs text-slate-400">
                Sending marks scrutiny done and moves the job to noting.
              </p>
            </form>
          )}
          <Note state={finalState} />
        </div>
      </div>
    </section>
  );
}
