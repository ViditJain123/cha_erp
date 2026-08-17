'use client';

import { useActionState } from 'react';
import { toggleHighSeaSale, type DoActionState } from './actions';
import { BUTTON, Note } from '../ui';
import { formatStamp } from '@/lib/dates';

const EMPTY: DoActionState = {};

export function HssPanel({
  jobId,
  isHighSeaSale,
  docsSentAt,
  outstandingHssDocs,
}: {
  jobId: string;
  isHighSeaSale: boolean;
  docsSentAt: string | null;
  outstandingHssDocs: number;
}) {
  const [state, formAction, pending] = useActionState(toggleHighSeaSale, EMPTY);

  return (
    <section
      className={`rounded-xl border p-5 shadow-sm ${
        isHighSeaSale ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'
      }`}
    >
      <h2 className="text-sm font-semibold">High sea sales</h2>
      <p className="mt-1 mb-3 text-xs text-slate-600">
        {isHighSeaSale
          ? 'This consignment was sold on high seas. The HSS documents have to reach the shipping line before it will issue the DO in the buyer’s name.'
          : 'Flag this if the cargo is sold while afloat — it changes the papers the line wants.'}
      </p>

      {isHighSeaSale && (
        <div className="mb-3 text-xs">
          {docsSentAt ? (
            <span className="text-emerald-700">
              Documents sent to the line {formatStamp(docsSentAt)}.
            </span>
          ) : outstandingHssDocs > 0 ? (
            <span className="text-amber-800">
              {outstandingHssDocs} HSS document(s) still outstanding.
            </span>
          ) : (
            <span className="text-amber-800">
              HSS documents are ready — send them to the line.
            </span>
          )}
        </div>
      )}

      <form action={formAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="isHighSeaSale" value={isHighSeaSale ? 'false' : 'true'} />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending
            ? 'Saving…'
            : isHighSeaSale
              ? 'Not a high sea sale after all'
              : 'Flag as a high sea sale'}
        </button>
      </form>

      <Note state={state} />
    </section>
  );
}
