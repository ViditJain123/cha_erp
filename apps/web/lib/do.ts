// Deliberately not `server-only`, unlike lib/jobs.ts: everything here is pure —
// label maps and calendar arithmetic, no queries and no secrets — so the client
// components can share the same deposit vocabulary rather than restating it,
// and the deadline maths can be unit tested outside a request.
import type { Tables } from '@checklist/db';

export type DoStatus = Tables<'job_do'>['status'];
export type DeliveryMode = Tables<'job_do'>['delivery_mode'];
export type DepositStatus = Tables<'job_do_containers'>['deposit_status'];
export type DoInvoiceKind = Tables<'job_do_invoices'>['kind'];

export const DO_STATUS_LABELS: Record<DoStatus, string> = {
  open: 'Not started',
  documents: 'Collecting documents',
  invoice: 'Invoice to scrutinise',
  payment: 'Payment',
  awaiting_do: 'Awaiting the DO',
  do_received: 'DO received',
  delivered: 'Delivered',
  closed: 'Closed',
};

export const DO_STATUS_STYLES: Record<DoStatus, string> = {
  open: 'bg-slate-100 text-slate-700',
  documents: 'bg-blue-100 text-blue-800',
  invoice: 'bg-amber-100 text-amber-800',
  payment: 'bg-amber-100 text-amber-800',
  awaiting_do: 'bg-orange-100 text-orange-800',
  do_received: 'bg-violet-100 text-violet-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-600',
};

/** The order the DO progresses in — used for boards and for guarding transitions. */
export const DO_STATUS_ORDER: readonly DoStatus[] = [
  'open',
  'documents',
  'invoice',
  'payment',
  'awaiting_do',
  'do_received',
  'delivered',
  'closed',
];

export const DELIVERY_MODE_LABELS: Record<NonNullable<DeliveryMode>, string> = {
  loaded: 'Loaded out',
  destuffed: 'De-stuffed at CFS',
};

export const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  not_applicable: 'Covered',
  pending: 'Payable',
  paid: 'Paid',
  claimed: 'Refund claimed',
  refunded: 'Refunded',
  forfeited: 'Forfeited',
};

export const DEPOSIT_STATUS_STYLES: Record<DepositStatus, string> = {
  not_applicable: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-blue-100 text-blue-800',
  claimed: 'bg-violet-100 text-violet-800',
  refunded: 'bg-emerald-100 text-emerald-800',
  forfeited: 'bg-red-100 text-red-800',
};

export const INVOICE_KIND_LABELS: Record<DoInvoiceKind, string> = {
  proforma: 'Proforma invoice',
  final: 'Final invoice',
};

/** The shipping line's security deposit has to be back within this many days of delivery. */
export const DEPOSIT_REFUND_DAYS = 15;
/** How many days before a deadline it stops being amber and turns red. */
export const DEPOSIT_ESCALATE_DAYS = 3;
/** Free time and DO expiry warn this far ahead. */
export const WARN_AHEAD_DAYS = 3;

// ------------------------------------------------------------- date maths ----

// Moved to lib/dates.ts once clearance needed the same helpers and every screen
// needed one date format. Re-exported so the existing callers here and in the
// DO components keep working.
import { addDays, daysUntil, formatDay } from './dates';

export { addDays, daysUntil, formatDay };

// ---------------------------------------------------------------- alerts ----

export type DoAlertKind = 'invoice_call' | 'free_time' | 'deposit_refund' | 'do_expiry';
export type DoAlertLevel = 'soon' | 'due' | 'overdue';

export interface DoAlert {
  kind: DoAlertKind;
  level: DoAlertLevel;
  /** The day it falls due, as a `date` string. */
  dueOn: string;
  /** Negative once overdue. */
  daysLeft: number;
  label: string;
  containerNo?: string;
}

export interface DoAlertContainer {
  containerNo: string;
  freeDays: number | null;
  freeTimeFrom: string | null;
  returnedOn: string | null;
  depositStatus: DepositStatus;
}

export interface DoAlertInput {
  eta: string | null;
  status: DoStatus;
  freeDays: number | null;
  freeTimeFrom: string | null;
  deliveredAt: string | null;
  doValidUntil: string | null;
  /** True once the proforma invoice has actually been scrutinised. */
  proformaScrutinised: boolean;
  containers: DoAlertContainer[];
}

export const ALERT_STYLES: Record<DoAlertLevel, string> = {
  soon: 'bg-amber-50 text-amber-800 border-amber-200',
  due: 'bg-amber-100 text-amber-900 border-amber-300',
  overdue: 'bg-red-50 text-red-700 border-red-200',
};

function level(daysLeft: number, escalateWithin: number): DoAlertLevel {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= escalateWithin) return 'due';
  return 'soon';
}

