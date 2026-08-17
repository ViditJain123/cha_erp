'use client';

import { useActionState } from 'react';
import { recordDelivery, recordDo, type DoActionState } from './actions';
import { BUTTON, Card, FIELD, LABEL, Note } from '../ui';
import { formatDay, formatStamp } from '@/lib/dates';

const EMPTY: DoActionState = {};

export function DoIssue({
  jobId,
  doNumber,
  doChannel,
  doReceivedAt,
  doValidUntil,
  operationsNotifiedAt,
  deliveredAt,
  depositDueOn,
  issuesVia,
}: {
  jobId: string;
  doNumber: string | null;
  doChannel: string | null;
  doReceivedAt: string | null;
  doValidUntil: string | null;
  operationsNotifiedAt: string | null;
  deliveredAt: string | null;
  depositDueOn: string | null;
  issuesVia: string | null;
}) {
  const [doState, doAction, savingDo] = useActionState(recordDo, EMPTY);
  const [deliveryState, deliveryAction, savingDelivery] = useActionState(recordDelivery, EMPTY);

  return (
    <Card title="The delivery order" step={6} done={deliveredAt !== null}>
      {issuesVia === 'odex' && (
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          This line issues on ODeX. There is no ODeX integration — record here what was done there.
        </p>
      )}

      <form action={doAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="doNumber" className={LABEL}>
            DO number
          </label>
          <input
            id="doNumber"
            name="doNumber"
            required
            defaultValue={doNumber ?? ''}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="doChannel" className={LABEL}>
            Came from
          </label>
          <select
            id="doChannel"
            name="doChannel"
            defaultValue={doChannel ?? (issuesVia === 'odex' ? 'odex' : 'email')}
            className={FIELD}
          >
            <option value="email">Email</option>
            <option value="odex">ODeX</option>
          </select>
        </div>
        <div>
          <label htmlFor="doReceivedAt" className={LABEL}>
            Received on
          </label>
          <input
            id="doReceivedAt"
            name="doReceivedAt"
            type="date"
            required
            defaultValue={doReceivedAt ?? ''}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="doValidUntil" className={LABEL}>
            Valid until
          </label>
          <input
            id="doValidUntil"
            name="doValidUntil"
            type="date"
            defaultValue={doValidUntil ?? ''}
            className={FIELD}
          />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={savingDo} className={BUTTON}>
            {savingDo ? 'Saving…' : doNumber ? 'Update the DO' : 'Record the DO'}
          </button>
          {operationsNotifiedAt && (
            <span className="ml-3 text-xs text-emerald-700">
              Operations told {formatStamp(operationsNotifiedAt)} — delivery can
              be taken.
            </span>
          )}
        </div>
      </form>
      <Note state={doState} />

      <form action={deliveryAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="deliveredAt" className={LABEL}>
            Delivery taken on
          </label>
          <input
            id="deliveredAt"
            name="deliveredAt"
            type="date"
            required
            defaultValue={deliveredAt ?? ''}
            className={FIELD}
          />
        </div>
        <button type="submit" disabled={savingDelivery} className={BUTTON}>
          {savingDelivery ? 'Saving…' : 'Record delivery'}
        </button>
        {depositDueOn && (
          <span className="text-xs text-slate-500">
            Deposit to be recovered by{' '}
            <strong>{formatDay(depositDueOn)}</strong>
          </span>
        )}
      </form>
      <Note state={deliveryState} />
    </Card>
  );
}
