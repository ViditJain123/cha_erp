'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { saveSupplierRelationship, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

/** Pre-fill for the edit case; absent when the form is being used to add. */
export interface RelationshipDefaults {
  importerName: string;
  supplierName: string;
  isRelated: boolean;
  base: string | null;
  condition: string | null;
  svbRefNo: string | null;
  svbDate: string | null;
  svbCustomHouse: string | null;
  loadingBasis: string | null;
  rateAssessable: number | null;
  statusAssessable: string | null;
  rateDuty: number | null;
  statusDuty: string | null;
  revenueDepositPercent: number | null;
  notes: string | null;
}

export function RelationshipForm({
  defaults,
  onSaved,
}: {
  defaults?: RelationshipDefaults;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveSupplierRelationship, EMPTY);
  const editing = defaults !== undefined;

  // The SVB block is most of this form and applies to a minority of pairs, so
  // it follows the tick rather than sitting there greyed out.
  const [related, setRelated] = useState(defaults?.isRelated ?? false);
  const importerRef = useRef<HTMLInputElement>(null);
  const supplierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.ok) onSaved?.();
  }, [state.ok, onSaved]);

  /** A candidate the action offered, clicked into the field it belongs to. */
  const useCandidate = (field: string, value: string) => {
    // The action lists branches as "NAME · BRANCH"; only the name is typed.
    const name = value.split(' · ')[0] ?? value;
    const target = field === 'importer' ? importerRef.current : supplierRef.current;
    if (target) {
      target.value = name;
      target.focus();
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {!editing && (
        <>
          <h2 className="text-sm font-semibold">Record a pair</h2>
          <p className="mt-1 mb-4 text-sm text-slate-500">
            Both names must be the ones Logi-Sys holds, because that is what the Bill of Entry
            binds. Type a few words and the form will offer what it found.
          </p>
        </>
      )}

      <form action={formAction} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="importerName" className={LABEL}>
              Importer
            </label>
            <input
              ref={importerRef}
              id="importerName"
              name="importerName"
              required
              defaultValue={defaults?.importerName ?? ''}
              readOnly={editing}
              placeholder="M/S. ELITE POLYPLUS"
              className={`${FIELD} ${editing ? 'bg-slate-50 text-slate-500' : ''}`}
            />
          </div>
          <div>
            <label htmlFor="supplierName" className={LABEL}>
              Supplier
            </label>
            <input
              ref={supplierRef}
              id="supplierName"
              name="supplierName"
              required
              defaultValue={defaults?.supplierName ?? ''}
              readOnly={editing}
              placeholder="ASIA SHIGEN INTERNATIONAL CO., LTD"
              className={`${FIELD} ${editing ? 'bg-slate-50 text-slate-500' : ''}`}
            />
          </div>
        </div>

        {state.candidates && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-xs font-medium text-amber-800">
              Did you mean, for the {state.candidates.field}?
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {state.candidates.names.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => useCandidate(state.candidates!.field, name)}
                  className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs hover:bg-amber-100"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isRelated"
            checked={related}
            onChange={(e) => setRelated(e.target.checked)}
          />
          <span>
            Buyer and seller are <span className="font-medium">related</span>
            <span className="ml-1 text-xs text-slate-500">
              (Rule 2(2), Customs Valuation Rules — shareholding, common control, sole agency)
            </span>
          </span>
        </label>

        {related && (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2 text-xs text-slate-500">
              These describe the relationship, and the Bill of Entry only carries them when there is
              one.
            </div>
            <div>
              <label htmlFor="base" className={LABEL}>
                Basis of the relationship
              </label>
              <input
                id="base"
                name="base"
                defaultValue={defaults?.base ?? ''}
                placeholder="Wholly owned subsidiary"
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="condition" className={LABEL}>
                Condition it puts on the price
              </label>
              <input
                id="condition"
                name="condition"
                defaultValue={defaults?.condition ?? ''}
                placeholder="Group price list applies"
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="revenueDepositPercent" className={LABEL}>
                Revenue deposit <span className="text-slate-400">(% of assessable value)</span>
              </label>
              <input
                id="revenueDepositPercent"
                name="revenueDepositPercent"
                type="number"
                min={0}
                max={100}
                step="0.00001"
                defaultValue={defaults?.revenueDepositPercent ?? ''}
                placeholder="1"
                className={FIELD}
              />
              <p className="mt-1 text-xs text-slate-400">
                Only when the customer&rsquo;s instruction asks for one. Usually 1% or 5%.
              </p>
            </div>
          </div>
        )}

        <details open={Boolean(defaults?.svbRefNo)} className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
            Special Valuation Branch order
            <span className="ml-2 text-xs font-normal text-slate-500">
              the reference, the loading it imposes, and whether it is final
            </span>
          </summary>
          <div className="grid gap-3 border-t border-slate-200 p-4 sm:grid-cols-3">
            <div>
              <label htmlFor="svbRefNo" className={LABEL}>
                SVB reference
              </label>
              <input
                id="svbRefNo"
                name="svbRefNo"
                defaultValue={defaults?.svbRefNo ?? ''}
                placeholder="SVB/123/2024"
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="svbDate" className={LABEL}>
                SVB date
              </label>
              <input
                id="svbDate"
                name="svbDate"
                type="date"
                defaultValue={defaults?.svbDate ?? ''}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="svbCustomHouse" className={LABEL}>
                Custom house that imposed it
              </label>
              <input
                id="svbCustomHouse"
                name="svbCustomHouse"
                maxLength={6}
                defaultValue={defaults?.svbCustomHouse ?? ''}
                placeholder="INNSA1"
                className={`${FIELD} font-mono uppercase`}
              />
              <p className="mt-1 text-xs text-slate-400">
                Not the station you file at — that comes from the job.
              </p>
            </div>
            <div>
              <label htmlFor="svbLoadingBasis" className={LABEL}>
                Loading basis
              </label>
              <select
                id="svbLoadingBasis"
                name="svbLoadingBasis"
                defaultValue={defaults?.loadingBasis ?? ''}
                className={FIELD}
              >
                <option value="">None</option>
                <option value="A">A — on the assessable value</option>
              </select>
            </div>
            <div>
              <label htmlFor="svbRateAssessable" className={LABEL}>
                Load on assessable value <span className="text-slate-400">(%)</span>
              </label>
              <input
                id="svbRateAssessable"
                name="svbRateAssessable"
                type="number"
                min={0}
                max={100}
                step="0.00001"
                defaultValue={defaults?.rateAssessable ?? ''}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="svbStatusAssessable" className={LABEL}>
                Status
              </label>
              <select
                id="svbStatusAssessable"
                name="svbStatusAssessable"
                defaultValue={defaults?.statusAssessable ?? ''}
                className={FIELD}
              >
                <option value="">—</option>
                <option value="F">F — final</option>
                <option value="P">P — provisional</option>
              </select>
            </div>
            <div className="sm:col-start-2">
              <label htmlFor="svbRateDuty" className={LABEL}>
                Load on duty <span className="text-slate-400">(%)</span>
              </label>
              <input
                id="svbRateDuty"
                name="svbRateDuty"
                type="number"
                min={0}
                max={100}
                step="0.00001"
                defaultValue={defaults?.rateDuty ?? ''}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor="svbStatusDuty" className={LABEL}>
                Status
              </label>
              <select
                id="svbStatusDuty"
                name="svbStatusDuty"
                defaultValue={defaults?.statusDuty ?? ''}
                className={FIELD}
              >
                <option value="">—</option>
                <option value="F">F — final</option>
                <option value="P">P — provisional</option>
              </select>
            </div>
          </div>
        </details>

        <div>
          <label htmlFor="notes" className={LABEL}>
            Notes <span className="text-slate-400">(not exported)</span>
          </label>
          <input
            id="notes"
            name="notes"
            defaultValue={defaults?.notes ?? ''}
            placeholder="Where the order came from, who confirmed it"
            className={FIELD}
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Save pair'}
        </button>
      </form>
      <Feedback state={state} />
    </div>
  );
}
