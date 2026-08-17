'use client';

import { useActionState } from 'react';
import { createCfs, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

export function CfsForm() {
  const [state, formAction, pending] = useActionState(createCfs, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Add a container freight station</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Adding one that already exists updates it. Put your CFS people on a station from the Team
        page — they only see delivery plans for their own.
      </p>
      <form action={formAction} className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="name" className={LABEL}>
            Name
          </label>
          <input id="name" name="name" required placeholder="Continental Warehousing" className={FIELD} />
        </div>
        <div>
          <label htmlFor="code" className={LABEL}>
            Code
          </label>
          <input id="code" name="code" placeholder="INNSA6" className={FIELD} />
        </div>
        <div>
          <label htmlFor="port" className={LABEL}>
            Customs station
          </label>
          <input id="port" name="port" placeholder="Nhava Sheva" className={FIELD} />
        </div>
        <div>
          <label htmlFor="contactEmail" className={LABEL}>
            Contact email
          </label>
          <div className="flex gap-2">
            <input id="contactEmail" name="contactEmail" type="email" className={FIELD} />
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
