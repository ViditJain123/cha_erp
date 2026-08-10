'use client';

import { useActionState } from 'react';
import { updateCompany, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

export function CompanyForm({ name, slug }: { name: string; slug: string }) {
  const [state, formAction, pending] = useActionState(updateCompany, EMPTY);

  return (
    <div>
      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-slate-600">
            Company name
          </label>
          <input
            id="name"
            name="name"
            defaultValue={name}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Identifier</label>
          <input
            value={slug}
            readOnly
            className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500"
          />
        </div>
        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      <Feedback state={state} />
    </div>
  );
}
