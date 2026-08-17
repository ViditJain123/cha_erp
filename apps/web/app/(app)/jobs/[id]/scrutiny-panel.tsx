'use client';

import { useActionState, useState } from 'react';
import {
  applyCcrs,
  createCcr,
  updateHsCodes,
  updateRemarks,
  waiveCcrs,
  type JobActionState,
} from './actions';

const EMPTY: JobActionState = {};

export interface CcrSuggestion {
  id: string;
  hsCode: string;
  code: string;
  title: string;
  requirementText: string;
}

export interface AppliedCcr {
  code: string;
  title: string;
  /** null until the assessment has run and judged it against the goods. */
  applies: boolean | null;
  note: string | null;
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

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

/**
 * Captures a requirement the master does not have yet. It saves to the tenant
 * master, so the next shipment under the same HS code gets it as a suggestion
 * instead of someone typing it out again.
 */
function CcrCreateForm({
  jobId,
  hsCodes,
  nothingKnown,
  onDismiss,
}: {
  jobId: string;
  hsCodes: string[];
  nothingKnown: boolean;
  onDismiss: () => void;
}) {
  const [state, action, pending] = useActionState(createCcr, EMPTY);

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-slate-700">Add a compliance requirement</h3>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          Close
        </button>
      </div>
      {nothingKnown && (
        <p className="mt-1 text-xs text-amber-700">
          Nothing in your master covers {hsCodes.join(', ')}. Record what these goods require, or say
          nothing applies.
        </p>
      )}

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label
            htmlFor="ccrRequirementText"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Requirement
          </label>
          <textarea
            id="ccrRequirementText"
            name="requirementText"
            rows={4}
            required
            placeholder="Paste what the importer must hold, and which document proves it."
            className={FIELD}
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="w-32 shrink-0">
            <label htmlFor="ccrHsCode" className="mb-1 block text-xs font-medium text-slate-600">
              HS code
            </label>
            <input
              id="ccrHsCode"
              name="hsCode"
              required
              inputMode="numeric"
              defaultValue={hsCodes[0] ?? ''}
              className={`${FIELD} font-mono text-xs`}
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? 'Naming and saving…' : 'Save to master'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          It is named for you from what you paste. Shorten the HS code to cover more goods —{' '}
          <code className="font-mono">3304</code> applies to everything under that heading, not just
          this shipment.
        </p>
      </form>
      <Note state={state} />
    </div>
  );
}

export function ScrutinyPanel({
  jobId,
  hsCodes,
  suggestions,
  applied,
  waived,
  remarks,
}: {
  jobId: string;
  hsCodes: string[];
  suggestions: CcrSuggestion[];
  applied: AppliedCcr[];
  waived: boolean;
  remarks: string | null;
}) {
  const [hsState, hsAction, hsPending] = useActionState(updateHsCodes, EMPTY);
  const [ccrState, ccrAction, ccrPending] = useActionState(applyCcrs, EMPTY);
  const [remarksState, remarksAction, remarksPending] = useActionState(updateRemarks, EMPTY);
  const [waiveState, waiveAction, waivePending] = useActionState(waiveCcrs, EMPTY);

  const appliedCodes = applied.map((a) => a.code);
  const unapplied = suggestions.filter((s) => !appliedCodes.includes(s.code));
  // Nothing in the master covers these goods and nobody has said none applies —
  // the case that used to dead-end. Ask for the requirement outright rather
  // than hiding it behind a button.
  const nothingKnown = applied.length === 0 && suggestions.length === 0 && !waived;
  // Seeded, not derived: saving a requirement makes nothingKnown false, and a
  // derived flag would tear the form off the screen along with the confirmation
  // that it saved. It closes when the operator closes it.
  const [showCreate, setShowCreate] = useState(nothingKnown);
  const askingForCcr = hsCodes.length > 0 && showCreate;

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
            {applied.length > 0 && (
              <span className="ml-2 font-normal text-slate-500">{applied.length} applied</span>
            )}
          </h2>
          {!askingForCcr && hsCodes.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
            >
              Add CCR
            </button>
          )}
        </div>

        {hsCodes.length === 0 ? (
          <p className="mt-3 text-xs text-amber-700">
            Record the HS codes above first — there is nothing to match requirements against.
          </p>
        ) : (
          <>
            {applied.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {applied.map((ccr) => {
                  // applies === false is not a failure: the analysis read the
                  // goods on the invoice and this requirement does not govern
                  // them. Shown greyed rather than hidden, so the operator can
                  // see it was considered.
                  const inapplicable = ccr.applies === false;
                  return (
                    <li
                      key={ccr.code}
                      className={`rounded-lg px-3 py-2 text-xs ${
                        inapplicable ? 'bg-slate-50 text-slate-500' : 'bg-emerald-50 text-emerald-900'
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{ccr.title}</span>
                        <span
                          className={`font-mono ${
                            inapplicable ? 'text-slate-400' : 'text-emerald-700'
                          }`}
                        >
                          {ccr.code}
                        </span>
                        {inapplicable && (
                          <span className="ml-auto shrink-0 font-medium">does not apply</span>
                        )}
                      </div>
                      {ccr.note && <p className="mt-0.5 opacity-80">{ccr.note}</p>}
                    </li>
                  );
                })}
              </ul>
            )}

            {unapplied.length > 0 && (
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

            {waived && applied.length === 0 && (
              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Recorded as needing no compliance requirement. Add one below if that turns out to be
                wrong.
              </p>
            )}

            {askingForCcr && (
              <CcrCreateForm
                jobId={jobId}
                hsCodes={hsCodes}
                nothingKnown={nothingKnown}
                onDismiss={() => setShowCreate(false)}
              />
            )}

            {applied.length === 0 && !waived && (
              <form action={waiveAction} className="mt-3 border-t border-slate-100 pt-3">
                <input type="hidden" name="jobId" value={jobId} />
                <button
                  type="submit"
                  disabled={waivePending}
                  className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900 disabled:opacity-60"
                >
                  {waivePending ? 'Recording…' : 'Nothing applies to these goods'}
                </button>
                <p className="mt-1 text-xs text-slate-400">
                  Records the decision so the job can be closed out without a requirement.
                </p>
              </form>
            )}
            <Note state={waiveState} />
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
