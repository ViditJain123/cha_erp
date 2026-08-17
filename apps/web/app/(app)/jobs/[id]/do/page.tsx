import type { Metadata } from 'next';
import { missingScopes } from '@checklist/graph';
import { serviceClient } from '@/lib/supabase/admin';
import {
  ALERT_STYLES,
  DEPOSIT_REFUND_DAYS,
  DO_STATUS_LABELS,
  DO_STATUS_STYLES,
  addDays,
  daysUntil,
  doAlerts,
  formatDay,
  lastFreeDay,
} from '@/lib/do';
import { findSecurity, loadOrCreateDo } from '@/lib/do-read';
import { BlCheck } from './bl-check';
import { Containers, type ContainerRow } from './containers';
import { DeliveryMode, type SecurityReason } from './delivery-mode';
import { DoDocuments, type DoDocumentRow } from './do-documents';
import { DoInvoices, type InvoiceRow } from './do-invoices';
import { DoIssue } from './do-issue';
import { FreeTime } from './free-time';
import { HssPanel } from './hss-panel';
import { LineEmail } from './line-email';

export const metadata: Metadata = { title: 'Delivery order' };
export const dynamic = 'force-dynamic';

export default async function JobDoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Opens the DO on first visit, seeded from documents already ingested.
  const { ctx, job, record } = await loadOrCreateDo(id);
  const db = serviceClient();

  const [
    { data: containers },
    { data: documents },
    { data: invoices },
    { data: lines },
    { data: line },
    { data: connection },
  ] = await Promise.all([
    db
      .from('job_do_containers')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('job_do_id', record.id)
      .order('container_no'),
    db
      .from('job_do_documents')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('job_do_id', record.id)
      .order('created_at'),
    db
      .from('job_do_invoices')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('job_do_id', record.id),
    db
      .from('shipping_lines')
      .select('id, name')
      .eq('company_id', ctx.companyId)
      .eq('is_active', true)
      .order('name'),
    record.shipping_line_id
      ? db
          .from('shipping_lines')
          .select('*')
          .eq('id', record.shipping_line_id)
          .eq('company_id', ctx.companyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('mail_connections')
      .select('status, scopes')
      .eq('company_id', ctx.companyId)
      .eq('profile_id', ctx.userId)
      .maybeSingle(),
  ]);

  const security = await findSecurity(
    ctx.companyId,
    record.shipping_line_id,
    job.importer_name,
    record.delivery_mode,
  );

  const fallback = {
    freeDays: record.free_days,
    freeTimeFrom: record.free_time_from,
    eta: job.eta,
  };

  // The job-level last free day — what a container inherits when it carries no
  // terms of its own.
  const jobLastFreeDay = lastFreeDay({ freeDays: null, freeTimeFrom: null }, fallback);

  const containerRows: ContainerRow[] = (containers ?? []).map((c) => {
    const due = lastFreeDay({ freeDays: c.free_days, freeTimeFrom: c.free_time_from }, fallback);
    return {
      id: c.id,
      containerNo: c.container_no,
      sizeType: c.size_type,
      freeDays: c.free_days,
      freeTimeFrom: c.free_time_from,
      gatedOutOn: c.gated_out_on,
      returnedOn: c.returned_on,
      depositAmount: c.deposit_amount,
      depositStatus: c.deposit_status,
      depositPaidOn: c.deposit_paid_on,
      depositClaimedOn: c.deposit_claimed_on,
      depositRefundedOn: c.deposit_refunded_on,
      lastFreeDay: due,
      daysLeft: due ? daysUntil(due) : null,
    };
  });

  const documentRows: DoDocumentRow[] = (documents ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    requiredFor: d.required_for === 'hss' ? 'hss' : 'do',
    status: d.status,
    documentId: d.document_id,
    documentName: null,
  }));

  // Name the files that settled a row, so the list links to something readable.
  const settledIds = documentRows.map((d) => d.documentId).filter((v): v is string => Boolean(v));
  if (settledIds.length > 0) {
    const { data: files } = await db
      .from('job_documents')
      .select('id, file_name')
      .eq('company_id', ctx.companyId)
      .in('id', settledIds);
    const names = new Map((files ?? []).map((f) => [f.id, f.file_name]));
    for (const row of documentRows) {
      if (row.documentId) row.documentName = names.get(row.documentId) ?? null;
    }
  }

  const invoiceRows: InvoiceRow[] = (invoices ?? []).map((i) => ({
    kind: i.kind,
    invoiceNumber: i.invoice_number,
    invoiceDate: i.invoice_date,
    amount: i.amount,
    scrutinisedAt: i.scrutinised_at,
    scrutinyNote: i.scrutiny_note,
    accountsNotifiedAt: i.accounts_notified_at,
    paidOn: i.paid_on,
    paymentAmount: i.payment_amount,
    paymentReference: i.payment_reference,
    proofSentAt: i.proof_sent_at,
  }));

  const proforma = invoiceRows.find((i) => i.kind === 'proforma') ?? null;

  const alerts = doAlerts({
    eta: job.eta,
    status: record.status,
    freeDays: record.free_days,
    freeTimeFrom: record.free_time_from,
    deliveredAt: record.delivered_at,
    doValidUntil: record.do_valid_until,
    proformaScrutinised: proforma?.scrutinisedAt != null,
    containers: containerRows.map((c) => ({
      containerNo: c.containerNo,
      freeDays: c.freeDays,
      freeTimeFrom: c.freeTimeFrom,
      returnedOn: c.returnedOn,
      depositStatus: c.depositStatus,
    })),
  });

  const sendBlockedReason = !connection
    ? 'Connect your Outlook mailbox before sending.'
    : connection.status !== 'active'
      ? 'Your mailbox needs reconnecting.'
      : missingScopes(connection.scopes).includes('Mail.Send')
        ? 'Your mailbox was connected before sending was supported — reconnect to grant permission.'
        : null;

  const paidInvoices = invoiceRows.filter((i) => i.paidOn !== null);
  const hssRows = documentRows.filter((r) => r.requiredFor === 'hss');

  const invoiceCallDue =
    job.eta && proforma?.scrutinisedAt == null
      ? (() => {
          const left = daysUntil(addDays(job.eta, -1));
          return left < 0
            ? `The invoice call was due ${Math.abs(left)} day(s) ago — ETA was ${formatDay(job.eta)}.`
            : `The invoice call is due ${left === 0 ? 'today' : `in ${left} day(s)`} — the day before the ${formatDay(job.eta)} ETA.`;
        })()
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {alerts.length > 0 && (
          <section className="space-y-2">
            {alerts.map((alert, index) => (
              <div
                key={`${alert.kind}-${alert.containerNo ?? index}`}
                className={`rounded-lg border px-4 py-2 text-sm ${ALERT_STYLES[alert.level]}`}
              >
                {alert.label}
              </div>
            ))}
          </section>
        )}

        <BlCheck
          jobId={job.id}
          surrendered={record.bl_surrendered}
          surrenderMode={record.bl_surrender_mode}
          collected={record.bl_collected}
          checkedAt={record.bl_checked_at}
          seededFromDocument={record.bl_surrendered === true && record.bl_checked_at === null}
        />

        <FreeTime
          jobId={job.id}
          freeDays={record.free_days}
          freeTimeFrom={record.free_time_from}
          source={record.free_days_source}
          lastFreeDay={jobLastFreeDay}
          daysLeft={jobLastFreeDay ? daysUntil(jobLastFreeDay) : null}
          etaIsAnchor={record.free_time_from !== null && record.free_time_from === job.eta}
        />

        <DeliveryMode
          jobId={job.id}
          deliveryMode={record.delivery_mode}
          shippingLineId={record.shipping_line_id}
          lines={lines ?? []}
          securityReason={security.reason as SecurityReason}
          securityLabel={
            security.security
              ? `${security.security.kind === 'yearly_bond' ? 'Yearly bond' : 'Standing deposit'}${
                  security.security.reference ? ` ${security.security.reference}` : ''
                } — ${security.security.importer_name}`
              : null
          }
          depositExpected={record.deposit_expected}
          importerName={job.importer_name}
        />

        <Containers
          jobId={job.id}
          containers={containerRows}
          showDeposits={record.security_covers !== true}
        />

        <DoDocuments
          jobId={job.id}
          rows={documentRows}
          isHighSeaSale={record.is_high_sea_sale}
        />

        <DoInvoices jobId={job.id} invoices={invoiceRows} invoiceCallDue={invoiceCallDue} />

        <DoIssue
          jobId={job.id}
          doNumber={record.do_number}
          doChannel={record.do_channel}
          doReceivedAt={record.do_received_at}
          doValidUntil={record.do_valid_until}
          operationsNotifiedAt={record.operations_notified_at}
          deliveredAt={record.delivered_at}
          depositDueOn={
            record.delivered_at ? addDays(record.delivered_at, DEPOSIT_REFUND_DAYS) : null
          }
          issuesVia={line?.issues_do_via ?? null}
        />
      </div>

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Delivery order</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${DO_STATUS_STYLES[record.status]}`}
          >
            {DO_STATUS_LABELS[record.status]}
          </span>
          <dl className="mt-4 space-y-2 text-sm">
            <Detail label="Shipping line" value={line?.name ?? '—'} />
            <Detail label="Agent" value={line?.agent_name ?? '—'} />
            <Detail
              label="Issued via"
              value={line?.issues_do_via === 'odex' ? 'ODeX' : line ? 'Email' : '—'}
            />
            <Detail label="DO number" value={record.do_number ?? '—'} />
            <Detail label="Delivered" value={formatDay(record.delivered_at)} />
            <Detail
              label="Deposit due back"
              value={
                record.delivered_at
                  ? formatDay(addDays(record.delivered_at, DEPOSIT_REFUND_DAYS))
                  : '—'
              }
            />
          </dl>
        </section>

        <HssPanel
          jobId={job.id}
          isHighSeaSale={record.is_high_sea_sale}
          docsSentAt={record.hss_docs_sent_at}
          outstandingHssDocs={hssRows.filter((r) => r.status === 'pending').length}
        />

        {record.is_high_sea_sale && (
          <LineEmail
            jobId={job.id}
            purpose="hss"
            defaultTo={line?.do_email ?? ''}
            attachmentCount={hssRows.filter((r) => r.documentId).length}
            canSend={sendBlockedReason === null}
            blockedReason={sendBlockedReason}
            sentAt={record.hss_docs_sent_at}
          />
        )}

        {paidInvoices.length > 0 && (
          <LineEmail
            jobId={job.id}
            purpose="proof"
            defaultTo={line?.do_email ?? ''}
            attachmentCount={
              documentRows.filter((r) => r.requiredFor === 'do' && r.documentId).length
            }
            canSend={sendBlockedReason === null}
            blockedReason={sendBlockedReason}
            sentAt={paidInvoices.find((i) => i.proofSentAt)?.proofSentAt ?? null}
          />
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

