'use client';

import { useActionState, useState } from 'react';
import { TEAMS } from '@checklist/config/app';
import { setMemberStatus, updateMemberTeam, type SettingsActionState } from '../actions';

const EMPTY: SettingsActionState = {};

const BUTTON =
  'rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60';
const SMALL_FIELD =
  'rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export function MemberRow(props: {
  userId: string;
  email: string;
  fullName: string | null;
  team: string | null;
  teamLabel: string;
  cfsId: string | null;
  cfsLabel: string | null;
  cfsOptions: { id: string; name: string }[];
  role: string;
  status: string;
  isOwner: boolean;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [statusState, statusAction, statusPending] = useActionState(setMemberStatus, EMPTY);
  const [teamState, teamAction, teamPending] = useActionState(updateMemberTeam, EMPTY);
  const [editing, setEditing] = useState(false);
  const [team, setTeam] = useState(props.team ?? 'scrutiny');

  const note = statusState.error ?? statusState.message ?? teamState.error ?? teamState.message;

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.fullName ?? props.email}</div>
          {props.fullName && <div className="text-xs text-slate-400">{props.email}</div>}
        </td>
        <td className="px-4 py-3">
          {props.teamLabel}
          {props.cfsLabel && <div className="mt-0.5 text-xs text-slate-400">{props.cfsLabel}</div>}
          {props.team === 'cfs' && !props.cfsId && (
            <div className="mt-0.5 text-xs text-amber-700">no station — sees nothing</div>
          )}
        </td>
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
            {props.isOwner ? (
              <span className="text-xs text-slate-400">—</span>
            ) : (
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setEditing((v) => !v)} className={BUTTON}>
                  {editing ? 'Close' : 'Change team'}
                </button>
                {!props.isSelf && (
                  <form action={statusAction}>
                    <input type="hidden" name="userId" value={props.userId} />
                    <input
                      type="hidden"
                      name="status"
                      value={props.status === 'disabled' ? 'active' : 'disabled'}
                    />
                    <button type="submit" disabled={statusPending} className={BUTTON}>
                      {props.status === 'disabled' ? 'Enable' : 'Disable'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </td>
        )}
      </tr>

      {editing && props.canManage && !props.isOwner && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-3">
            <form action={teamAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="userId" value={props.userId} />
              <select
                name="team"
                value={team}
                onChange={(e) => setTeam(e.currentTarget.value)}
                className={SMALL_FIELD}
              >
                {Object.values(TEAMS).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              {team === 'cfs' && (
                <select name="cfsId" defaultValue={props.cfsId ?? ''} className={SMALL_FIELD}>
                  <option value="">Choose a station…</option>
                  {props.cfsOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="submit" disabled={teamPending} className={BUTTON}>
                {teamPending ? 'Saving…' : 'Save'}
              </button>
              {team === 'cfs' && props.cfsOptions.length === 0 && (
                <span className="text-xs text-amber-700">
                  Add a station under Settings → CFS first.
                </span>
              )}
            </form>
          </td>
        </tr>
      )}

      {note && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {note}
          </td>
        </tr>
      )}
    </>
  );
}
