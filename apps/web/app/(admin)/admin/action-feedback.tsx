'use client';

import type { ActionState } from './actions';

/** Shared success/error strip for the admin forms. */
export function ActionFeedback({ state }: { state: ActionState }) {
  if (!state.error && !state.message) return null;

  if (state.error) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {state.message}
      {state.tempPassword && (
        <div className="mt-2">
          <span className="text-xs uppercase tracking-wide text-emerald-700">
            Temporary password
          </span>
          <div className="font-mono text-sm tracking-wider">{state.tempPassword}</div>
        </div>
      )}
    </div>
  );
}
