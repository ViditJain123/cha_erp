import type { Metadata } from 'next';
import { serviceClient } from '@/lib/supabase/admin';
import { ALERT_STYLES, formatDay } from '@/lib/do';
import {
  CLEARANCE_STATUS_LABELS,
  CLEARANCE_STATUS_STYLES,
  RMS_ROUTE_LABELS,
  clearanceAlerts,
  dutyVariance,
  rupees,
} from '@/lib/clearance';
import { loadOrCreateClearance } from '@/lib/clearance-read';
import { DeliveryPlans, type DeliveryPlanRow } from './delivery-plans';
import { Nocs, type NocRow } from './nocs';
import {
  DutyPaymentCard,
  NotingCard,
  OutOfChargeCard,
  PassingCard,
  Queries,
  ShedCard,
  type QueryRow,
} from './steps';

export const metadata: Metadata = { title: 'Clearance' };
export const dynamic = 'force-dynamic';

export default async function JobClearancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Opens the clearance record on first visit.
  const { ctx, job, record } = await loadOrCreateClearance(id);
  const db = serviceClient();

  const [{ data: queries }, { data: nocs }, { data: plans }, { data: stations }] =
    await Promise.all([
      db
        .from('job_clearance_queries')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('job_clearance_id', record.id)
        .order('raised_on', { ascending: false }),
      db
        .from('job_clearance_nocs')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('job_clearance_id', record.id)
        .order('authority'),
      db
        .from('job_delivery_plans')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('job_clearance_id', record.id)
        .order('planned_for', { ascending: false }),
      db
        .from('cfs_master')
        .select('id, name')
        .eq('company_id', ctx.companyId)
        .eq('is_active', true)
        .order('name'),
    ]);

  const queryRows: QueryRow[] = (queries ?? []).map((q) => ({
    id: q.id,
    raisedOn: q.raised_on,
    source: q.source,
    queryText: q.query_text,
    status: q.status,
    repliedOn: q.replied_on,
    replyNote: q.reply_note,
  }));

  const nocRows: NocRow[] = (nocs ?? []).map((n) => ({
    id: n.id,
    authority: n.authority,
    reference: n.reference,
    status: n.status,
    appliedOn: n.applied_on,
    receivedOn: n.received_on,
  }));

  const cfsName = new Map((stations ?? []).map((c) => [c.id, c.name]));
  const planRows: DeliveryPlanRow[] = (plans ?? []).map((p) => ({
    id: p.id,
    plannedFor: p.planned_for,
    cfsName: p.cfs_id ? (cfsName.get(p.cfs_id) ?? '—') : '—',
    status: p.status,
    decisionNote: p.decision_note,
    decidedAt: p.decided_at,
    supportNotifiedAt: p.support_notified_at,
  }));

  const pendingNocs = nocRows.filter((n) => n.status === 'pending').map((n) => n.authority);
  const variance = dutyVariance(job.checklist_duty, record.assessed_duty);

  const alerts = clearanceAlerts({
    status: record.status,
    checklistDuty: job.checklist_duty,
    assessedDuty: record.assessed_duty,
    varianceRaisedAt: record.variance_raised_at,
    varianceResolvedAt: record.variance_resolved_at,
    dutyPaidOn: record.duty_paid_on,
    outOfChargeOn: record.out_of_charge_on,
    deliveredOn: record.delivered_on,
    openQueries: queryRows.filter((q) => q.status === 'open').map((q) => ({ raisedOn: q.raisedOn })),
    pendingNocs: pendingNocs.map((authority) => ({ authority })),
    pendingPlans: planRows
      .filter((p) => p.status === 'pending')
      .map((p) => ({ plannedFor: p.plannedFor })),
  });

  const varianceOpen = record.variance_raised_at !== null && record.variance_resolved_at === null;
  // A facilitated Bill of Entry was never assessed, so there is no passing work
  // and nothing to compare — the duty check would have nothing to check.
  const facilitated = record.rms_route === 'facilitated';

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {alerts.length > 0 && (
          <section className="space-y-2">
            {alerts.map((alert, index) => (
              <div
                key={`${alert.kind}-${index}`}
                className={`rounded-lg border px-4 py-2 text-sm ${ALERT_STYLES[alert.level]}`}
              >
                {alert.label}
              </div>
            ))}
          </section>
        )}

        <NotingCard
          jobId={job.id}
          beNumber={record.be_number}
          beDate={record.be_date}
          notedAt={record.noted_at}
          rmsRoute={record.rms_route}
        />

        {facilitated ? (
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm">
            <h2 className="text-sm font-semibold">Passing</h2>
            <p className="mt-1 text-xs text-slate-500">
              RMS facilitated this Bill of Entry, so customs never assessed it. There is no duty to
              compare — the checklist figure of {rupees(job.checklist_duty)} stands.
            </p>
          </section>
        ) : (
          <PassingCard
            jobId={job.id}
            entryInwardsDate={record.entry_inwards_date}
            appraiserPassedAt={record.appraiser_passed_at}
            acPassedAt={record.ac_passed_at}
            checklistDuty={job.checklist_duty}
            assessedDuty={record.assessed_duty}
            dutyCheckedAt={record.duty_checked_at}
            variance={variance}
            varianceRaisedAt={record.variance_raised_at}
            varianceResolvedAt={record.variance_resolved_at}
            varianceNote={record.variance_note}
          />
        )}

        <Queries jobId={job.id} queries={queryRows} />

        <DutyPaymentCard
          jobId={job.id}
          dutyPaidOn={record.duty_paid_on}
          dutyAmount={record.duty_amount}
          dutyChallanNo={record.duty_challan_no}
          assessedDuty={record.assessed_duty ?? job.checklist_duty}
          blocked={varianceOpen}
        />

        <ShedCard
          jobId={job.id}
          goodsRegisteredOn={record.goods_registered_on}
          examinedOn={record.examined_on}
          dutyPaidOn={record.duty_paid_on}
        />

        <Nocs jobId={job.id} nocs={nocRows} />

        <OutOfChargeCard
          jobId={job.id}
          outOfChargeOn={record.out_of_charge_on}
          oocReference={record.ooc_reference}
          pendingNocs={pendingNocs}
          dutyPaidOn={record.duty_paid_on}
        />

        <DeliveryPlans
          jobId={job.id}
          plans={planRows}
          cfsOptions={stations ?? []}
          outOfChargeOn={record.out_of_charge_on}
          deliveredOn={record.delivered_on}
          // The station a refused day was proposed at, so re-planning does not
          // retype it; otherwise the only station, when there is only one.
          defaultCfsId={
            (plans ?? [])[0]?.cfs_id ??
            ((stations ?? []).length === 1 ? ((stations ?? [])[0]?.id ?? null) : null)
          }
        />
      </div>

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Clearance</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLEARANCE_STATUS_STYLES[record.status]}`}
          >
            {CLEARANCE_STATUS_LABELS[record.status]}
          </span>
          <dl className="mt-4 space-y-2 text-sm">
            <Detail label="BE number" value={record.be_number ?? '—'} />
            <Detail label="Noted" value={formatDay(record.be_date)} />
            <Detail
              label="RMS"
              value={record.rms_route ? RMS_ROUTE_LABELS[record.rms_route] : '—'}
            />
            <Detail label="Entry inwards" value={formatDay(record.entry_inwards_date)} />
            <Detail label="Checklist duty" value={rupees(job.checklist_duty)} />
            <Detail label="Assessed duty" value={rupees(record.assessed_duty)} />
            <Detail label="Duty paid" value={formatDay(record.duty_paid_on)} />
            <Detail label="Out of charge" value={formatDay(record.out_of_charge_on)} />
            <Detail label="Delivered" value={formatDay(record.delivered_on)} />
          </dl>
        </section>

        {varianceOpen && (
          <section className="rounded-xl border border-red-300 bg-red-50 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-red-900">Back with scrutiny</h2>
            <p className="mt-1 text-xs text-red-800">
              Customs assessed {rupees(record.assessed_duty)} against the checklist&rsquo;s{' '}
              {rupees(job.checklist_duty)}. Tell the shipper from the Scrutiny tab and get the
              checklist revised before anything is paid.
            </p>
          </section>
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
