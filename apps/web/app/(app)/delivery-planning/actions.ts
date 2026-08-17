'use server';

import { revalidatePath } from 'next/cache';
import { deliveryRefusedEmail, sendEmail } from '@checklist/mail';
import { requireCompany, requireTeam } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export interface PlanActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3040';
}

/**
 * Which station this user works.
 *
 * Read from the profile rather than the token: the access-token hook stamps
 * company, role and team, and adding a fourth claim would mean every existing
 * CFS user had to sign out and in again before their queue appeared. One
 * indexed read by primary key is the cheaper trade.
 */
async function currentCfsId(userId: string, companyId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('profiles')
    .select('cfs_id')
    .eq('id', userId)
    .eq('company_id', companyId)
    .maybeSingle();
  return data?.cfs_id ?? null;
}

/**
 * The delivery days waiting on this user's CFS.
 *
 * A CFS member with no station sees nothing rather than everything — an empty
 * list is a much safer failure than another station's work. Managers see every
 * station, because somebody has to be able to unstick a queue.
 */
export async function listPendingPlans() {
  const ctx = await requireTeam('cfs', 'customs', 'customer_support');
  const db = serviceClient();

  const cfsId = ctx.team === 'cfs' ? await currentCfsId(ctx.userId, ctx.companyId) : null;
  if (ctx.team === 'cfs' && !cfsId) return { ctx, plans: [], decided: [], noStation: true };

  let query = db
    .from('job_delivery_plans')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('status', 'pending')
    .order('planned_for');
  if (cfsId) query = query.eq('cfs_id', cfsId);

  // Answered plans from the last day too. Deciding one removes it from the
  // queue, so without this the row simply vanishes and nothing confirms the
  // click landed — and there is nowhere else for a CFS user to check.
  let decidedQuery = db
    .from('job_delivery_plans')
    .select('*')
    .eq('company_id', ctx.companyId)
    .neq('status', 'pending')
    .gte('decided_at', new Date(Date.now() - 86_400_000).toISOString())
    .order('decided_at', { ascending: false });
  if (cfsId) decidedQuery = decidedQuery.eq('cfs_id', cfsId);

  const [{ data: plans }, { data: decided }] = await Promise.all([query, decidedQuery]);
  const all = [...(plans ?? []), ...(decided ?? [])];
  if (all.length === 0) return { ctx, plans: [], decided: [], noStation: false };

  const [{ data: jobs }, { data: stations }] = await Promise.all([
    db
      .from('jobs')
      .select('id, job_number, title, importer_name')
      .eq('company_id', ctx.companyId)
      .in('id', [...new Set(all.map((p) => p.job_id))]),
    db.from('cfs_master').select('id, name').eq('company_id', ctx.companyId),
  ]);

  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));
  const cfsById = new Map((stations ?? []).map((c) => [c.id, c.name]));

  const shape = (p: (typeof all)[number]) => ({
    id: p.id,
    jobId: p.job_id,
    plannedFor: p.planned_for,
    cfsName: p.cfs_id ? (cfsById.get(p.cfs_id) ?? '—') : '—',
    jobLabel: jobById.get(p.job_id)?.job_number ?? jobById.get(p.job_id)?.title ?? 'Untitled job',
    importerName: jobById.get(p.job_id)?.importer_name ?? null,
    status: p.status,
    decisionNote: p.decision_note,
    supportNotified: p.support_notified_at !== null,
  });

  return {
    ctx,
    noStation: false,
    plans: (plans ?? []).map(shape),
    decided: (decided ?? []).map(shape),
  };
}

/**
 * The CFS's answer on a proposed day.
 *
 * This is the channel of record, not the email that announced it: a plain-text
 * reply is never ingested, because the mailbox poller only processes messages
 * carrying attachments.
 */
