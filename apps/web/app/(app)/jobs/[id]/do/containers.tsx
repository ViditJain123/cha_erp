'use client';

import { useActionState, useState } from 'react';
import {
  addContainer,
  removeContainer,
  saveContainer,
  saveDeposit,
  type DoActionState,
} from './actions';
import {
  DEPOSIT_STATUS_LABELS,
  DEPOSIT_STATUS_STYLES,
  type DepositStatus,
} from '@/lib/do';
import { BUTTON, Card, Note, SMALL_FIELD } from '../ui';
import { formatDay } from '@/lib/dates';

const EMPTY: DoActionState = {};

export interface ContainerRow {
  id: string;
  containerNo: string;
  sizeType: string | null;
  freeDays: number | null;
  freeTimeFrom: string | null;
  gatedOutOn: string | null;
  returnedOn: string | null;
  depositAmount: number | null;
  depositStatus: DepositStatus;
  depositPaidOn: string | null;
  depositClaimedOn: string | null;
  depositRefundedOn: string | null;
  /** Derived — inherits the job's terms when the container has none of its own. */
  lastFreeDay: string | null;
  daysLeft: number | null;
}

function Row({
  jobId,
  container,
  showDeposits,
}: {
  jobId: string;
  container: ContainerRow;
  showDeposits: boolean;
}) {
  const [termsState, termsAction, termsPending] = useActionState(saveContainer, EMPTY);
  const [depositState, depositAction, depositPending] = useActionState(saveDeposit, EMPTY);
  const [removeState, removeAction, removePending] = useActionState(removeContainer, EMPTY);
  const [open, setOpen] = useState(false);

  const overdue = container.daysLeft !== null && container.daysLeft < 0;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-sm font-medium">{container.containerNo}</span>
          {container.sizeType && (
            <span className="ml-2 text-xs text-slate-500">{container.sizeType}</span>
          )}
          <div className="mt-0.5 text-xs text-slate-500">
            {container.returnedOn ? (
              <>Returned {formatDay(container.returnedOn)}</>
            ) : container.lastFreeDay ? (
              <span className={overdue ? 'font-medium text-red-600' : undefined}>
                Free until {formatDay(container.lastFreeDay)}
                {container.daysLeft !== null &&
                  (overdue
                    ? ` · ${Math.abs(container.daysLeft)} day(s) in detention`
                    : ` · ${container.daysLeft} day(s) left`)}
              </span>
            ) : (
              'Free period not set'
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              DEPOSIT_STATUS_STYLES[container.depositStatus] ?? 'bg-slate-100 text-slate-600'
            }`}
          >
            {DEPOSIT_STATUS_LABELS[container.depositStatus] ?? container.depositStatus}
            {container.depositAmount !== null &&
              container.depositStatus !== 'not_applicable' &&
              ` · ₹${container.depositAmount.toLocaleString('en-IN')}`}
          </span>
          <button type="button" onClick={() => setOpen((v) => !v)} className={BUTTON}>
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
          <form action={termsAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="containerId" value={container.id} />
            <label className="text-xs text-slate-600">
              Free days
              <input
                name="freeDays"
                type="number"
                min={0}
                step={1}
                placeholder="job"
                defaultValue={container.freeDays ?? ''}
                className={`ml-1 w-20 ${SMALL_FIELD}`}
              />
            </label>
            <label className="text-xs text-slate-600">
              From
              <input
                name="freeTimeFrom"
                type="date"
                defaultValue={container.freeTimeFrom ?? ''}
                className={`ml-1 ${SMALL_FIELD}`}
              />
            </label>
            <label className="text-xs text-slate-600">
              Gated out
              <input
                name="gatedOutOn"
                type="date"
                defaultValue={container.gatedOutOn ?? ''}
                className={`ml-1 ${SMALL_FIELD}`}
              />
            </label>
            <label className="text-xs text-slate-600">
              Returned
              <input
                name="returnedOn"
                type="date"
                defaultValue={container.returnedOn ?? ''}
                className={`ml-1 ${SMALL_FIELD}`}
              />
            </label>
            <button type="submit" disabled={termsPending} className={BUTTON}>
              {termsPending ? 'Saving…' : 'Save terms'}
            </button>
          </form>
          <p className="text-xs text-slate-400">
            Leave free days and the from-date blank to follow the job&rsquo;s own period.
          </p>

          {showDeposits && (
            <form action={depositAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="containerId" value={container.id} />
              <label className="text-xs text-slate-600">
                Deposit
                <select
                  name="depositStatus"
                  defaultValue={container.depositStatus}
                  className={`ml-1 ${SMALL_FIELD}`}
                >
                  {Object.entries(DEPOSIT_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Amount
                <input
                  name="depositAmount"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={container.depositAmount ?? ''}
                  className={`ml-1 w-24 ${SMALL_FIELD}`}
                />
              </label>
              <label className="text-xs text-slate-600">
                Paid
                <input
                  name="depositPaidOn"
                  type="date"
                  defaultValue={container.depositPaidOn ?? ''}
                  className={`ml-1 ${SMALL_FIELD}`}
                />
              </label>
              <label className="text-xs text-slate-600">
                Claimed
                <input
                  name="depositClaimedOn"
                  type="date"
                  defaultValue={container.depositClaimedOn ?? ''}
                  className={`ml-1 ${SMALL_FIELD}`}
                />
              </label>
              <label className="text-xs text-slate-600">
                Refunded
                <input
                  name="depositRefundedOn"
                  type="date"
                  defaultValue={container.depositRefundedOn ?? ''}
                  className={`ml-1 ${SMALL_FIELD}`}
                />
              </label>
              <button type="submit" disabled={depositPending} className={BUTTON}>
                {depositPending ? 'Saving…' : 'Save deposit'}
              </button>
            </form>
          )}

          <form action={removeAction}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="containerId" value={container.id} />
            <button
              type="submit"
              disabled={removePending}
              className="text-xs text-red-600 hover:underline disabled:opacity-60"
            >
              Remove this container
            </button>
          </form>

          <Note state={termsState} />
          <Note state={depositState} />
          <Note state={removeState} />
        </div>
      )}
    </li>
  );
}

export function Containers({
  jobId,
  containers,
  showDeposits,
}: {
  jobId: string;
  containers: ContainerRow[];
  showDeposits: boolean;
}) {
  const [state, formAction, pending] = useActionState(addContainer, EMPTY);

  return (
    <Card title={`Containers (${containers.length})`}>
      {containers.length === 0 ? (
        <p className="text-xs text-slate-500">
          None found on the documents yet. Add them by hand below.
        </p>
      ) : (
        <ul className="-mx-5 divide-y divide-slate-100 border-y border-slate-100">
          {containers.map((container) => (
            <Row
              key={container.id}
              jobId={jobId}
              container={container}
              showDeposits={showDeposits}
            />
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input
          name="containerNo"
          placeholder="MSCU1234567"
          required
          className={`font-mono ${SMALL_FIELD}`}
        />
        <input name="sizeType" placeholder="40HC" size={8} className={SMALL_FIELD} />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Adding…' : 'Add container'}
        </button>
      </form>

      <Note state={state} />
    </Card>
  );
}
