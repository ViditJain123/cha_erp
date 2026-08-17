'use client';

import { useActionState } from 'react';
import {
  QUERY_SOURCE_LABELS,
  QUERY_STATUS_LABELS,
  RMS_ROUTE_LABELS,
  rupees,
  type DutyComparison,
} from '@/lib/clearance';
import {
  addQuery,
  checkAssessedDuty,
  recordDutyPayment,
  recordOutOfCharge,
  recordShed,
  replyToQuery,
  resolveVariance,
  saveNoting,
  savePassing,
  saveRmsRoute,
  type ClearanceActionState,
} from './actions';
import { BUTTON, Card, FIELD, LABEL, Note, PRIMARY, SMALL_FIELD } from '../ui';
import { formatDay } from '@/lib/dates';

const EMPTY: ClearanceActionState = {};

// ------------------------------------------------------------------ noting --

export function NotingCard({
  jobId,
  beNumber,
  beDate,
  notedAt,
  rmsRoute,
}: {
  jobId: string;
  beNumber: string | null;
  beDate: string | null;
  notedAt: string | null;
  rmsRoute: string | null;
}) {
  const [noteState, noteAction, noting] = useActionState(saveNoting, EMPTY);
  const [rmsState, rmsAction, savingRms] = useActionState(saveRmsRoute, EMPTY);

  return (
    <Card title="Noting" step={1} done={notedAt !== null && rmsRoute !== null}>
      <p className="mb-3 text-xs text-slate-500">
        The Bill of Entry filed against the IGM. There is nothing to work here — a number, a date,
        and how the Risk Management System routed it.
      </p>

      <form action={noteAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="beNumber" className={LABEL}>
            BE number
          </label>
          <input id="beNumber" name="beNumber" required defaultValue={beNumber ?? ''} className={FIELD} />
        </div>
        <div>
          <label htmlFor="beDate" className={LABEL}>
            Noted on
          </label>
          <input id="beDate" name="beDate" type="date" required defaultValue={beDate ?? ''} className={FIELD} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={noting} className={PRIMARY}>
            {noting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      <Note state={noteState} />

      <form action={rmsAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
        <input type="hidden" name="jobId" value={jobId} />
        <div className="min-w-56 flex-1">
          <label htmlFor="rmsRoute" className={LABEL}>
            RMS routed it as
          </label>
          <select id="rmsRoute" name="rmsRoute" defaultValue={rmsRoute ?? ''} required className={FIELD}>
            <option value="" disabled>
              Choose…
            </option>
            {Object.entries(RMS_ROUTE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={savingRms} className={BUTTON}>
          {savingRms ? 'Saving…' : 'Save route'}
        </button>
      </form>
      {rmsRoute === 'facilitated' && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Facilitated — customs did not assess this one, so there is no passing to do. It goes
          straight to duty.
        </p>
      )}
      <Note state={rmsState} />
    </Card>
  );
}

// ----------------------------------------------------------------- passing --

export function PassingCard({
  jobId,
  entryInwardsDate,
  appraiserPassedAt,
  acPassedAt,
  checklistDuty,
  assessedDuty,
  dutyCheckedAt,
  variance,
  varianceRaisedAt,
  varianceResolvedAt,
  varianceNote,
}: {
  jobId: string;
  entryInwardsDate: string | null;
  appraiserPassedAt: string | null;
  acPassedAt: string | null;
  checklistDuty: number | null;
  assessedDuty: number | null;
  dutyCheckedAt: string | null;
  variance: DutyComparison;
  varianceRaisedAt: string | null;
  varianceResolvedAt: string | null;
  varianceNote: string | null;
}) {
  const [passState, passAction, passing] = useActionState(savePassing, EMPTY);
  const [dutyState, dutyAction, checking] = useActionState(checkAssessedDuty, EMPTY);
  const [resolveState, resolveAction, resolving] = useActionState(resolveVariance, EMPTY);

  const open = varianceRaisedAt !== null && varianceResolvedAt === null;

  return (
    <Card title="Passing" step={2} done={dutyCheckedAt !== null && !open}>
      <form action={passAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="entryInwardsDate" className={LABEL}>
            Entry inwards
          </label>
          <input
            id="entryInwardsDate"
            name="entryInwardsDate"
            type="date"
            required
            defaultValue={entryInwardsDate ?? ''}
            className={FIELD}
          />
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-end gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="appraiserPassed" defaultChecked={appraiserPassedAt !== null} />
            Appraiser passed
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="acPassed" defaultChecked={acPassedAt !== null} />
            AC passed
          </label>
          <button type="submit" disabled={passing} className={BUTTON}>
            {passing ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      <p className="mt-1 text-xs text-slate-400">
        Entry inwards is what fixes the rate of exchange and the duty applicable.
      </p>
      <Note state={passState} />

      <div className="mt-4 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-medium">The duty check</h3>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          What customs assessed, against what the checklist printed. A gap means a classification
          or a value moved — the job goes back to scrutiny rather than being paid.
        </p>

        <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">On the checklist</div>
            <div className="mt-0.5 font-medium">{rupees(checklistDuty)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Assessed</div>
            <div className="mt-0.5 font-medium">{rupees(assessedDuty)}</div>
          </div>
          {variance.comparable && (
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Difference</div>
              <div
                className={`mt-0.5 font-medium ${variance.matches ? 'text-emerald-700' : 'text-red-600'}`}
              >
                {variance.matches ? 'agrees' : rupees(variance.difference)}
              </div>
            </div>
          )}
        </div>

        {checklistDuty === null ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No checklist duty is recorded, so there is nothing to compare against. Upload the
            checklist with its duty from the Scrutiny tab first.
          </p>
        ) : (
          <form action={dutyAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="jobId" value={jobId} />
            <div>
              <label htmlFor="assessedDuty" className={LABEL}>
                Duty customs assessed
              </label>
              <input
                id="assessedDuty"
                name="assessedDuty"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={assessedDuty ?? ''}
                className={FIELD}
              />
            </div>
            <button type="submit" disabled={checking} className={PRIMARY}>
              {checking ? 'Checking…' : 'Check against the checklist'}
            </button>
          </form>
        )}
        <Note state={dutyState} />

        {open && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-800">
              This job is back with scrutiny. Tell the shipper from the Scrutiny tab, get the
              checklist revised if the figure was wrong, then say here what happened.
            </p>
            <form action={resolveAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="jobId" value={jobId} />
              <input
                name="varianceNote"
                required
                placeholder="Customs reclassified to 39021000; revised checklist uploaded"
                className={`min-w-64 flex-1 ${SMALL_FIELD}`}
              />
              <button type="submit" disabled={resolving} className={BUTTON}>
                {resolving ? 'Saving…' : 'Close the variance'}
              </button>
            </form>
            <Note state={resolveState} />
          </div>
        )}

        {varianceResolvedAt && varianceNote && (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Earlier variance closed: {varianceNote}
          </p>
        )}
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------- queries --

export interface QueryRow {
  id: string;
  raisedOn: string;
  source: string;
  queryText: string;
  status: 'open' | 'replied' | 'closed';
  repliedOn: string | null;
  replyNote: string | null;
}

const QUERY_STATUS_STYLES: Record<QueryRow['status'], string> = {
  open: 'bg-amber-100 text-amber-800',
  replied: 'bg-blue-100 text-blue-800',
  closed: 'bg-slate-200 text-slate-600',
};

function QueryItem({ jobId, query }: { jobId: string; query: QueryRow }) {
  const [state, formAction, pending] = useActionState(replyToQuery, EMPTY);

  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">{query.queryText}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {QUERY_SOURCE_LABELS[query.source] ?? query.source} · raised{' '}
            {formatDay(query.raisedOn)}
          </div>
          {query.replyNote && (
            <div className="mt-1 text-xs text-slate-600">Replied: {query.replyNote}</div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${QUERY_STATUS_STYLES[query.status]}`}
        >
          {QUERY_STATUS_LABELS[query.status]}
        </span>
      </div>
      {query.status !== 'closed' && (
        <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="queryId" value={query.id} />
          <input
            name="replyNote"
            defaultValue={query.replyNote ?? ''}
            placeholder="What was sent back"
            className={`min-w-56 flex-1 ${SMALL_FIELD}`}
          />
          <input name="repliedOn" type="date" defaultValue={query.repliedOn ?? ''} className={SMALL_FIELD} />
          <button type="submit" name="status" value="replied" disabled={pending} className={BUTTON}>
            Replied
          </button>
          <button type="submit" name="status" value="closed" disabled={pending} className={BUTTON}>
            Closed
          </button>
        </form>
      )}
      {state.error && <div className="mt-2 text-xs text-red-600">{state.error}</div>}
    </li>
  );
}

export function Queries({ jobId, queries }: { jobId: string; queries: QueryRow[] }) {
  const [state, formAction, pending] = useActionState(addQuery, EMPTY);
  const open = queries.filter((q) => q.status === 'open').length;

  return (
    <Card title={`Customs queries${open > 0 ? ` (${open} open)` : ''}`}>
      {queries.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing raised. Most jobs never have one.</p>
      ) : (
        <ul className="-mx-5 divide-y divide-slate-100 border-y border-slate-100">
          {queries.map((query) => (
            <QueryItem key={query.id} jobId={jobId} query={query} />
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input
          name="queryText"
          required
          placeholder="What customs asked"
          className={`min-w-56 flex-1 ${SMALL_FIELD}`}
        />
        <select name="source" defaultValue="appraiser" className={SMALL_FIELD}>
          {Object.entries(QUERY_SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input name="raisedOn" type="date" required className={SMALL_FIELD} />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Adding…' : 'Add query'}
        </button>
      </form>
      <Note state={state} />
    </Card>
  );
}

// ------------------------------------------------------------ duty and shed --

export function DutyPaymentCard({
  jobId,
  dutyPaidOn,
  dutyAmount,
  dutyChallanNo,
  assessedDuty,
  blocked,
}: {
  jobId: string;
  dutyPaidOn: string | null;
  dutyAmount: number | null;
  dutyChallanNo: string | null;
  assessedDuty: number | null;
  blocked: boolean;
}) {
  const [state, formAction, pending] = useActionState(recordDutyPayment, EMPTY);

  return (
    <Card title="Duty payment" step={3} done={dutyPaidOn !== null}>
      {blocked && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          There is an open duty variance. Nothing is paid until scrutiny has settled it.
        </p>
      )}
      <form action={formAction} className="grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="dutyPaidOn" className={LABEL}>
            Paid on
          </label>
          <input id="dutyPaidOn" name="dutyPaidOn" type="date" required defaultValue={dutyPaidOn ?? ''} className={FIELD} />
        </div>
        <div>
          <label htmlFor="dutyAmount" className={LABEL}>
            Amount
          </label>
          <input
            id="dutyAmount"
            name="dutyAmount"
            type="number"
            min={0}
            step="0.01"
            defaultValue={dutyAmount ?? assessedDuty ?? ''}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="dutyChallanNo" className={LABEL}>
            Challan
          </label>
          <input id="dutyChallanNo" name="dutyChallanNo" defaultValue={dutyChallanNo ?? ''} className={FIELD} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending || blocked} className={PRIMARY}>
            {pending ? 'Saving…' : 'Record payment'}
          </button>
        </div>
      </form>
      <Note state={state} />
    </Card>
  );
}

export function ShedCard({
  jobId,
  goodsRegisteredOn,
  examinedOn,
  dutyPaidOn,
}: {
  jobId: string;
  goodsRegisteredOn: string | null;
  examinedOn: string | null;
  dutyPaidOn: string | null;
}) {
  const [state, formAction, pending] = useActionState(recordShed, EMPTY);

  return (
    <Card title="At the shed" step={4} done={examinedOn !== null}>
      <p className="mb-3 text-xs text-slate-500">
        The goods are registered once the duty is paid, then examined.
      </p>
      {!dutyPaidOn && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No duty payment is recorded yet.
        </p>
      )}
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="goodsRegisteredOn" className={LABEL}>
            Goods registered
          </label>
          <input
            id="goodsRegisteredOn"
            name="goodsRegisteredOn"
            type="date"
            defaultValue={goodsRegisteredOn ?? ''}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="examinedOn" className={LABEL}>
            Examined
          </label>
          <input id="examinedOn" name="examinedOn" type="date" defaultValue={examinedOn ?? ''} className={FIELD} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      <Note state={state} />
    </Card>
  );
}

export function OutOfChargeCard({
  jobId,
  outOfChargeOn,
  oocReference,
  pendingNocs,
  dutyPaidOn,
}: {
  jobId: string;
  outOfChargeOn: string | null;
  oocReference: string | null;
  pendingNocs: string[];
  dutyPaidOn: string | null;
}) {
  const [state, formAction, pending] = useActionState(recordOutOfCharge, EMPTY);
  const blocked = pendingNocs.length > 0 || !dutyPaidOn;

  return (
    <Card title="Out of charge" step={6} done={outOfChargeOn !== null}>
      {pendingNocs.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Still waiting on {pendingNocs.join(', ')}. Customs will not release until it is in.
        </p>
      )}
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="outOfChargeOn" className={LABEL}>
            Granted on
          </label>
          <input
            id="outOfChargeOn"
            name="outOfChargeOn"
            type="date"
            required
            defaultValue={outOfChargeOn ?? ''}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="oocReference" className={LABEL}>
            Reference
          </label>
          <input id="oocReference" name="oocReference" defaultValue={oocReference ?? ''} className={FIELD} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending || blocked} className={PRIMARY}>
            {pending ? 'Saving…' : 'Record out of charge'}
          </button>
        </div>
      </form>
      <Note state={state} />
    </Card>
  );
}
