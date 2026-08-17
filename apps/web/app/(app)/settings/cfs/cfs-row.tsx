'use client';

import { useActionState } from 'react';
import { setCfsActive, type SettingsActionState } from '../actions';

const EMPTY: SettingsActionState = {};

export function CfsRow(props: {
  cfsId: string;
  name: string;
  code: string | null;
  port: string | null;
  contactEmail: string | null;
  staffCount: number;
  isActive: boolean;
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(setCfsActive, EMPTY);

  // Nobody assigned and no address means a delivery plan raised here reaches
  // no one at all — worth saying out loud rather than leaving a silent zero.
  const unreachable = props.staffCount === 0 && !props.contactEmail;

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.name}</div>
          {props.code && <div className="mt-0.5 font-mono text-xs text-slate-400">{props.code}</div>}
        </td>
        <td className="px-4 py-3 text-slate-600">{props.port ?? '—'}</td>
        <td className="px-4 py-3 text-slate-600">{props.contactEmail ?? '—'}</td>
        <td className="px-4 py-3">
          {unreachable ? (
            <span className="text-xs font-medium text-amber-700">nobody assigned</span>
          ) : (
            <span className="text-sm tabular-nums text-slate-600">{props.staffCount}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              props.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
            }`}
          >
            {props.isActive ? 'active' : 'retired'}
          </span>
        </td>
        {props.canManage && (
          <td className="px-4 py-3 text-right">
            <form action={formAction}>
              <input type="hidden" name="cfsId" value={props.cfsId} />
              <input type="hidden" name="isActive" value={props.isActive ? 'false' : 'true'} />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                {props.isActive ? 'Retire' : 'Re-enable'}
              </button>
            </form>
          </td>
        )}
      </tr>
      {(state.error ?? state.message) && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {state.error ?? state.message}
          </td>
        </tr>
      )}
    </>
  );
}
