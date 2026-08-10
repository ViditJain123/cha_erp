'use client';

import { useActionState } from 'react';
import { createCompany, type ActionState } from './actions';
import { ActionFeedback } from './action-feedback';

const EMPTY: ActionState = {};

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState(createCompany, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">New company</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        Enter the company and its owner&apos;s email. The owner receives a temporary password and is
        asked to change it on first sign-in.
      </p>

      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-slate-600">
            Company name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Kuberr India Exim LLP"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="ownerEmail" className="mb-1 block text-xs font-medium text-slate-600">
            Owner email
          </label>
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            required
            placeholder="owner@company.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="ownerName" className="mb-1 block text-xs font-medium text-slate-600">
            Owner name <span className="text-slate-400">(optional)</span>
          </label>
          <div className="flex gap-2">
            <input
              id="ownerName"
              name="ownerName"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={pending}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </form>

      <ActionFeedback state={state} />
    </div>
  );
}
