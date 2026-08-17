'use client';

import { useActionState } from 'react';
import { saveFreeTime, type DoActionState } from './actions';
import { Card, FIELD, LABEL, Note, PRIMARY } from '../ui';
import { formatDay } from '@/lib/dates';

const EMPTY: DoActionState = {};

const SOURCE_LABELS: Record<string, string> = {
  bill_of_lading: 'read off the B/L',
  shipping_line: 'from the shipping line master',
  manual: 'entered by hand',
};

export function FreeTime({
  jobId,
  freeDays,
  freeTimeFrom,
  source,
  lastFreeDay,
  daysLeft,
  etaIsAnchor,
}: {
  jobId: string;
  freeDays: number | null;
  freeTimeFrom: string | null;
  source: string | null;
  lastFreeDay: string | null;
  daysLeft: number | null;
  etaIsAnchor: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveFreeTime, EMPTY);

  return (
    <Card title="Detention free period" step={2} done={freeDays !== null}>
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="freeDays" className={LABEL}>
            Free days
          </label>
          <input
            id="freeDays"
            name="freeDays"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={freeDays ?? ''}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="freeTimeFrom" className={LABEL}>
            Counted from
          </label>
          <input
            id="freeTimeFrom"
            name="freeTimeFrom"
            type="date"
            required
            defaultValue={freeTimeFrom ?? ''}
            className={FIELD}
          />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {source && <span>Free days {SOURCE_LABELS[source] ?? source}.</span>}
        {lastFreeDay && (
          <span>
            Last free day{' '}
            <strong className={daysLeft !== null && daysLeft < 0 ? 'text-red-600' : 'text-slate-700'}>
              {formatDay(lastFreeDay)}
            </strong>
            {daysLeft !== null &&
              (daysLeft < 0
                ? ` — ${Math.abs(daysLeft)} day(s) into detention`
                : ` — ${daysLeft} day(s) left`)}
          </span>
        )}
      </div>

      {etaIsAnchor && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Counting from the ETA, which is an estimate. Most lines count free time from actual
          discharge — correct the date above once the vessel is in.
        </p>
      )}

      <Note state={state} />
    </Card>
  );
}
