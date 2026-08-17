'use client';

import { useActionState } from 'react';
import { markPaid, markScrutinised, notifyAccounts, saveInvoice, type DoActionState } from './actions';
import { BUTTON, Card, Note, SMALL_FIELD } from '../ui';

const EMPTY: DoActionState = {};

export interface InvoiceRow {
  kind: 'proforma' | 'final';
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number | null;
  scrutinisedAt: string | null;
  scrutinyNote: string | null;
  accountsNotifiedAt: string | null;
  paidOn: string | null;
  paymentAmount: number | null;
  paymentReference: string | null;
  proofSentAt: string | null;
}

const KIND_LABELS: Record<InvoiceRow['kind'], string> = {
  proforma: 'Proforma invoice',
  final: 'Final invoice',
};

const KIND_HINTS: Record<InvoiceRow['kind'], string> = {
  proforma: 'Scrutinised on or just before the ETA, then paid so the DO can be released.',
  final: 'Comes once detention and ground rent are known. Settle the balance and tell the line.',
};

function InvoiceBlock({
  jobId,
  kind,
  invoice,
  invoiceCallDue,
}: {
  jobId: string;
  kind: InvoiceRow['kind'];
  invoice: InvoiceRow | null;
  invoiceCallDue: string | null;
}) {
  const [saveState, saveAction, saving] = useActionState(saveInvoice, EMPTY);
  const [scrutinyState, scrutinyAction, scrutinising] = useActionState(markScrutinised, EMPTY);
  const [accountsState, accountsAction, notifying] = useActionState(notifyAccounts, EMPTY);
  const [paidState, paidAction, payingIn] = useActionState(markPaid, EMPTY);

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{KIND_LABELS[kind]}</h3>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {invoice?.scrutinisedAt && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
              scrutinised
            </span>
          )}
          {invoice?.accountsNotifiedAt && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">
              accounts told
            </span>
          )}
          {invoice?.paidOn && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">paid</span>
          )}
          {invoice?.proofSentAt && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">
              details sent
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">{KIND_HINTS[kind]}</p>

      {kind === 'proforma' && invoiceCallDue && !invoice?.scrutinisedAt && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {invoiceCallDue}
        </p>
      )}

      <form action={saveAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="kind" value={kind} />
        <label className="text-xs text-slate-600">
          Invoice no.
          <input
            name="invoiceNumber"
            defaultValue={invoice?.invoiceNumber ?? ''}
            className={`ml-1 ${SMALL_FIELD}`}
          />
        </label>
        <label className="text-xs text-slate-600">
          Dated
          <input
            name="invoiceDate"
            type="date"
            defaultValue={invoice?.invoiceDate ?? ''}
            className={`ml-1 ${SMALL_FIELD}`}
          />
        </label>
        <label className="text-xs text-slate-600">
          Amount
          <input
            name="amount"
            type="number"
            min={0}
            step="0.01"
            defaultValue={invoice?.amount ?? ''}
            className={`ml-1 w-28 ${SMALL_FIELD}`}
          />
        </label>
        <button type="submit" disabled={saving} className={BUTTON}>
          {saving ? 'Saving…' : 'Save invoice'}
        </button>
      </form>

      <form action={scrutinyAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="kind" value={kind} />
        <label className="min-w-56 flex-1 text-xs text-slate-600">
          Scrutiny note
          <input
            name="scrutinyNote"
            placeholder="Charges checked against the quote"
            defaultValue={invoice?.scrutinyNote ?? ''}
            className={`ml-1 w-full ${SMALL_FIELD}`}
          />
        </label>
        <button type="submit" disabled={scrutinising} className={BUTTON}>
          {scrutinising ? 'Saving…' : invoice?.scrutinisedAt ? 'Re-scrutinise' : 'Mark scrutinised'}
        </button>
      </form>

      <div className="flex flex-wrap items-end gap-2">
        <form action={accountsAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="kind" value={kind} />
          <button type="submit" disabled={notifying} className={BUTTON}>
            {notifying ? 'Saving…' : 'Record that accounts were told'}
          </button>
        </form>
        <span className="text-xs text-slate-400">
          There is no accounts module yet — this only stamps the job.
        </span>
      </div>

      <form action={paidAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="kind" value={kind} />
        <label className="text-xs text-slate-600">
          Paid on
          <input
            name="paidOn"
            type="date"
            required
            defaultValue={invoice?.paidOn ?? ''}
            className={`ml-1 ${SMALL_FIELD}`}
          />
        </label>
        <label className="text-xs text-slate-600">
          Amount
          <input
            name="paymentAmount"
            type="number"
            min={0}
            step="0.01"
            defaultValue={invoice?.paymentAmount ?? ''}
            className={`ml-1 w-28 ${SMALL_FIELD}`}
          />
        </label>
        <label className="text-xs text-slate-600">
          Reference
          <input
            name="paymentReference"
            defaultValue={invoice?.paymentReference ?? ''}
            className={`ml-1 ${SMALL_FIELD}`}
          />
        </label>
        <button type="submit" disabled={payingIn} className={BUTTON}>
          {payingIn ? 'Saving…' : 'Record payment'}
        </button>
      </form>

      <Note state={saveState} />
      <Note state={scrutinyState} />
      <Note state={accountsState} />
      <Note state={paidState} />
    </div>
  );
}

export function DoInvoices({
  jobId,
  invoices,
  invoiceCallDue,
}: {
  jobId: string;
  invoices: InvoiceRow[];
  invoiceCallDue: string | null;
}) {
  const proforma = invoices.find((i) => i.kind === 'proforma') ?? null;
  const final = invoices.find((i) => i.kind === 'final') ?? null;

  return (
    <Card
      title="The shipping line's invoices"
      step={5}
      done={proforma?.paidOn != null && final?.paidOn != null}
    >
      <div className="space-y-5">
        <InvoiceBlock
          jobId={jobId}
          kind="proforma"
          invoice={proforma}
          invoiceCallDue={invoiceCallDue}
        />
        <InvoiceBlock jobId={jobId} kind="final" invoice={final} invoiceCallDue={null} />
      </div>
    </Card>
  );
}
