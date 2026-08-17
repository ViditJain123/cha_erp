import type { Metadata } from 'next';
import Link from 'next/link';
import { daysUntil } from '@/lib/do';
import { PLAN_STATUS_LABELS, PLAN_STATUS_STYLES } from '@/lib/clearance';
import { listPendingPlans } from './actions';
import { PlanRow } from './plan-row';
import { formatDay } from '@/lib/dates';

export const metadata: Metadata = { title: 'Delivery planning' };
export const dynamic = 'force-dynamic';

/**
 * The CFS desk's queue.
 *
 * This is the channel of record for a delivery decision, not the email that
 * announced it: the mailbox poller only processes messages carrying
 * attachments, so a plain-text "yes, approved" reply would never reach the job.
 */
export default async function DeliveryPlanningPage() {
  const { ctx, plans, decided, noStation } = await listPendingPlans();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Delivery planning</h1>
        <p className="mt-1 text-sm text-slate-500">
          {ctx.team === 'cfs'
            ? 'Deliveries proposed at your station. Answering here is what tells the clearance desk — and, if it is a no, customer support.'
            : 'Every delivery day waiting on a CFS.'}
        </p>
      </div>

      {noStation ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          You are on the CFS team but no station has been assigned to you, so there is nothing to
          show. Ask an administrator to set one on the Team page.
        </div>
      ) : (
        <>
          {plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
              <div className="font-medium text-slate-700">Nothing waiting</div>
              <p className="mx-auto mt-1 max-w-md">
                Jobs appear here once they are out of charge and the clearance desk proposes a
                delivery day.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">
                {plans.length} awaiting an answer
              </div>
              <ul className="divide-y divide-slate-100">
                {plans.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} daysLeft={daysUntil(plan.plannedFor)} />
                ))}
              </ul>
            </div>
          )}

          {/* Answering removes a row from the queue above, so it reappears here
              — otherwise nothing tells the person their click landed. */}
          {decided.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-semibold">Answered in the last day</h2>
              </div>
              <ul className="divide-y divide-slate-100">
                {decided.map((plan) => (
                  <li key={plan.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/jobs/${plan.jobId}/clearance`}
                        className="block truncate text-sm font-medium text-indigo-600 hover:underline"
                      >
                        {plan.jobLabel}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {formatDay(plan.plannedFor)}
                        {plan.decisionNote && ` · ${plan.decisionNote}`}
                      </div>
                      {plan.status === 'waived' && !plan.supportNotified && (
                        <div className="mt-0.5 text-xs text-amber-700">
                          Customer support could not be reached — tell them by hand.
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
