'use client';

import { useActionState } from 'react';
import { setMemberStatus, type SettingsActionState } from '../actions';

const EMPTY: SettingsActionState = {};

export function MemberRow(props: {
  userId: string;
  email: string;
  fullName: string | null;
  team: string;
  role: string;
  status: string;
  isOwner: boolean;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(setMemberStatus, EMPTY);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.fullName ?? props.email}</div>
          {props.fullName && <div className="text-xs text-slate-400">{props.email}</div>}
        </td>
        <td className="px-4 py-3">{props.team}</td>
        <td className="px-4 py-3">{props.role}</td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              props.status === 'active'
                ? 'bg-emerald-100 text-emerald-800'
                : props.status === 'invited'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-200 text-slate-700'
            }`}
          >
            {props.status}
          </span>
        </td>
        {props.canManage && (
          <td className="px-4 py-3 text-right">
            {props.isOwner || props.isSelf ? (
              <span className="text-xs text-slate-400">—</span>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="userId" value={props.userId} />
                <input
                  type="hidden"
                  name="status"
                  value={props.status === 'disabled' ? 'active' : 'disabled'}
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  {props.status === 'disabled' ? 'Enable' : 'Disable'}
                </button>
              </form>
            )}
          </td>
        )}
      </tr>
      {(state.error ?? state.message) && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {state.error ?? state.message}
          </td>
        </tr>
      )}
    </>
  );
}
