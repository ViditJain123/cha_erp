'use client';

import { useActionState } from 'react';
import { setPassword, type AuthActionState } from '../actions';

const EMPTY: AuthActionState = {};

export function SetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(setPassword, EMPTY);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="username" value={email} autoComplete="username" readOnly />
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          At least 10 characters, with an uppercase letter, a lowercase letter and a digit.
        </p>
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set password and continue'}
      </button>
    </form>
  );
}
