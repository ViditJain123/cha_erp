'use client';

import { useActionState } from 'react';
import { createBranch, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

export function BranchForm() {
  const [state, formAction, pending] = useActionState(createBranch, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Add a branch</h2>
      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-slate-600">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Nhava Sheva"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="code" className="mb-1 block text-xs font-medium text-slate-600">
            Code <span className="text-slate-400">(optional)</span>
          </label>
          <div className="flex gap-2">
            <input
              id="code"
              name="code"
              placeholder="INNSA1"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </form>
      <Feedback state={state} />
    </div>
  );
}