function plural(days: number): string {
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * Every DO deadline, in one place.
 *
 * Deliberately pure and derived rather than stored: a corrected ETA or an
 * edited free-day count has to move the dates it implies, and a `last_free_day`
 * column would quietly keep the old answer. The dashboard, the job list and the
 * DO tab all call this, so all three agree by construction.
 *
 * Only returns what is worth acting on — nothing more than `WARN_AHEAD_DAYS`
 * out, and nothing already settled.
 */
export function doAlerts(input: DoAlertInput): DoAlert[] {
  const alerts: DoAlert[] = [];

  // The invoice call happens the day before ETA. It stops mattering once the
  // proforma has been scrutinised, whatever the DO's status.
  if (input.eta && !input.proformaScrutinised && input.status !== 'closed') {
    const dueOn = addDays(input.eta, -1);
    const daysLeft = daysUntil(dueOn);
    if (daysLeft <= WARN_AHEAD_DAYS) {
      alerts.push({
        kind: 'invoice_call',
        level: level(daysLeft, 1),
        dueOn,
        daysLeft,
        label:
          daysLeft < 0
            ? `Invoice call was due ${plural(daysLeft)} ago`
            : daysLeft === 0
              ? 'Invoice call is due today'
              : `Invoice call in ${plural(daysLeft)}`,
      });
    }
  }

  // Detention free time, per container. A box already back with the line has
  // stopped accruing, so it is not chased.
  for (const container of input.containers) {
    if (container.returnedOn) continue;
    const days = container.freeDays ?? input.freeDays;
    const from = container.freeTimeFrom ?? input.freeTimeFrom ?? input.eta;
    if (days === null || !from) continue;

    const dueOn = addDays(from, days);
    const daysLeft = daysUntil(dueOn);
    if (daysLeft > WARN_AHEAD_DAYS) continue;

    alerts.push({
      kind: 'free_time',
      level: level(daysLeft, WARN_AHEAD_DAYS),
      dueOn,
      daysLeft,
      containerNo: container.containerNo,
      label:
        daysLeft < 0
          ? `${container.containerNo} in detention — free time ended ${plural(daysLeft)} ago`
          : daysLeft === 0
            ? `${container.containerNo} free time ends today`
            : `${container.containerNo} free time ends in ${plural(daysLeft)}`,
    });
  }

  // The deposit has to be back within 15 days of delivery. Escalates in the
  // last three, which is the window the desk actually works to.
  if (input.deliveredAt) {
    const dueOn = addDays(input.deliveredAt, DEPOSIT_REFUND_DAYS);
    const daysLeft = daysUntil(dueOn);
    const outstanding = input.containers.filter(
      (c) => c.depositStatus === 'paid' || c.depositStatus === 'claimed',
    );
    if (outstanding.length > 0 && daysLeft <= DEPOSIT_REFUND_DAYS) {
      alerts.push({
        kind: 'deposit_refund',
        level: level(daysLeft, DEPOSIT_ESCALATE_DAYS),
        dueOn,
        daysLeft,
        label:
          daysLeft < 0
            ? `Deposit on ${outstanding.length} container(s) overdue by ${plural(daysLeft)}`
            : `Deposit on ${outstanding.length} container(s) to recover within ${plural(daysLeft)}`,
      });
    }
  }

  // A DO that expires before delivery is taken has to be re-issued.
  if (input.doValidUntil && !input.deliveredAt) {
    const daysLeft = daysUntil(input.doValidUntil);
    if (daysLeft <= WARN_AHEAD_DAYS) {
      alerts.push({
        kind: 'do_expiry',
        level: level(daysLeft, WARN_AHEAD_DAYS),
        dueOn: input.doValidUntil,
        daysLeft,
        label:
          daysLeft < 0
            ? `The DO expired ${plural(daysLeft)} ago`
            : daysLeft === 0
              ? 'The DO expires today'
              : `The DO expires in ${plural(daysLeft)}`,
      });
    }
  }

  return alerts.sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * The worst level among a set of alerts, for a single badge.
 *
 * Takes anything carrying a level, not `DoAlert` specifically — the clearance
 * track raises its own alert shape and wants the same badge.
 */
export function worstLevel<T extends { level: DoAlertLevel }>(alerts: T[]): DoAlertLevel | null {
  if (alerts.some((a) => a.level === 'overdue')) return 'overdue';
  if (alerts.some((a) => a.level === 'due')) return 'due';
  if (alerts.length > 0) return 'soon';
  return null;
}

/** The last free day for one container, or null when the terms are not known yet. */
export function lastFreeDay(
  container: Pick<DoAlertContainer, 'freeDays' | 'freeTimeFrom'>,
  fallback: { freeDays: number | null; freeTimeFrom: string | null; eta: string | null },
): string | null {
  const days = container.freeDays ?? fallback.freeDays;
  const from = container.freeTimeFrom ?? fallback.freeTimeFrom ?? fallback.eta;
  if (days === null || !from) return null;
  return addDays(from, days);
}

