'use client';

import { useActionState } from 'react';
import { createSecurity, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

export function SecurityForm({ lines }: { lines: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createSecurity, EMPTY);

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        Add a shipping line first — a bond is always held with one particular line.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Record a bond or standing deposit</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Held per importer per line. When one covers a job, the DO tab stops asking for a container
        deposit.
      </p>
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="lineId" className={LABEL}>
            Shipping line
          </label>
          <select id="lineId" name="lineId" required className={FIELD}>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="importerName" className={LABEL}>
            Importer
          </label>
          <input
            id="importerName"
            name="importerName"
            required
            placeholder="M/S. Elite Polyplus"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="kind" className={LABEL}>
            Kind
          </label>
          <select id="kind" name="kind" defaultValue="yearly_bond" className={FIELD}>
            <option value="yearly_bond">Yearly bond</option>
            <option value="standing_deposit">Standing deposit</option>
          </select>
        </div>
        <div>
          <label htmlFor="reference" className={LABEL}>
            Reference
          </label>
          <input id="reference" name="reference" placeholder="Bond no." className={FIELD} />
        </div>
        <div>
          <label htmlFor="amount" className={LABEL}>
            Amount
          </label>
          <input id="amount" name="amount" type="number" min={0} step="0.01" className={FIELD} />
        </div>
        <div>
          <label htmlFor="importerAliases" className={LABEL}>
            Importer also known as <span className="text-slate-400">(comma separated)</span>
          </label>
          <input
            id="importerAliases"
            name="importerAliases"
            placeholder="ELITE POLYPLUS PVT LTD"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="validFrom" className={LABEL}>
            Valid from
          </label>
          <input id="validFrom" name="validFrom" type="date" className={FIELD} />
        </div>
        <div>
          <label htmlFor="validTo" className={LABEL}>
            Valid to
          </label>
          <input id="validTo" name="validTo" type="date" className={FIELD} />
        </div>
        <div>
          <span className={LABEL}>Covers</span>
          <div className="flex items-center gap-4 py-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="covers" value="loaded" defaultChecked />
              Loaded
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="covers" value="destuffed" defaultChecked />
              De-stuffed
            </label>
            <button
              type="submit"
              disabled={pending}
              className="ml-auto shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
      <Feedback state={state} />
    </div>
  );
}
