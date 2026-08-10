'use client';

import { useActionState } from 'react';
import { resetPassword, setUserStatus, type ActionState } from '../../actions';

const EMPTY: ActionState = {};

export function UserRow(props: {
  userId: string;
  email: string;
  fullName: string | null;
  role: string;
  team: string;
  status: string;
  mustChangePassword: boolean;
}) {
  const [resetState, resetAction, resetting] = useActionState(resetPassword, EMPTY);
  const [statusState, statusAction, updating] = useActionState(setUserStatus, EMPTY);
  const feedback = resetState.error ?? statusState.error ?? resetState.message ?? statusState.message;
  const tempPassword = resetState.tempPassword;

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.fullName ?? props.email}</div>
          {props.fullName && <div className="text-xs text-slate-400">{props.email}</div>}
        </td>
        <td className="px-4 py-3">{props.role}</td>
        <td className="px-4 py-3">{props.team}</td>
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
          {props.mustChangePassword && (
            <span className="ml-2 text-xs text-slate-400">password not set</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-2">
            <form action={resetAction}>
              <input type="hidden" name="userId" value={props.userId} />
              <button
                type="submit"
                disabled={resetting}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                {resetting ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
            <form action={statusAction}>
              <input type="hidden" name="userId" value={props.userId} />
              <input
                type="hidden"
                name="status"
                value={props.status === 'disabled' ? 'active' : 'disabled'}
              />
              <button
                type="submit"
                disabled={updating}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
              >
                {props.status === 'disabled' ? 'Enable' : 'Disable'}
              </button>
            </form>
          </div>
        </td>
      </tr>
      {feedback && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {feedback}
            {tempPassword && (
              <span className="ml-2 font-mono tracking-wider text-slate-900">{tempPassword}</span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
