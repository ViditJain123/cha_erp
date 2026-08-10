'use client';

import { useActionState, useState } from 'react';
import { applyCcrs, updateHsCodes, updateRemarks, type JobActionState } from './actions';

const EMPTY: JobActionState = {};

export interface CcrSuggestion {
  id: string;
  hsCode: string;
  code: string;
  title: string;
  requirementText: string;
}

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

export function ScrutinyPanel({
  jobId,
  hsCodes,
  suggestions,
  appliedCodes,
  remarks,
}: {
  jobId: string;
  hsCodes: string[];
  suggestions: CcrSuggestion[];
  appliedCodes: string[];
  remarks: string | null;
}) {
  const [hsState, hsAction, hsPending] = useActionState(updateHsCodes, EMPTY);
  const [ccrState, ccrAction, ccrPending] = useActionState(applyCcrs, EMPTY);
  const [remarksState, remarksAction, remarksPending] = useActionState(updateRemarks, EMPTY);
  const [showCcrs, setShowCcrs] = useState(appliedCodes.length === 0);

  const unapplied = suggestions.filter((s) => !appliedCodes.includes(s.code));

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">HS codes</h2>
        <p className="mt-1 text-xs text-slate-500">
          Read off the invoice at intake. Correct them if they are wrong — they decide which
          requirements apply.
        </p>
        <form action={hsAction} className="mt-3 flex gap-2">
          <input type="hidden" name="jobId" value={jobId} />
          <input
            id="hsCodes"
            name="hsCodes"
            defaultValue={hsCodes.join(', ')}
            placeholder="33049990, 33041000"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={hsPending}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            {hsPending ? 'Saving…' : 'Save'}
          </button>
        </form>
        <Note state={hsState} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Compliance requirements
            {appliedCodes.length > 0 && (
              <span className="ml-2 font-normal text-slate-500">{appliedCodes.length} applied</span>
            )}
          </h2>
          {!showCcrs && (
            <button
              type="button"
              onClick={() => setShowCcrs(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            >
              Add CCR
            </button>
          )}
        </div>

        {showCcrs && (
          <>
            {hsCodes.length === 0 ? (
              <p className="mt-3 text-xs text-amber-700">
                Record the HS codes above first — there is nothing to match requirements against.
              </p>
            ) : unapplied.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                No further requirements match {hsCodes.join(', ')}. Add them under Settings →
                Compliance requirements if you expected some.
              </p>
            ) : (
              <form action={ccrAction} className="mt-3 space-y-3">
                <input type="hidden" name="jobId" value={jobId} />
                <ul className="space-y-2">
                  {unapplied.map((ccr) => (
                    <li key={ccr.id}>
                      <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          name="ccrId"
                          value={ccr.id}
                          defaultChecked
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {ccr.title}
                            <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                              {ccr.code} · {ccr.hsCode}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {ccr.requirementText}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="submit"
                  disabled={ccrPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {ccrPending ? 'Assessing…' : 'Apply and find missing documents'}
                </button>
                <p className="text-xs text-slate-400">
                  Matched on HS code as a suggestion — untick anything that does not apply.
                </p>
              </form>
            )}
            <Note state={ccrState} />
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Remarks</h2>
        <form action={remarksAction} className="mt-3 space-y-2">
          <input type="hidden" name="jobId" value={jobId} />
          <textarea
            id="remarks"
            name="remarks"
            rows={5}
            defaultValue={remarks ?? ''}
            placeholder="Written by the assessment, editable here."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={remarksPending}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            {remarksPending ? 'Saving…' : 'Save remarks'}
          </button>
        </form>
        <Note state={remarksState} />
      </section>
    </div>
  );
}
