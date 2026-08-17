'use client';

import { useActionState } from 'react';
import { createShippingLine, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

export function LineForm() {
  const [state, formAction, pending] = useActionState(createShippingLine, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Add a shipping line</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Adding one that already exists updates it. Deposit rates are set per line once it is saved.
      </p>
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className={LABEL}>
            Line
          </label>
          <input id="name" name="name" required placeholder="Interasia Lines" className={FIELD} />
        </div>
        <div>
          <label htmlFor="agentName" className={LABEL}>
            Indian agent
          </label>
          <input
            id="agentName"
            name="agentName"
            placeholder="Emirates Shipping Agencies (India)"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="doEmail" className={LABEL}>
            DO email
          </label>
          <input id="doEmail" name="doEmail" type="email" className={FIELD} />
        </div>
        <div>
          <label htmlFor="issuesDoVia" className={LABEL}>
            Issues the DO via
          </label>
          <select id="issuesDoVia" name="issuesDoVia" defaultValue="email" className={FIELD}>
            <option value="email">Email</option>
            <option value="odex">ODeX</option>
          </select>
        </div>
        <div>
          <label htmlFor="defaultFreeDays" className={LABEL}>
            Default free days <span className="text-slate-400">(detention)</span>
          </label>
          <input
            id="defaultFreeDays"
            name="defaultFreeDays"
            type="number"
            min={0}
            step={1}
            placeholder="14"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="aliases" className={LABEL}>
            Also known as <span className="text-slate-400">(comma separated)</span>
          </label>
          <div className="flex gap-2">
            <input
              id="aliases"
              name="aliases"
              placeholder="INTERASIA LINES, IAL"
              className={FIELD}
            />
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
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
