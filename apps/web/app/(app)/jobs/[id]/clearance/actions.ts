'use server';

import { revalidatePath } from 'next/cache';
import type { Json, Tables } from '@checklist/db';
import { deliveryPlanEmail, sendEmail } from '@checklist/mail';
import { serviceClient } from '@/lib/supabase/admin';
import { dutyVariance } from '@/lib/clearance';
import { loadOrCreateClearance } from '@/lib/clearance-read';

export interface ClearanceActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

type Db = ReturnType<typeof serviceClient>;
type Clearance = Tables<'job_clearance'>;

/** Loads a job's clearance, refusing anything outside the caller's company. */
const ownedClearance = loadOrCreateClearance;

async function logEvent(
  db: Db,
  companyId: string,
  jobId: string,
  userId: string,
  type: string,
  payload: Record<string, Json> = {},
) {
  await db.from('job_events').insert({
    company_id: companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: userId,
    type,
    payload,
  });
}

/**
 * Moves clearance forward, never backward.
 *
 * Same optimistic guard as jobs.stage and job_do.status: a status only advances
 * from one of the states it is allowed to advance from, so a stale tab cannot
 * drag a job back a step.
 */
async function advance(
  db: Db,
  record: Clearance,
  to: Clearance['status'],
  from: Clearance['status'][],
) {
  await db
    .from('job_clearance')
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq('id', record.id)
    .eq('company_id', record.company_id)
    .in('status', from);
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

function dateOrNull(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** `undefined` for blank, `null` for unparseable — so a typo never stores 0. */
function numberOrNull(formData: FormData, key: string): number | null | undefined {
  const value = text(formData, key);
  if (value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// --------------------------------------------------------- step 1: noting ----

export async function saveNoting(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const beNumber = text(formData, 'beNumber');
  const beDate = dateOrNull(formData, 'beDate');
  if (!beNumber) return { error: 'Enter the Bill of Entry number.' };
  if (!beDate) return { error: 'Enter the date it was noted.' };

  const { error } = await db
    .from('job_clearance')
    .update({
      be_number: beNumber,
      be_date: beDate,
      noted_at: new Date().toISOString(),
      noted_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.noted', { beNumber, beDate });
  await maybeLeaveNoting(db, record.id, ctx.companyId);

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Noted.' };
}

// ------------------------------------------------------------ step 2: RMS ----

export async function saveRmsRoute(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const route = text(formData, 'rmsRoute');
  if (route !== 'facilitated' && route !== 'assessment' && route !== 'examination') {
    return { error: 'Choose how RMS routed the Bill of Entry.' };
  }

  const { error } = await db
    .from('job_clearance')
    .update({ rms_route: route, updated_at: new Date().toISOString() })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.rms_routed', { route });
  await maybeLeaveNoting(db, record.id, ctx.companyId);

  revalidatePath(`/jobs/${jobId}/clearance`);
  return {
    ok: true,
    message:
      route === 'facilitated'
        ? 'Facilitated — no assessment, so this goes straight to duty.'
        : 'Route recorded.',
  };
}

/**
 * Noting is a token: once the BE has a number and RMS has routed it, there is
 * nothing else to do there.
 *
 * A facilitated BE skips assessment entirely, so it lands on duty rather than
 * passing — that is the whole point of the RMS route.
 */
async function maybeLeaveNoting(db: Db, clearanceId: string, companyId: string) {
  const { data: fresh } = await db
    .from('job_clearance')
    .select('*')
    .eq('id', clearanceId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!fresh || !fresh.be_number || !fresh.rms_route) return;

  await advance(db, fresh, fresh.rms_route === 'facilitated' ? 'duty_payment' : 'passing', [
    'noting',
  ]);
}

// -------------------------------------------------------- step 3: passing ----

export async function savePassing(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const entryInwards = dateOrNull(formData, 'entryInwardsDate');
  if (!entryInwards) return { error: 'Enter the entry inwards date.' };

  const appraiser = text(formData, 'appraiserPassed') === 'on';
  const ac = text(formData, 'acPassed') === 'on';
  if (ac && !appraiser) {
    return { error: 'The appraiser passes it before the AC does.' };
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from('job_clearance')
    .update({
      entry_inwards_date: entryInwards,
      appraiser_passed_at: appraiser ? (record.appraiser_passed_at ?? now) : null,
      ac_passed_at: ac ? (record.ac_passed_at ?? now) : null,
      updated_at: now,
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.passed', {
    entryInwards,
    appraiser,
    ac,
  });

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Passing saved.' };
}

/**
 * The control this whole track exists for.
 *
 * The duty customs assessed is compared against the figure printed on the
 * checklist the documents desk uploaded. A gap means customs re-classified or
 * re-valued the consignment, so the job goes back to scrutiny rather than being
 * quietly paid — and until someone resolves it, nothing here moves.
 */
export async function checkAssessedDuty(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, job, record } = await ownedClearance(jobId);

  const assessed = numberOrNull(formData, 'assessedDuty');
  if (assessed === null || assessed === undefined || assessed < 0) {
    return { error: 'Enter the duty customs assessed.' };
  }
  if (job.checklist_duty === null) {
    return {
      error:
        'No checklist duty is recorded for this job, so there is nothing to compare against. Upload the checklist with its duty first.',
    };
  }
  if (!record.entry_inwards_date) {
    return { error: 'Record the entry inwards date before checking the duty.' };
  }

  const variance = dutyVariance(job.checklist_duty, assessed);
  const now = new Date().toISOString();

  const { error } = await db
    .from('job_clearance')
    .update({
      assessed_duty: assessed,
      duty_checked_at: now,
      duty_checked_by: ctx.userId,
      // Re-checking after a revised checklist clears the old variance; a fresh
      // mismatch raises a new one.
      variance_raised_at: variance.matches ? null : now,
      variance_resolved_at: null,
      updated_at: now,
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.duty_checked', {
    checklistDuty: job.checklist_duty,
    assessedDuty: assessed,
    difference: variance.difference,
    matched: variance.matches,
  });

  if (variance.matches) {
    await advance(db, record, 'duty_payment', ['passing', 'duty_variance']);
    revalidatePath(`/jobs/${jobId}/clearance`);
    return { ok: true, message: 'Duty agrees with the checklist. On to payment.' };
  }

  await advance(db, record, 'duty_variance', ['passing', 'duty_payment']);
  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.duty_variance', {
    difference: variance.difference,
  });

  // Send it back to scrutiny. The only place in the app that moves a job's
  // stage backwards, and deliberately narrow: only from noting.
  await db
    .from('jobs')
    .update({ stage: 'scrutiny', updated_at: now })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .in('stage', ['noting']);

  revalidatePath(`/jobs/${jobId}/clearance`);
  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message: `Customs assessed ${variance.difference! > 0 ? 'more' : 'less'} than the checklist. The job is back with scrutiny — tell the shipper from the Scrutiny tab.`,
  };
}

export async function resolveVariance(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const note = text(formData, 'varianceNote');
  if (note.length < 3) return { error: 'Say what was wrong and what was done about it.' };
  if (!record.variance_raised_at) return { error: 'There is no open variance on this job.' };

  const now = new Date().toISOString();
  const { error } = await db
    .from('job_clearance')
    .update({ variance_resolved_at: now, variance_note: note, updated_at: now })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.variance_resolved', { note });
  await advance(db, record, 'duty_payment', ['duty_variance']);

  // Take the job back off scrutiny's desk.
  await db
    .from('jobs')
    .update({ stage: 'noting', updated_at: now })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .in('stage', ['scrutiny', 'awaiting_shipper', 'checklist_revision']);

  revalidatePath(`/jobs/${jobId}/clearance`);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Variance closed. Clearance has the job again.' };
}

// -------------------------------------------------------- customs queries ----

export async function addQuery(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const queryText = text(formData, 'queryText');
  const raisedOn = dateOrNull(formData, 'raisedOn');
  const source = text(formData, 'source') || 'appraiser';
  if (queryText.length < 3) return { error: 'Enter what customs asked.' };
  if (!raisedOn) return { error: 'Enter the date it was raised.' };
  if (!['appraiser', 'ac', 'shed', 'pga'].includes(source)) return { error: 'Unknown source.' };

  const { error } = await db.from('job_clearance_queries').insert({
    company_id: ctx.companyId,
    job_clearance_id: record.id,
    job_id: jobId,
    raised_on: raisedOn,
    source,
    query_text: queryText,
  });
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.query_raised', { source });

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Query recorded.' };
}

export async function replyToQuery(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const queryId = text(formData, 'queryId');
  const status = text(formData, 'status');
  if (!['open', 'replied', 'closed'].includes(status)) return { error: 'Unknown status.' };

  const replyNote = text(formData, 'replyNote');
  const settled = status !== 'open';
  if (status === 'replied' && replyNote.length < 3) {
    return { error: 'Say what was sent back.' };
  }

  const { error } = await db
    .from('job_clearance_queries')
    .update({
      status: status as Tables<'job_clearance_queries'>['status'],
      reply_note: replyNote || null,
      replied_on: settled ? (dateOrNull(formData, 'repliedOn') ?? new Date().toISOString().slice(0, 10)) : null,
      resolved_by: settled ? ctx.userId : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', queryId)
    .eq('job_clearance_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.query_answered', { status });

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Query updated.' };
}

// ---------------------------------------------------------- duty payment ----

export async function recordDutyPayment(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const paidOn = dateOrNull(formData, 'dutyPaidOn');
  const amount = numberOrNull(formData, 'dutyAmount');
  const challan = text(formData, 'dutyChallanNo');

  if (!paidOn) return { error: 'Enter the date the duty was paid.' };
  if (amount === null || (amount !== undefined && amount < 0)) {
    return { error: 'Enter a valid amount, or leave it blank.' };
  }
  if (record.variance_raised_at && !record.variance_resolved_at) {
    return { error: 'There is an open duty variance. Resolve it before paying.' };
  }

  const { error } = await db
    .from('job_clearance')
    .update({
      duty_paid_on: paidOn,
      duty_amount: amount ?? null,
      duty_challan_no: challan || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.duty_paid', { paidOn, challan });
  await advance(db, record, 'goods_registration', ['passing', 'duty_payment']);

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Duty payment recorded. The goods can be registered.' };
}

// ------------------------------------------------------------ the shed ----

export async function recordShed(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const registered = dateOrNull(formData, 'goodsRegisteredOn');
  const examined = dateOrNull(formData, 'examinedOn');

  if (!registered && examined) {
    return { error: 'Goods are registered before they are examined.' };
  }
  if (registered && examined && examined < registered) {
    return { error: 'Examination cannot precede registration.' };
  }

  const { error } = await db
    .from('job_clearance')
    .update({
      goods_registered_on: registered,
      examined_on: examined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.shed', { registered, examined });

  if (examined) {
    await advance(db, record, 'out_of_charge', ['goods_registration', 'examination']);
  } else if (registered) {
    await advance(db, record, 'examination', ['goods_registration']);
  }

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Saved.' };
}

// ----------------------------------------------------------------- NOCs ----

export async function saveNoc(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const authority = text(formData, 'authority');
  const status = text(formData, 'status') || 'pending';
  if (authority.length < 2) return { error: 'Name the authority.' };
  if (!['not_required', 'pending', 'received'].includes(status)) return { error: 'Unknown status.' };

  const { error } = await db.from('job_clearance_nocs').upsert(
    {
      company_id: ctx.companyId,
      job_clearance_id: record.id,
      job_id: jobId,
      authority,
      status: status as Tables<'job_clearance_nocs'>['status'],
      reference: text(formData, 'reference') || null,
      applied_on: dateOrNull(formData, 'appliedOn'),
      received_on: dateOrNull(formData, 'receivedOn'),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_clearance_id,authority' },
  );
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.noc_updated', {
    authority,
    status,
  });

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: `${authority} saved.` };
}

export async function removeNoc(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const { error } = await db
    .from('job_clearance_nocs')
    .delete()
    .eq('id', text(formData, 'nocId'))
    .eq('job_clearance_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Removed.' };
}

// -------------------------------------------------------- out of charge ----

export async function recordOutOfCharge(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const oocOn = dateOrNull(formData, 'outOfChargeOn');
  if (!oocOn) return { error: 'Enter the date out of charge was granted.' };
  if (!record.duty_paid_on) {
    return { error: 'No duty payment is recorded. Customs does not release without one.' };
  }

  const { data: pendingNocs } = await db
    .from('job_clearance_nocs')
    .select('authority')
    .eq('job_clearance_id', record.id)
    .eq('company_id', ctx.companyId)
    .eq('status', 'pending');
  if ((pendingNocs ?? []).length > 0) {
    return {
      error: `Still waiting on ${(pendingNocs ?? []).map((n) => n.authority).join(', ')}.`,
    };
  }

  const { error } = await db
    .from('job_clearance')
    .update({
      out_of_charge_on: oocOn,
      ooc_reference: text(formData, 'oocReference') || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.out_of_charge', { oocOn });
  await advance(db, record, 'delivery_planning', [
    'goods_registration',
    'examination',
    'out_of_charge',
  ]);

  revalidatePath(`/jobs/${jobId}/clearance`);
  return { ok: true, message: 'Out of charge recorded. Delivery can be planned.' };
}

// ----------------------------------------------------- delivery planning ----

/**
 * Proposes a delivery day to the CFS.
 *
 * The in-app queue is the channel of record — a CFS person's plain-text email
 * reply is never ingested, because the poller only processes messages carrying
 * attachments. The email below is a nudge towards the queue, nothing more.
 */
export async function planDelivery(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, job, record } = await ownedClearance(jobId);

  const plannedFor = dateOrNull(formData, 'plannedFor');
  const cfsId = text(formData, 'cfsId');
  if (!plannedFor) return { error: 'Choose the delivery day.' };
  if (!cfsId) return { error: 'Choose the CFS.' };
  if (!record.out_of_charge_on) {
    return { error: 'Nothing can be delivered before out of charge.' };
  }

  const { data: cfs } = await db
    .from('cfs_master')
    .select('id, name, contact_email')
    .eq('id', cfsId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!cfs) return { error: 'No such CFS.' };

  const { error } = await db.from('job_delivery_plans').insert({
    company_id: ctx.companyId,
    job_clearance_id: record.id,
    job_id: jobId,
    planned_for: plannedFor,
    cfs_id: cfsId,
    requested_by: ctx.userId,
  });
  if (error) {
    return {
      error: error.code === '23505' ? 'That day has already been put to the CFS.' : error.message,
    };
  }

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.delivery_planned', {
    plannedFor,
    cfs: cfs.name,
  });
  await notifyCfs(
    db,
    ctx.companyId,
    cfs,
    job.job_number ?? job.title ?? 'a job',
    plannedFor,
    job.importer_name,
  );

  revalidatePath(`/jobs/${jobId}/clearance`);
  revalidatePath('/delivery-planning');
  return { ok: true, message: `Put to ${cfs.name} for ${plannedFor}.` };
}

/** Everyone on a CFS, falling back to the station's own address. */
async function notifyCfs(
  db: Db,
  companyId: string,
  cfs: { id: string; name: string; contact_email: string | null },
  jobLabel: string,
  plannedFor: string,
  importerName: string | null,
) {
  const { data: staff } = await db
    .from('profiles')
    .select('email')
    .eq('company_id', companyId)
    .eq('cfs_id', cfs.id)
    .eq('status', 'active');

  const recipients = (staff ?? []).map((s) => s.email);
  if (recipients.length === 0 && cfs.contact_email) recipients.push(cfs.contact_email);

  // Resend, not Graph: a CFS user has no connected Outlook mailbox — only the
  // scrutiny team can connect one.
  for (const to of recipients) {
    // A nudge failing must not lose the plan; the queue is the record.
    await sendEmail(
      deliveryPlanEmail({
        to,
        jobLabel,
        importerName,
        cfsName: cfs.name,
        plannedFor,
        queueUrl: `${appUrl()}/delivery-planning`,
      }),
    ).catch(() => undefined);
  }
}

/** Absolute links for email. Falls back to the dev port the app runs on. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3040';
}

export async function recordDelivered(
  _prev: ClearanceActionState,
  formData: FormData,
): Promise<ClearanceActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedClearance(jobId);

  const deliveredOn = dateOrNull(formData, 'deliveredOn');
  if (!deliveredOn) return { error: 'Enter the date the goods were delivered.' };

  const { data: approved } = await db
    .from('job_delivery_plans')
    .select('id')
    .eq('job_clearance_id', record.id)
    .eq('company_id', ctx.companyId)
    .eq('status', 'received')
    .limit(1);
  if ((approved ?? []).length === 0) {
    return { error: 'No delivery day has been approved by the CFS yet.' };
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from('job_clearance')
    .update({ delivered_on: deliveredOn, updated_at: now })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'clearance.delivered', { deliveredOn });
  await advance(db, record, 'delivered', ['delivery_planning']);

  // The job is done. 'closed' has been a dead enum value until now.
  await db
    .from('jobs')
    .update({ stage: 'closed', updated_at: now })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .in('stage', ['noting']);

  revalidatePath(`/jobs/${jobId}/clearance`);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Delivered. The job is closed.' };
}
