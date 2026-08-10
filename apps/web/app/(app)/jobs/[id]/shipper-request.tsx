'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { sendShipperRequest, type JobActionState } from './actions';

const EMPTY: JobActionState = {};

export interface ShipperOption {
  id: string;
  name: string;
  email: string;
}

export function ShipperRequest({
  jobId,
  shippers,
  suggestedId,
  defaultEmail,
  draftSubject,
  draftBody,
  outstanding,
  canSend,
  blockedReason,
  alreadySent,
}: {
  jobId: string;
  shippers: ShipperOption[];
  suggestedId: string | null;
  defaultEmail: string;
  draftSubject: string;
  draftBody: string;
  outstanding: number;
  canSend: boolean;
  blockedReason: string | null;
  alreadySent: boolean;
}) {
  const [state, formAction, pending] = useActionState(sendShipperRequest, EMPTY);
  const [email, setEmail] = useState(defaultEmail);
  const [open, setOpen] = useState(!alreadySent);

  if (draftSubject === '' && draftBody === '') return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {alreadySent ? 'Request sent' : 'Request from the shipper'}
        </h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Send again
          </button>
        )}
      </div>

      {!open ? (
        <p className="mt-1 text-xs text-slate-500">
          Sent to {defaultEmail}. Their reply will attach to this job automatically.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            {outstanding > 0
              ? `Written from the ${outstanding} outstanding document(s). Edit anything before sending.`
              : 'Nothing is outstanding — edit before sending if you still want to write.'}
          </p>

          {blockedReason && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {blockedReason}{' '}
              <Link href="/settings/mailbox" className="font-medium underline">
                Mailbox settings
              </Link>
            </div>
          )}

          <form action={formAction} className="mt-4 space-y-3">
            <input type="hidden" name="jobId" value={jobId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="shipperId" className="mb-1 block text-xs font-medium text-slate-600">
                  Shipper
                </label>
                <select
                  id="shipperId"
                  name="shipperId"
                  defaultValue={suggestedId ?? ''}
                  onChange={(e) => {
                    const picked = shippers.find((s) => s.id === e.target.value);
                    if (picked) setEmail(picked.email);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Not in the list</option>
                  {shippers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-600">
                  To
                </label>
                <input
                  id="to"
                  name="to"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="subject" className="mb-1 block text-xs font-medium text-slate-600">
                Subject
              </label>
              <input
                id="subject"
                name="subject"
                required
                defaultValue={draftSubject}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-slate-400">
                Sent as a reply on the original thread, so Outlook keeps its own “RE:” subject. This
                is used only if there is no thread to reply to.
              </p>
            </div>

            <div>
              <label htmlFor="body" className="mb-1 block text-xs font-medium text-slate-600">
                Message
              </label>
              <textarea
                id="body"
                name="body"
                rows={12}
                required
                defaultValue={draftBody}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {state.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {state.error}
              </div>
            )}
            {state.message && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {state.message}
              </div>
            )}

            <button
              type="submit"
              disabled={pending || !canSend}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pending ? 'Sending…' : 'Approve and send to shipper'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
