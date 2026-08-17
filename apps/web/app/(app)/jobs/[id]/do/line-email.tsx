'use client';

import { useActionState, useEffect, useState } from 'react';
import { prepareLineEmail, sendLineEmail, type DoActionState } from './actions';
import { BUTTON, FIELD, LABEL, Note, PRIMARY } from '../ui';
import { formatStampTime } from '@/lib/dates';

const EMPTY: DoActionState = {};

/**
 * Drafts and sends a note to the shipping line.
 *
 * The draft is fetched on demand rather than computed on render, and it goes
 * out as a reply on the job's own email thread so the line's answer comes back
 * to this job by itself.
 */
export function LineEmail({
  jobId,
  purpose,
  defaultTo,
  attachmentCount,
  canSend,
  blockedReason,
  sentAt,
}: {
  jobId: string;
  purpose: 'proof' | 'hss';
  defaultTo: string;
  attachmentCount: number;
  canSend: boolean;
  blockedReason: string | null;
  sentAt: string | null;
}) {
  const [draftState, draftAction, drafting] = useActionState(prepareLineEmail, EMPTY);
  const [sendState, sendAction, sending] = useActionState(sendLineEmail, EMPTY);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (draftState.draft) setOpen(true);
  }, [draftState.draft]);

  const title = purpose === 'hss' ? 'Send the HSS documents' : 'Send the payment details';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        Goes out as a reply on this job&rsquo;s email thread, so the line&rsquo;s answer comes back
        here on its own. {attachmentCount} document(s) will be attached.
      </p>

      {sentAt && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Already sent {formatStampTime(sentAt)}. Sending again is fine.
        </p>
      )}

      {!open ? (
        <form action={draftAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="purpose" value={purpose} />
          <button type="submit" disabled={drafting} className={BUTTON}>
            {drafting ? 'Drafting…' : 'Draft the email'}
          </button>
          <Note state={draftState} />
        </form>
      ) : (
        <form action={sendAction} className="space-y-3">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="purpose" value={purpose} />
          <div>
            <label htmlFor={`${purpose}-to`} className={LABEL}>
              To
            </label>
            <input
              id={`${purpose}-to`}
              name="to"
              type="email"
              required
              defaultValue={defaultTo}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor={`${purpose}-subject`} className={LABEL}>
              Subject
            </label>
            <input
              id={`${purpose}-subject`}
              name="subject"
              required
              defaultValue={draftState.draft?.subject ?? ''}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor={`${purpose}-body`} className={LABEL}>
              Message
            </label>
            <textarea
              id={`${purpose}-body`}
              name="body"
              rows={10}
              required
              defaultValue={draftState.draft?.body ?? ''}
              className={FIELD}
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={sending || !canSend} className={PRIMARY}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              Cancel
            </button>
          </div>
          {!canSend && blockedReason && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {blockedReason}
            </p>
          )}
          <Note state={sendState} />
        </form>
      )}
    </section>
  );
}
