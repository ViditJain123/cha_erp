'use client';

import { useActionState } from 'react';
import { setSecurityActive, type SettingsActionState } from '../actions';
import { formatDay } from '@/lib/dates';

const EMPTY: SettingsActionState = {};

export function SecurityRow(props: {
  securityId: string;
  importerName: string;
  importerAliases: string[];
  lineName: string;
  kind: string;
  reference: string | null;
  amount: number | null;
  validTo: string | null;
  coversLoaded: boolean;
  coversDestuffed: boolean;
  isActive: boolean;
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(setSecurityActive, EMPTY);

  const covers = [
    props.coversLoaded ? 'loaded' : null,
    props.coversDestuffed ? 'de-stuffed' : null,
  ].filter(Boolean);

  // A bond that has run out is worse than no bond: it reads as cover until
  // someone checks the date, so it is called out rather than left to the eye.
  const expired = props.validTo !== null && props.validTo < new Date().toISOString().slice(0, 10);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.importerName}</div>
          {props.importerAliases.length > 0 && (
            <div className="mt-0.5 text-xs text-slate-400">{props.importerAliases.join(', ')}</div>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600">{props.lineName}</td>
        <td className="px-4 py-3 text-slate-600">
          {props.kind === 'yearly_bond' ? 'Yearly bond' : 'Standing deposit'}
          {props.reference && (
            <div className="mt-0.5 font-mono text-xs text-slate-400">{props.reference}</div>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600">
          {props.amount === null ? '—' : `₹${props.amount.toLocaleString('en-IN')}`}
        </td>
        <td className="px-4 py-3 text-xs text-slate-500">
          {covers.length > 0 ? covers.join(', ') : 'nothing'}
        </td>
        <td className="px-4 py-3 text-slate-600">
          {props.validTo ? (
            <span className={expired ? 'font-medium text-red-600' : undefined}>
              {formatDay(props.validTo)}
              {expired && ' · expired'}
            </span>
          ) : (
            '—'
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
              <input type="hidden" name="securityId" value={props.securityId} />
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
          <td colSpan={8} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {state.error ?? state.message}
          </td>
        </tr>
      )}
    </>
  );
}
