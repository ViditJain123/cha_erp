'use client';

import { useActionState, useState } from 'react';
import { deleteSupplierRelationship, type SettingsActionState } from '../actions';
import { formatDay } from '@/lib/dates';
import { RelationshipForm } from './relationship-form';

const EMPTY: SettingsActionState = {};

export interface RelationshipRowProps {
  id: string;
  importerName: string;
  importerBranch: string;
  supplierName: string;
  supplierBranch: string;
  isRelated: boolean;
  base: string | null;
  condition: string | null;
  svbRefNo: string | null;
  svbDate: string | null;
  svbCustomHouse: string | null;
  loadingBasis: string | null;
  rateAssessable: number | null;
  statusAssessable: string | null;
  rateDuty: number | null;
  statusDuty: string | null;
  revenueDepositPercent: number | null;
  notes: string | null;
  canManage: boolean;
}

const percent = (v: number | null) => (v == null ? null : `${v}%`);

export function RelationshipRow(props: RelationshipRowProps) {
  const [state, formAction, pending] = useActionState(deleteSupplierRelationship, EMPTY);
  const [editing, setEditing] = useState(false);

  const loading = [
    props.rateAssessable != null
      ? `AV ${percent(props.rateAssessable)}${props.statusAssessable ? ` (${props.statusAssessable})` : ''}`
      : null,
    props.rateDuty != null
      ? `duty ${percent(props.rateDuty)}${props.statusDuty ? ` (${props.statusDuty})` : ''}`
      : null,
  ].filter(Boolean);

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-4 py-3">
          <div className="font-medium">{props.importerName}</div>
          {props.importerBranch && (
            <div className="text-xs text-slate-400">{props.importerBranch}</div>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="text-slate-700">{props.supplierName}</div>
          {props.supplierBranch && (
            <div className="text-xs text-slate-400">{props.supplierBranch}</div>
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              props.isRelated ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {props.isRelated ? 'related' : 'at arm’s length'}
          </span>
          {props.base && <div className="mt-1 text-xs text-slate-500">{props.base}</div>}
        </td>
        <td className="px-4 py-3 text-slate-600">
          {props.svbRefNo ? (
            <>
              <div className="font-mono text-xs">{props.svbRefNo}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {[props.svbDate ? formatDay(props.svbDate) : null, props.svbCustomHouse]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-slate-600">
          {loading.length > 0 ? loading.join(', ') : <span className="text-slate-400">—</span>}
        </td>
        <td className="px-4 py-3 text-xs text-slate-600">
          {percent(props.revenueDepositPercent) ?? <span className="text-slate-400">—</span>}
        </td>
        {props.canManage && (
          <td className="px-4 py-3">
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
              >
                {editing ? 'Close' : 'Edit'}
              </button>
              <form action={formAction}>
                <input type="hidden" name="id" value={props.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Remove
                </button>
              </form>
            </div>
          </td>
        )}
      </tr>

      {editing && (
        <tr>
          <td colSpan={props.canManage ? 7 : 6} className="bg-slate-50 px-4 py-4">
            {/* The pair itself is the key, so the two names are shown but not
                editable — a different pair is a different record. */}
            <RelationshipForm
              defaults={{
                importerName: props.importerName,
                supplierName: props.supplierName,
                isRelated: props.isRelated,
                base: props.base,
                condition: props.condition,
                svbRefNo: props.svbRefNo,
                svbDate: props.svbDate,
                svbCustomHouse: props.svbCustomHouse,
                loadingBasis: props.loadingBasis,
                rateAssessable: props.rateAssessable,
                statusAssessable: props.statusAssessable,
                rateDuty: props.rateDuty,
                statusDuty: props.statusDuty,
                revenueDepositPercent: props.revenueDepositPercent,
                notes: props.notes,
              }}
              onSaved={() => setEditing(false)}
            />
          </td>
        </tr>
      )}

      {(state.error ?? state.message) && (
        <tr>
          <td
            colSpan={props.canManage ? 7 : 6}
            className={`px-4 py-2 text-xs ${state.error ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}
          >
            {state.error ?? state.message}
          </td>
        </tr>
      )}
    </>
  );
}
