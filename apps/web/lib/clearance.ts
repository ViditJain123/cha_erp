// Not `server-only`, for the same reason lib/do.ts is not: label maps and
// arithmetic, no queries and no secrets, so the client components share one
// vocabulary and the derivation is testable outside a request.
import type { Tables } from '@checklist/db';
// Relative, not the `@/` alias: this file is unit tested, and vitest resolves
// only real paths — the alias is a Next build-time concern.
import { daysUntil, type DoAlertLevel } from './do';

export type ClearanceStatus = Tables<'job_clearance'>['status'];
export type RmsRoute = Tables<'job_clearance'>['rms_route'];
export type NocStatus = Tables<'job_clearance_nocs'>['status'];
export type QueryStatus = Tables<'job_clearance_queries'>['status'];
export type DeliveryPlanStatus = Tables<'job_delivery_plans'>['status'];

export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  noting: 'To be noted',
  passing: 'With the appraiser',
  duty_variance: 'Duty query — back with scrutiny',
  duty_payment: 'Duty to pay',
  goods_registration: 'Goods registration',
  examination: 'Under examination',
  out_of_charge: 'Awaiting out of charge',
  delivery_planning: 'Planning delivery',
  delivered: 'Delivered',
};

export const CLEARANCE_STATUS_STYLES: Record<ClearanceStatus, string> = {
  noting: 'bg-slate-100 text-slate-700',
  passing: 'bg-blue-100 text-blue-800',
  duty_variance: 'bg-red-100 text-red-800',
  duty_payment: 'bg-amber-100 text-amber-800',
  goods_registration: 'bg-amber-100 text-amber-800',
  examination: 'bg-violet-100 text-violet-800',
  out_of_charge: 'bg-orange-100 text-orange-800',
  delivery_planning: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-emerald-100 text-emerald-800',
};

/** The order clearance progresses in — used for boards and for guarding transitions. */
export const CLEARANCE_STATUS_ORDER: readonly ClearanceStatus[] = [
  'noting',
  'passing',
  'duty_variance',
  'duty_payment',
  'goods_registration',
  'examination',
  'out_of_charge',
  'delivery_planning',
  'delivered',
];

export const RMS_ROUTE_LABELS: Record<NonNullable<RmsRoute>, string> = {
  facilitated: 'Facilitated — no assessment',
  assessment: 'Marked for assessment',
  examination: 'Marked for examination',
};

export const NOC_STATUS_LABELS: Record<NocStatus, string> = {
  not_required: 'Not required',
  pending: 'Pending',
  received: 'Received',
};

export const NOC_STATUS_STYLES: Record<NocStatus, string> = {
  not_required: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-800',
};

export const QUERY_STATUS_LABELS: Record<QueryStatus, string> = {
  open: 'Open',
  replied: 'Replied',
  closed: 'Closed',
};

export const QUERY_SOURCE_LABELS: Record<string, string> = {
  appraiser: 'Appraiser',
  ac: 'AC / DC',
  shed: 'Shed',
  pga: 'Other agency',
};

/**
 * Delivery plans reuse `document_request_status` rather than twinning it —
 * `received` is an approved day, `waived` a refused one. These labels are the
 * only place that mapping is spelled out.
 */
export const PLAN_STATUS_LABELS: Record<DeliveryPlanStatus, string> = {
  pending: 'Awaiting the CFS',
  received: 'Approved',
  waived: 'Refused',
};

export const PLAN_STATUS_STYLES: Record<DeliveryPlanStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  received: 'bg-emerald-100 text-emerald-800',
  waived: 'bg-red-100 text-red-800',
};

/**
 * How far the assessed duty may sit from the checklist before it counts as a
 * variance.
 *
 * One rupee, not a percentage: both figures are exact amounts keyed off
 * documents — one printed by Logi-Sys, one read off ICEGATE — so any real gap
 * means customs changed a classification or a value. The rupee absorbs
 * rounding, nothing more. If the checklist figure ever becomes an estimate
 * this will cry wolf and should be revisited rather than widened blindly.
 */
export const DUTY_MATCH_TOLERANCE = 1;

/** How many days an unanswered customs query is tolerated before it is chased. */
export const QUERY_CHASE_DAYS = 2;

export interface DutyComparison {
  checklist: number | null;
  assessed: number | null;
  /** Positive when customs assessed more than the checklist said. */
  difference: number | null;
  matches: boolean;
  /** True only when both figures are known — an unchecked job is not a match. */
  comparable: boolean;
}