export async function decideDeliveryPlan(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const ctx = await requireCompany();
  const db = serviceClient();

  const planId = String(formData.get('planId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('decisionNote') ?? '').trim();

  if (decision !== 'approve' && decision !== 'refuse') return { error: 'Unknown decision.' };
  if (decision === 'refuse' && note.length < 3) {
    return { error: 'Say why it is not going ahead — support has to tell the customer something.' };
  }

  const { data: plan } = await db
    .from('job_delivery_plans')
    .select('*')
    .eq('id', planId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!plan) return { error: 'No such delivery plan.' };

  // A CFS member answers only for their own station. Managers may answer for any.
  if (ctx.team === 'cfs') {
    const cfsId = await currentCfsId(ctx.userId, ctx.companyId);
    if (!cfsId || plan.cfs_id !== cfsId) {
      return { error: 'That delivery is at another station.' };
    }
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from('job_delivery_plans')
    .update({
      status: decision === 'approve' ? 'received' : 'waived',
      decided_at: now,
      decided_by: ctx.userId,
      decision_note: note || null,
      updated_at: now,
    })
    .eq('id', plan.id)
    .eq('company_id', ctx.companyId)
    // Only an undecided day can be decided; a second click cannot flip it.
    .eq('status', 'pending');
  if (error) return { error: error.message };

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: plan.job_id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: decision === 'approve' ? 'clearance.delivery_approved' : 'clearance.delivery_refused',
    payload: { plannedFor: plan.planned_for, note: note || null },
  });

  const told = decision === 'refuse' ? await notifySupport(db, ctx.companyId, plan.id) : false;

  revalidatePath('/delivery-planning');
  revalidatePath(`/jobs/${plan.job_id}/clearance`);

  if (decision === 'approve') {
    return { ok: true, message: `Delivery confirmed for ${plan.planned_for}.` };
  }
  // Never claim a notification that did not go out — nobody may be on the
  // support desk, or Resend may have refused it. The refusal itself is
  // recorded either way; only the telling is in doubt.
  return {
    ok: true,
    message: told
      ? 'Recorded. Customer support has been told.'
      : 'Recorded — but nobody on customer support could be reached. Tell them by hand.',
  };
}

/**
 * Tells customer support a delivery is off, and stamps that it happened.
 *
 * Stamped after the send rather than before, so a failed send leaves the row
 * saying support was not told — which is true, and which the dashboard can then
 * surface.
 */
async function notifySupport(
  db: ReturnType<typeof serviceClient>,
  companyId: string,
  planId: string,
): Promise<boolean> {
  const { data: plan } = await db
    .from('job_delivery_plans')
    .select('*')
    .eq('id', planId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!plan) return false;

  const [{ data: support }, { data: job }, { data: cfs }] = await Promise.all([
    db
      .from('profiles')
      .select('email')
      .eq('company_id', companyId)
      .eq('team', 'customer_support')
      .eq('status', 'active'),
    db.from('jobs').select('job_number, title, importer_name').eq('id', plan.job_id).maybeSingle(),
    plan.cfs_id
      ? db.from('cfs_master').select('name').eq('id', plan.cfs_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if ((support ?? []).length === 0) return false;

  const jobLabel = job?.job_number ?? job?.title ?? 'a job';
  let sent = false;
  for (const person of support ?? []) {
    const result = await sendEmail(
      deliveryRefusedEmail({
        to: person.email,
        jobLabel,
        importerName: job?.importer_name ?? null,
        cfsName: cfs?.name ?? 'The CFS',
        plannedFor: plan.planned_for,
        reason: plan.decision_note,
        jobUrl: `${appUrl()}/jobs/${plan.job_id}/clearance`,
      }),
    ).catch(() => null);
    if (result) sent = true;
  }

  if (sent) {
    await db
      .from('job_delivery_plans')
      .update({ support_notified_at: new Date().toISOString() })
      .eq('id', plan.id)
      .eq('company_id', companyId);
  }
  return sent;
}
