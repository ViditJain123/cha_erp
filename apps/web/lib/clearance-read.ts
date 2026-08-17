import 'server-only';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { clearanceAlerts, type ClearanceAlert, type ClearanceStatus } from '@/lib/clearance';

export interface JobClearanceSummary {
  jobId: string;
  status: ClearanceStatus;
  alerts: ClearanceAlert[];
}

/**
 * The clearance state of a set of jobs, in a fixed number of queries whatever
 * the job count.
 *
 * Shared by the job header, the job list and the dashboard, the same way
 * loadDoSummaries is — three near-identical queries would drift apart, and a
 * duty variance showing on one screen but not another is the sort of thing that
 * gets a Bill of Entry paid.
 *
 * Every query is scoped by company_id: serviceClient() bypasses RLS, so that
 * filter is the only thing keeping a guessed uuid inside its tenant.
 */
export async function loadClearanceSummaries(
  companyId: string,
  jobIds: string[],
): Promise<Map<string, JobClearanceSummary>> {
  const summaries = new Map<string, JobClearanceSummary>();
  if (jobIds.length === 0) return summaries;

  const db = serviceClient();
  const [{ data: rows }, { data: jobs }] = await Promise.all([
    db.from('job_clearance').select('*').eq('company_id', companyId).in('job_id', jobIds),
    db.from('jobs').select('id, checklist_duty').eq('company_id', companyId).in('id', jobIds),
  ]);

  if (!rows || rows.length === 0) return summaries;

  const ids = rows.map((r) => r.id);
  const [{ data: queries }, { data: nocs }, { data: plans }] = await Promise.all([
    db
      .from('job_clearance_queries')
      .select('job_clearance_id, raised_on')
      .eq('company_id', companyId)
      .eq('status', 'open')
      .in('job_clearance_id', ids),
    db
      .from('job_clearance_nocs')
      .select('job_clearance_id, authority')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .in('job_clearance_id', ids),
    db
      .from('job_delivery_plans')
      .select('job_clearance_id, planned_for')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .in('job_clearance_id', ids),
  ]);

  const checklistDutyByJob = new Map((jobs ?? []).map((j) => [j.id, j.checklist_duty]));

  for (const row of rows) {
    summaries.set(row.job_id, {
      jobId: row.job_id,
      status: row.status,
      alerts: clearanceAlerts({
        status: row.status,
        checklistDuty: checklistDutyByJob.get(row.job_id) ?? null,
        assessedDuty: row.assessed_duty,
        varianceRaisedAt: row.variance_raised_at,
        varianceResolvedAt: row.variance_resolved_at,
        dutyPaidOn: row.duty_paid_on,
        outOfChargeOn: row.out_of_charge_on,
        deliveredOn: row.delivered_on,
        openQueries: (queries ?? [])
          .filter((q) => q.job_clearance_id === row.id)
          .map((q) => ({ raisedOn: q.raised_on })),
        pendingNocs: (nocs ?? [])
          .filter((n) => n.job_clearance_id === row.id)
          .map((n) => ({ authority: n.authority })),
        pendingPlans: (plans ?? [])
          .filter((p) => p.job_clearance_id === row.id)
          .map((p) => ({ plannedFor: p.planned_for })),
      }),
    });
  }

  return summaries;
}

/**
 * Loads a job's clearance, creating it on first visit.
 *
 * Lazy rather than a backfill or a trigger, exactly as loadOrCreateDo is, so
 * every job that already exists picks one up the moment someone opens the tab.
 * There is nothing to seed it from — noting is where the desk's own record
 * starts — so this is the simpler half of that pattern.
 */
export async function loadOrCreateClearance(jobId: string) {
  const ctx = await requireCompany();
  const db = serviceClient();

  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) throw new Error('No such job.');

  const existing = await db
    .from('job_clearance')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .maybeSingle();
  if (existing.data) return { ctx, db, job, record: existing.data };

  const { data: created, error } = await db
    .from('job_clearance')
    .insert({ company_id: ctx.companyId, job_id: jobId })
    .select('*')
    .single();

  // A concurrent first visit loses the unique (job_id) race; read theirs.
  if (error || !created) {
    const { data: raced } = await db
      .from('job_clearance')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('job_id', jobId)
      .maybeSingle();
    if (raced) return { ctx, db, job, record: raced };
    throw new Error(error?.message ?? 'Could not open the clearance record.');
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'clearance.opened',
    payload: {},
  });

  return { ctx, db, job, record: created };
}
