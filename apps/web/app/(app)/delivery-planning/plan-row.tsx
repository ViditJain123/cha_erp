'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { decideDeliveryPlan, type PlanActionState } from './actions';
import { formatDay } from '@/lib/dates';

const EMPTY: PlanActionState = {};

const BUTTON =
  'rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60';
const FIELD =
  'rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export interface PendingPlan {
  id: string;
  jobId: string;
  jobLabel: string;
  importerName: string | null;
  plannedFor: string;
  cfsName: string;
}

export function PlanRow({ plan, daysLeft }: { plan: PendingPlan; daysLeft: number }) {
  const [state, formAction, pending] = useActionState(decideDeliveryPlan, EMPTY);
  const [refusing, setRefusing] = useState(false);

  const when =
    daysLeft < 0
      ? `${Math.abs(daysLeft)} day(s) ago`
      : daysLeft === 0
        ? 'today'
        : `in ${daysLeft} day(s)`;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/jobs/${plan.jobId}/clearance`}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {plan.jobLabel}
          </Link>
          <div className="mt-0.5 text-xs text-slate-500">
            {plan.importerName ?? '—'} · {plan.cfsName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium">
            {formatDay(plan.plannedFor)}
          </div>
          <div className={`text-xs ${daysLeft < 0 ? 'text-red-600' : 'text-slate-500'}`}>{when}</div>
        </div>
      </div>

      {refusing ? (
        <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="decision" value="refuse" />
          <input
            name="decisionNote"
            required
            autoFocus
            placeholder="Why it cannot happen — support has to tell the customer"
            className={`min-w-64 flex-1 ${FIELD}`}
          />
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Saving…' : 'Confirm refusal'}
          </button>
          <button type="button" onClick={() => setRefusing(false)} className={BUTTON}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <form action={formAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="decision" value="approve" />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Yes — delivery is happening'}
            </button>
          </form>
          <button type="button" onClick={() => setRefusing(true)} className={BUTTON}>
            No
          </button>
        </div>
      )}

      {(state.error ?? state.message) && (
        <div
          className={`mt-2 text-xs ${state.error ? 'text-red-600' : 'text-emerald-700'}`}
        >
          {state.error ?? state.message}
        </div>
      )}
    </li>
  );
}
