'use client';

import { useActionState, useState } from 'react';
import { saveBlCheck, type DoActionState } from './actions';
import { Card, FIELD, LABEL, Note, PRIMARY } from '../ui';
import { formatStamp } from '@/lib/dates';

const EMPTY: DoActionState = {};

export function BlCheck({
  jobId,
  surrendered,
  surrenderMode,
  collected,
  checkedAt,
  seededFromDocument,
}: {
  jobId: string;
  surrendered: boolean | null;
  surrenderMode: string | null;
  collected: boolean;
  checkedAt: string | null;
  seededFromDocument: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveBlCheck, EMPTY);
  const [isSurrendered, setIsSurrendered] = useState(surrendered);

  return (
    <Card title="Bill of lading" step={1} done={checkedAt !== null}>
      {checkedAt === null && seededFromDocument && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The B/L reads as surrendered. Confirm it below — nothing counts as checked until someone
          says so.
        </p>
      )}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="jobId" value={jobId} />

        <div>
          <span className={LABEL}>Has the B/L been surrendered?</span>
          <div className="flex gap-2">
            {(
              [
                ['yes', 'Surrendered'],
                ['no', 'Original in circulation'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                  (isSurrendered === true && value === 'yes') ||
                  (isSurrendered === false && value === 'no')
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                    : 'border-slate-300 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="blSurrendered"
                  value={value}
                  className="sr-only"
                  checked={
                    (isSurrendered === true && value === 'yes') ||
                    (isSurrendered === false && value === 'no')
                  }
                  onChange={() => setIsSurrendered(value === 'yes')}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {isSurrendered === true && (
          <div>
            <label htmlFor="blSurrenderMode" className={LABEL}>
              How
            </label>
            <select
              id="blSurrenderMode"
              name="blSurrenderMode"
              defaultValue={surrenderMode === 'express' ? 'express' : 'telex'}
              className={FIELD}
            >
              <option value="telex">Telex release</option>
              <option value="express">Express / seaway bill</option>
            </select>
          </div>
        )}

        {isSurrendered === false && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="blCollected" defaultChecked={collected} />
            The original B/L has been collected
          </label>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          {checkedAt && (
            <span className="text-xs text-slate-500">
              Checked {formatStamp(checkedAt)}
              {surrendered === false && !collected && ' · original not collected yet'}
            </span>
          )}
        </div>
      </form>

      {surrendered === false && !collected && checkedAt && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The line will not release against a B/L nobody holds. Collect the original, or get it
          surrendered, before chasing the DO.
        </p>
      )}

      <Note state={state} />
    </Card>
  );
}
