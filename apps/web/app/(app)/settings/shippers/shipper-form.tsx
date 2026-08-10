'use client';

import { useActionState } from 'react';
import { createShipper, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

export function ShipperForm() {
  const [state, formAction, pending] = useActionState(createShipper, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Add a shipper</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Adding one that already exists updates it.
      </p>
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-slate-600">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Fuchs Lubricants"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-600">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="aliases" className="mb-1 block text-xs font-medium text-slate-600">
            Also known as <span className="text-slate-400">(comma separated)</span>
          </label>
          <div className="flex gap-2">
            <input
              id="aliases"
              name="aliases"
              placeholder="Fuchs Lubricants GmbH"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
