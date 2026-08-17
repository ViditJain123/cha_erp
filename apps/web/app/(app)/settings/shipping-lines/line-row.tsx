'use client';

import { useActionState, useState } from 'react';
import {
  saveDepositRate,
  setShippingLineActive,
  type SettingsActionState,
} from '../actions';

const EMPTY: SettingsActionState = {};

const BUTTON =
  'rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60';
const SMALL_FIELD =
  'rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export interface DepositRate {
  id: string;
  deliveryMode: 'loaded' | 'destuffed';
  containerSize: string;
  amount: number;
}

const MODE_LABELS: Record<DepositRate['deliveryMode'], string> = {
  loaded: 'Loaded',
  destuffed: 'De-stuffed',
};

/**
 * The deposit matrix, edited a cell at a time. Saving with an empty amount
 * removes the rate — see saveDepositRate, which refuses to store zero for it,
 * because "no rate recorded" and "no deposit due" are different answers.
 */
function DepositRates({ lineId, rates }: { lineId: string; rates: DepositRate[] }) {
  const [state, formAction, pending] = useActionState(saveDepositRate, EMPTY);

  return (
    <div className="space-y-2">
      {rates.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {rates.map((rate) => (
            <li
              key={rate.id}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              {MODE_LABELS[rate.deliveryMode]} {rate.containerSize} · ₹
              {rate.amount.toLocaleString('en-IN')}
            </li>
          ))}
        </ul>
      )}
      <form action={formAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="lineId" value={lineId} />
        <select name="deliveryMode" defaultValue="loaded" className={SMALL_FIELD}>
          <option value="loaded">Loaded</option>
          <option value="destuffed">De-stuffed</option>
        </select>
        <input
          name="containerSize"
          placeholder="20 / 40 / *"
          required
          size={8}
          className={SMALL_FIELD}
        />
        <input
          name="amount"
          type="number"
          min={0}
          step="0.01"
          placeholder="amount"
          size={8}
          className={SMALL_FIELD}
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Set rate'}
        </button>
      </form>
      {(state.error ?? state.message) && (
        <div className="text-xs text-slate-600">{state.error ?? state.message}</div>
      )}
    </div>
  );
}

export function LineRow(props: {
  lineId: string;
  name: string;
  agentName: string | null;
  doEmail: string | null;
  issuesDoVia: string;
  defaultFreeDays: number | null;
  aliases: string[];
  isActive: boolean;
  canManage: boolean;
  rates: DepositRate[];
}) {
  const [state, formAction, pending] = useActionState(setShippingLineActive, EMPTY);
  const [showRates, setShowRates] = useState(false);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.name}</div>
          {props.aliases.length > 0 && (
            <div className="mt-0.5 text-xs text-slate-400">{props.aliases.join(', ')}</div>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600">{props.agentName ?? '—'}</td>
        <td className="px-4 py-3 text-slate-600">{props.doEmail ?? '—'}</td>
        <td className="px-4 py-3 text-slate-600">
          {props.issuesDoVia === 'odex' ? 'ODeX' : 'Email'}
        </td>
        <td className="px-4 py-3 text-slate-600">
          {props.defaultFreeDays === null ? '—' : `${props.defaultFreeDays} d`}
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
          <td className="px-4 py-3">
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setShowRates((v) => !v)} className={BUTTON}>
                Deposits ({props.rates.length})
              </button>
              <form action={formAction}>
                <input type="hidden" name="lineId" value={props.lineId} />
                <input type="hidden" name="isActive" value={props.isActive ? 'false' : 'true'} />
                <button type="submit" disabled={pending} className={BUTTON}>
                  {props.isActive ? 'Retire' : 'Re-enable'}
                </button>
              </form>
            </div>
          </td>
        )}
      </tr>
      {showRates && props.canManage && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-3">
            <DepositRates lineId={props.lineId} rates={props.rates} />
          </td>
        </tr>
      )}
      {(state.error ?? state.message) && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-2 text-xs text-slate-600">
            {state.error ?? state.message}
          </td>
        </tr>
      )}
    </>
  );
}
