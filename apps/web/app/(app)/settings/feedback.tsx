'use client';

import type { SettingsActionState } from './actions';

export function Feedback({ state }: { state: SettingsActionState }) {
  if (state.error) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </div>
    );
  }
  if (!state.message) return null;
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
