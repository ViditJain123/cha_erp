'use client';

import { useActionState } from 'react';
import { PLAN_STATUS_LABELS, PLAN_STATUS_STYLES, type DeliveryPlanStatus } from '@/lib/clearance';
import { planDelivery, recordDelivered, type ClearanceActionState } from './actions';
import { BUTTON, Card, FIELD, LABEL, Note, PRIMARY } from '../ui';
import { formatDay } from '@/lib/dates';

const EMPTY: ClearanceActionState = {};

export interface DeliveryPlanRow {
  id: string;
  plannedFor: string;
  cfsName: string;
  status: DeliveryPlanStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  supportNotifiedAt: string | null;
}

export function DeliveryPlans({
  jobId,
  plans,
  cfsOptions,
  outOfChargeOn,
  deliveredOn,
  defaultCfsId,
}: {
  jobId: string;
  plans: DeliveryPlanRow[];
  cfsOptions: { id: string; name: string }[];
  outOfChargeOn: string | null;
  deliveredOn: string | null;
  defaultCfsId: string | null;
}) {
  const [planState, planAction, planning] = useActionState(planDelivery, EMPTY);
  const [deliveredState, deliveredAction, saving] = useActionState(recordDelivered, EMPTY);

  const approved = plans.some((p) => p.status === 'received');

  return (
    <Card title="Delivery planning" step={7} done={deliveredOn !== null}>
      {!outOfChargeOn ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Nothing moves before out of charge.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Propose a day and the CFS answers in their own queue. A refusal tells customer
            support so they can warn the customer.
          </p>

          {plans.length > 0 && (
            <ul className="-mx-5 mb-3 divide-y divide-slate-100 border-y border-slate-100">
              {plans.map((plan) => (
                <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {formatDay(plan.plannedFor)}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {plan.cfsName}
                      {plan.decisionNote && ` · ${plan.decisionNote}`}
                    </div>
                    {plan.status === 'waived' && !plan.supportNotifiedAt && (
                      <div className="mt-0.5 text-xs text-amber-700">
                        Customer support was not reached — tell them by hand.
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STATUS_STYLES[plan.status]}`}
                  >
                    {PLAN_STATUS_LABELS[plan.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {cfsOptions.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No container freight stations are set up. Add one under Settings → CFS.
            </p>
          ) : (
            <form action={planAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="jobId" value={jobId} />
              <div>
                <label htmlFor="plannedFor" className={LABEL}>
                  Deliver on
                </label>
                <input id="plannedFor" name="plannedFor" type="date" required className={FIELD} />
              </div>
              <div>
                <label htmlFor="cfsId" className={LABEL}>
                  From
                </label>
                <select id="cfsId" name="cfsId" defaultValue={defaultCfsId ?? ''} required className={FIELD}>
                  <option value="" disabled>
                    Choose a CFS…
                  </option>
                  {cfsOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={planning} className={BUTTON}>
                {planning ? 'Sending…' : 'Put to the CFS'}
              </button>
            </form>
          )}
          <Note state={planState} />

          {approved && (
            <form
              action={deliveredAction}
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
            >
              <input type="hidden" name="jobId" value={jobId} />
              <div>
                <label htmlFor="deliveredOn" className={LABEL}>
                  Delivered on
                </label>
                <input
                  id="deliveredOn"
                  name="deliveredOn"
                  type="date"
                  required
                  defaultValue={deliveredOn ?? ''}
                  className={FIELD}
                />
              </div>
              <button type="submit" disabled={saving} className={PRIMARY}>
                {saving ? 'Saving…' : 'Record delivery'}
              </button>
              <span className="text-xs text-slate-500">This closes the job.</span>
            </form>
          )}
          <Note state={deliveredState} />
        </>
      )}
    </Card>
  );
}
