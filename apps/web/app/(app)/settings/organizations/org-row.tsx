'use client';

import { useActionState, useState } from 'react';
import {
  addOrganizationAdCode,
  deleteOrganizationAdCode,
  setDefaultOrganizationAdCode,
  updateOrganizationDefaults,
  type SettingsActionState,
} from '../actions';

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
  marinePolicyNo: string | null;
  marinePolicySumInsuredInr: number | null;
  marinePolicyPerSendingLimitInr: number | null;
  marinePolicyValidTill: string | null;
  /** The other bank branches this importer remits through. */
  adCodes: { id: string; adCode: string; bankName: string | null; bankBranch: string | null; isDefault: boolean }[];
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
  const hasDefaults =
    props.defaultEndUseCode ??
    props.marineOpenPolicyRatePercent ??
    props.marinePolicyNo ??
    props.marinePolicyPerSendingLimitInr;

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
              What Logi-Sys does not hold about this party. An upload never overwrites any of it.
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
                  {/* Unset means the operator is asked per line (06-items.md §9). */}
                  <option value="">Not set — ask on each job</option>
                  <option value="GNX100">GNX100 — trading</option>
                  <option value="GNX200">GNX200 — manufacture / actual use</option>
                  <option value="GNX810">GNX810 — research &amp; development</option>
                  <option value="GNX600">GNX600 — repair / refurbishing</option>
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
              <div>
                <label
                  htmlFor={`policyNo-${props.orgId}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Marine policy no.
                </label>
                <input
                  id={`policyNo-${props.orgId}`}
                  name="marinePolicyNo"
                  defaultValue={props.marinePolicyNo ?? ''}
                  className={`w-40 ${SMALL_FIELD}`}
                />
              </div>
              <div>
                <label
                  htmlFor={`sumInsured-${props.orgId}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Sum insured <span className="text-slate-400">(₹)</span>
                </label>
                <input
                  id={`sumInsured-${props.orgId}`}
                  name="marinePolicySumInsuredInr"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={props.marinePolicySumInsuredInr ?? ''}
                  className={`w-36 ${SMALL_FIELD}`}
                />
              </div>
              <div>
                <label
                  htmlFor={`perSending-${props.orgId}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Per-sending limit <span className="text-slate-400">(₹)</span>
                </label>
                <input
                  id={`perSending-${props.orgId}`}
                  name="marinePolicyPerSendingLimitInr"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={props.marinePolicyPerSendingLimitInr ?? ''}
                  className={`w-36 ${SMALL_FIELD}`}
                />
              </div>
              <div>
                <label
                  htmlFor={`validTill-${props.orgId}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Policy valid till
                </label>
                <input
                  id={`validTill-${props.orgId}`}
                  name="marinePolicyValidTill"
                  type="date"
                  defaultValue={props.marinePolicyValidTill ?? ''}
                  className={SMALL_FIELD}
                />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-white disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
              <p className="w-full text-xs text-slate-400">
                The per-sending limit is what the export checks a consignment against: a Bill of
                Entry worth more than this is over-shipped against the cover, and the job says so
                before it is filed.
              </p>
              {(state.error ?? state.message) && (
                <span
                  className={`text-xs ${state.error ? 'text-red-700' : 'text-emerald-700'}`}
                >
                  {state.error ?? state.message}
                </span>
              )}
            </form>

            <AdCodes {...props} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The bank branches this importer remits through.
 *
 * `organizations.ad_code` above is the one the repository carries, and it is
 * the default. These are the alternatives, and they are not a nicety: only 188
 * of five thousand rows carry an AD code at all, and the repository often does
 * not hold the one actually filed — Logi-Sys picks the branch and the AD code
 * independently, so binding the party does not answer this.
 *
 * `GENERAL.AD_Code` blocks the export when an importer has several and none is
 * chosen for the shipment. That is deliberate: which bank realises the
 * remittance is not something to guess on a customs document.
 */
function AdCodes(props: OrgRowProps) {
  const [addState, addAction, adding] = useActionState(addOrganizationAdCode, EMPTY);
  const [defaultState, defaultAction] = useActionState(setDefaultOrganizationAdCode, EMPTY);
  const [deleteState, deleteAction] = useActionState(deleteOrganizationAdCode, EMPTY);
  const note = addState.error ?? defaultState.error ?? deleteState.error ?? addState.message;

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <p className="mb-2 text-xs font-medium text-slate-600">AD codes</p>
      <p className="mb-2 text-xs text-slate-500">
        The bank branch a Bill of Entry is remitted against.{' '}
        {props.adCode
          ? `The repository carries ${props.adCode} for this row; add the others here.`
          : 'The repository carries none for this row.'}
      </p>

      {props.adCodes.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {props.adCodes.map((code) => (
            <li key={code.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-xs">{code.adCode}</span>
              <span className="flex-1 text-xs text-slate-500">
                {[code.bankName, code.bankBranch].filter(Boolean).join(' · ') || '—'}
              </span>
              {code.isDefault ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                  default
                </span>
              ) : (
                <form action={defaultAction}>
                  <input type="hidden" name="id" value={code.id} />
                  <input type="hidden" name="organizationId" value={props.orgId} />
                  <button type="submit" className="text-xs text-slate-500 hover:text-slate-900">
                    make default
                  </button>
                </form>
              )}
              <form action={deleteAction}>
                <input type="hidden" name="id" value={code.id} />
                <button type="submit" className="text-xs text-red-600 hover:text-red-800">
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="organizationId" value={props.orgId} />
        <div>
          <label
            htmlFor={`adCode-${props.orgId}`}
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            AD code
          </label>
          {/* Text, never a number input: 0023340 as a number is 23340, which is
              a different bank branch. */}
          <input
            id={`adCode-${props.orgId}`}
            name="adCode"
            inputMode="numeric"
            placeholder="0023340"
            className={`${SMALL_FIELD} font-mono`}
          />
        </div>
        <div>
          <label
            htmlFor={`bankName-${props.orgId}`}
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Bank
          </label>
          <input id={`bankName-${props.orgId}`} name="bankName" className={SMALL_FIELD} />
        </div>
        <div>
          <label
            htmlFor={`bankBranch-${props.orgId}`}
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Branch
          </label>
          <input id={`bankBranch-${props.orgId}`} name="bankBranch" className={SMALL_FIELD} />
        </div>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" name="isDefault" />
          Default
        </label>
        <button
          type="submit"
          disabled={adding}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-white disabled:opacity-60"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
        {note && (
          <span
            className={`text-xs ${addState.error ?? defaultState.error ?? deleteState.error ? 'text-red-700' : 'text-emerald-700'}`}
          >
            {note}
          </span>
        )}
      </form>
    </div>
  );
}
