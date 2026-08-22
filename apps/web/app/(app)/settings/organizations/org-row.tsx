'use client';

import { useActionState, useState } from 'react';
import { updateOrganizationDefaults, type SettingsActionState } from '../actions';

const EMPTY: SettingsActionState = {};

const SMALL_FIELD =
  'rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

const ROLE_LABELS: [keyof OrgRowProps, string][] = [
  ['isConsignee', 'importer'],
  ['isShipper', 'shipper'],
  ['isAgent', 'agent'],
  ['isTransporter', 'transporter'],
];

export interface OrgRowProps {
  orgId: string;
  name: string;
  branchName: string;
  branchSrNo: string;
  city: string | null;
  country: string | null;
  adCode: string | null;
  iec: string | null;
  gstin: string | null;
  isConsignee: boolean;
  isShipper: boolean;
  isAgent: boolean;
  isTransporter: boolean;
  defaultEndUseCode: string | null;
  marineOpenPolicyRatePercent: number | null;
  canManage: boolean;
}

/**
 * One party. Everything shown comes from Logi-Sys and is replaced by the next
 * upload — the only editable fields are the two the repository does not carry.
 */
export function OrgRow(props: OrgRowProps) {
  const [state, formAction, pending] = useActionState(updateOrganizationDefaults, EMPTY);
  const [open, setOpen] = useState(false);

  const roles = ROLE_LABELS.filter(([key]) => props[key]).map(([, label]) => label);
  const hasDefaults = props.defaultEndUseCode ?? props.marineOpenPolicyRatePercent;

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.name}</div>
          <div className="text-xs text-slate-500">
            {[props.city, props.country].filter(Boolean).join(', ') || '—'}
          </div>
        </td>
        <td className="px-4 py-3 text-slate-600">{props.branchName || '—'}</td>
        <td className="px-4 py-3 text-xs text-slate-500">{roles.join(', ') || '—'}</td>
        <td className="px-4 py-3 font-mono text-xs text-slate-600">{props.iec ?? '—'}</td>
        <td className="px-4 py-3 font-mono text-xs text-slate-600">{props.gstin ?? '—'}</td>
        <td className="px-4 py-3 font-mono text-xs text-slate-600">{props.adCode ?? '—'}</td>
        <td className="px-4 py-3 text-right">
          {props.canManage && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
            >
              {open ? 'Close' : hasDefaults ? 'Defaults ✓' : 'Defaults'}
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-3">
            <p className="mb-2 text-xs text-slate-500">
              The two things Logi-Sys does not hold about this party. An upload never overwrites
              them.
            </p>
            <form action={formAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={props.orgId} />
              <div>
                <label
                  htmlFor={`endUse-${props.orgId}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Default end use
                </label>
                <select
                  id={`endUse-${props.orgId}`}
                  name="defaultEndUseCode"
                  defaultValue={props.defaultEndUseCode ?? ''}
                  className={SMALL_FIELD}
                >
                  <option value="">Not set (GNX100)</option>
                  <option value="GNX100">GNX100 — trading</option>
                  <option value="GNX200">GNX200 — manufacture / actual use</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor={`marine-${props.orgId}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Marine open policy <span className="text-slate-400">(% of C&amp;F)</span>
                </label>
                <input
                  id={`marine-${props.orgId}`}
                  name="marineOpenPolicyRatePercent"
                  type="number"
                  min={0}
                  step="0.00001"
                  placeholder="1.125"
                  defaultValue={props.marineOpenPolicyRatePercent ?? ''}
                  className={`w-32 ${SMALL_FIELD}`}
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-white disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
              {(state.error ?? state.message) && (
                <span
                  className={`text-xs ${state.error ? 'text-red-700' : 'text-emerald-700'}`}
                >
                  {state.error ?? state.message}
                </span>
              )}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