export function dutyVariance(checklist: number | null, assessed: number | null): DutyComparison {
  if (checklist === null || assessed === null) {
    return { checklist, assessed, difference: null, matches: false, comparable: false };
  }
  // `+ 0` normalises -0, which floating-point subtraction produces for figures
  // that are equal to the paise. Left alone it renders as "₹-0" and reads as
  // customs having assessed less.
  const difference = Math.round((assessed - checklist) * 100) / 100 + 0;
  return {
    checklist,
    assessed,
    difference,
    matches: Math.abs(difference) <= DUTY_MATCH_TOLERANCE,
    comparable: true,
  };
}

/** Formats a rupee figure the way the rest of the app does. */
export function rupees(value: number | null): string {
  return value === null ? '—' : `₹${value.toLocaleString('en-IN')}`;
}

// ---------------------------------------------------------------- alerts ----

export type ClearanceAlertKind =
  | 'duty_variance'
  | 'query_open'
  | 'noc_pending'
  | 'awaiting_cfs'
  | 'ooc_without_duty';

export interface ClearanceAlert {
  kind: ClearanceAlertKind;
  level: DoAlertLevel;
  label: string;
  /** Null for the alerts that are not about a date. */
  dueOn: string | null;
  daysLeft: number;
}

export interface ClearanceAlertInput {
  status: ClearanceStatus;
  checklistDuty: number | null;
  assessedDuty: number | null;
  varianceRaisedAt: string | null;
  varianceResolvedAt: string | null;
  dutyPaidOn: string | null;
  outOfChargeOn: string | null;
  deliveredOn: string | null;
  openQueries: { raisedOn: string }[];
  pendingNocs: { authority: string }[];
  pendingPlans: { plannedFor: string }[];
}

function plural(days: number): string {
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * Everything on a job's clearance that somebody has to act on.
 *
 * Pure and derived, like doAlerts: a corrected checklist duty or a resolved
 * variance has to move what the dashboard says without anything being
 * rewritten. The dashboard, the job list and the clearance tab all call this,
 * so all three agree by construction.
 */
export function clearanceAlerts(input: ClearanceAlertInput): ClearanceAlert[] {
  const alerts: ClearanceAlert[] = [];

  // The one that stops the job dead: customs assessed a different figure from
  // the checklist, so scrutiny has to look again before anything is paid.
  if (input.varianceRaisedAt && !input.varianceResolvedAt) {
    const variance = dutyVariance(input.checklistDuty, input.assessedDuty);
    alerts.push({
      kind: 'duty_variance',
      level: 'overdue',
      dueOn: null,
      daysLeft: -1,
      label:
        variance.difference === null
          ? 'Assessed duty differs from the checklist'
          : `Customs assessed ${rupees(Math.abs(variance.difference))} ${
              variance.difference > 0 ? 'more' : 'less'
            } than the checklist`,
    });
  }

  for (const query of input.openQueries) {
    const age = -daysUntil(query.raisedOn);
    if (age < QUERY_CHASE_DAYS) continue;
    alerts.push({
      kind: 'query_open',
      level: age >= QUERY_CHASE_DAYS * 2 ? 'overdue' : 'due',
      dueOn: query.raisedOn,
      daysLeft: -age,
      label: `A customs query has been open ${plural(age)}`,
    });
  }

  // A pending NOC blocks out of charge, so it only matters once the goods are
  // otherwise ready to be released.
  if (input.pendingNocs.length > 0 && !input.outOfChargeOn) {
    alerts.push({
      kind: 'noc_pending',
      level: input.status === 'out_of_charge' ? 'due' : 'soon',
      dueOn: null,
      daysLeft: 0,
      label: `Waiting on ${input.pendingNocs.map((n) => n.authority).join(', ')}`,
    });
  }

  for (const plan of input.pendingPlans) {
    const daysLeft = daysUntil(plan.plannedFor);
    alerts.push({
      kind: 'awaiting_cfs',
      level: daysLeft < 0 ? 'overdue' : daysLeft <= 1 ? 'due' : 'soon',
      dueOn: plan.plannedFor,
      daysLeft,
      label:
        daysLeft < 0
          ? `The CFS never answered for ${plan.plannedFor}`
          : daysLeft === 0
            ? 'The CFS has not confirmed today’s delivery'
            : `Awaiting the CFS for a delivery in ${plural(daysLeft)}`,
    });
  }

  // An integrity check rather than a deadline: nothing should reach out of
  // charge without a duty payment recorded against it.
  if (input.outOfChargeOn && !input.dutyPaidOn) {
    alerts.push({
      kind: 'ooc_without_duty',
      level: 'overdue',
      dueOn: input.outOfChargeOn,
      daysLeft: daysUntil(input.outOfChargeOn),
      label: 'Out of charge is recorded but no duty payment is',
    });
  }

  return alerts.sort((a, b) => a.daysLeft - b.daysLeft);
}
