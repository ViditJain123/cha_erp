'use client';

import { useActionState } from 'react';
import { setShipperActive, type SettingsActionState } from '../actions';

const EMPTY: SettingsActionState = {};

export function ShipperRow(props: {
  shipperId: string;
  name: string;
  email: string;
  aliases: string[];
  isActive: boolean;
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(setShipperActive, EMPTY);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3 font-medium">{props.name}</td>
        <td className="px-4 py-3 text-slate-600">{props.email}</td>
        <td className="px-4 py-3 text-xs text-slate-500">
          {props.aliases.length > 0 ? props.aliases.join(', ') : '—'}
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
              <input type="hidden" name="shipperId" value={props.shipperId} />
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
          <td colSpan={5} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {state.error ?? state.message}
          </td>
        </tr>
      )}
    </>
  );
}
