'use server';

import { revalidatePath } from 'next/cache';
import type { Json, Tables } from '@checklist/db';
import {
  ReauthRequiredError,
  ensureAccessToken,
  isConsoleTransport,
  missingScopes,
  sendMailAsUser,
} from '@checklist/graph';
import { serviceClient } from '@/lib/supabase/admin';
import { DEPOSIT_REFUND_DAYS } from '@/lib/do';
import { findSecurity, loadOrCreateDo, rateFor } from '@/lib/do-read';

export interface DoActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Populated by prepareLineEmail, which drafts on demand rather than on render. */
  draft?: { subject: string; body: string };
}

type Db = ReturnType<typeof serviceClient>;
type JobDo = Tables<'job_do'>;

/** Loads a job's DO, refusing anything outside the caller's company. */
const ownedDo = loadOrCreateDo;

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
 * Moves the DO forward, never backward.
 *
 * Guarded the way the scrutiny stage transitions are: a status only advances
 * from one of the states it is allowed to advance from, so a second tab that
 * loaded stale data cannot drag a DO back a step.
 */
async function advance(db: Db, record: JobDo, to: JobDo['status'], from: JobDo['status'][]) {
  await db
    .from('job_do')
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

// ------------------------------------------------------------ step 1: B/L ----

export async function saveBlCheck(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const surrenderedRaw = text(formData, 'blSurrendered');
  const surrendered =
    surrenderedRaw === 'yes' ? true : surrenderedRaw === 'no' ? false : null;
  const mode = text(formData, 'blSurrenderMode');
  const collected = text(formData, 'blCollected') === 'on';

  if (surrendered === null) return { error: 'Say whether the B/L has been surrendered.' };
  if (surrendered && mode !== 'telex' && mode !== 'express') {
    return { error: 'Choose how it was surrendered.' };
  }
  if (!surrendered && !collected) {
    // Not an error — an original B/L that has not been collected yet is the
    // normal state early on. It is just worth saying out loud.
  }

  const { error } = await db
    .from('job_do')
    .update({
      bl_surrendered: surrendered,
      bl_surrender_mode: surrendered ? mode : 'original',
      bl_collected: collected,
      bl_checked_at: new Date().toISOString(),
      bl_checked_by: ctx.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.bl_checked', {
    surrendered,
    mode: surrendered ? mode : 'original',
    collected,
  });
  await maybeAdvanceToDocuments(db, record.id, ctx.companyId);

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'B/L status saved.' };
}

/**
 * The DO leaves 'open' once the three things the shipping line will ask about
 * are all known: the B/L's state, how the cargo moves, and how long the free
 * time runs.
 */
async function maybeAdvanceToDocuments(db: Db, doId: string, companyId: string) {
  const { data: fresh } = await db
    .from('job_do')
    .select('*')
    .eq('id', doId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!fresh) return;
  if (fresh.bl_surrendered === null || fresh.delivery_mode === null || fresh.free_days === null) {
    return;
  }
  await advance(db, fresh, 'documents', ['open']);
}

// ------------------------------------------------------ step 2: free time ----

export async function saveFreeTime(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const freeDays = numberOrNull(formData, 'freeDays');
  const from = dateOrNull(formData, 'freeTimeFrom');

  if (freeDays === null || freeDays === undefined) {
    return { error: 'Enter the number of free days.' };
  }
  if (!Number.isInteger(freeDays) || freeDays < 0) {
    return { error: 'Free days must be a whole number of days.' };
  }
  if (!from) return { error: 'Enter the date the free period runs from.' };

  const { error } = await db
    .from('job_do')
    .update({
      free_days: freeDays,
      free_time_from: from,
      free_days_source: 'manual',
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.free_time_set', { freeDays, from });
  await maybeAdvanceToDocuments(db, record.id, ctx.companyId);

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Free period saved.' };
}

// --------------------------------------------- step 3: mode and security ----

export async function saveDeliveryMode(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, job, record } = await ownedDo(jobId);

  const mode = text(formData, 'deliveryMode');
  const lineId = text(formData, 'shippingLineId');

  if (mode !== 'loaded' && mode !== 'destuffed') return { error: 'Choose loaded or de-stuffed.' };

  if (lineId) {
    const { data: line } = await db
      .from('shipping_lines')
      .select('id')
      .eq('id', lineId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (!line) return { error: 'No such shipping line.' };
  }

  const resolved = await findSecurity(ctx.companyId, lineId || null, job.importer_name, mode);

  // Price the containers off the line's matrix. A container already carrying a
  // deposit that has been paid is left alone — repricing it would rewrite
  // history, and the amount actually paid is the one that has to come back.
  const { data: rates } = lineId
    ? await db
        .from('shipping_line_deposit_rates')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('shipping_line_id', lineId)
    : { data: [] as Tables<'shipping_line_deposit_rates'>[] };

  const { data: containers } = await db
    .from('job_do_containers')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('job_do_id', record.id);

  let expected = 0;
  for (const container of containers ?? []) {
    if (container.deposit_paid_on) {
      expected += Number(container.deposit_amount ?? 0);
      continue;
    }
    const amount = resolved.covers ? null : rateFor(rates ?? [], mode, container.size_type);
    expected += Number(amount ?? 0);
    await db
      .from('job_do_containers')
      .update({
        deposit_amount: amount,
        deposit_status: resolved.covers ? 'not_applicable' : amount === null ? 'not_applicable' : 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', container.id)
      .eq('company_id', ctx.companyId);
  }

  const { error } = await db
    .from('job_do')
    .update({
      delivery_mode: mode,
      shipping_line_id: lineId || null,
      security_id: resolved.security?.id ?? null,
      security_covers: resolved.covers,
      deposit_expected: expected,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.mode_set', {
    mode,
    securityReason: resolved.reason,
    depositExpected: expected,
  });
  if (resolved.covers) {
    await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.security_waived', {
      securityId: resolved.security?.id ?? null,
      kind: resolved.security?.kind ?? null,
    });
  }
  await maybeAdvanceToDocuments(db, record.id, ctx.companyId);

  revalidatePath(`/jobs/${jobId}/do`);
  return {
    ok: true,
    message: resolved.covers
      ? 'Saved. A bond covers this job, so no container deposit is due.'
      : `Saved. Deposit expected: ₹${expected.toLocaleString('en-IN')}.`,
  };
}

// ------------------------------------------------------------ containers ----

export async function addContainer(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const containerNo = text(formData, 'containerNo').toUpperCase().replace(/\s+/g, '');
  const sizeType = text(formData, 'sizeType');
  if (containerNo.length < 4) return { error: 'Enter the container number.' };

  const { error } = await db.from('job_do_containers').insert({
    company_id: ctx.companyId,
    job_do_id: record.id,
    job_id: jobId,
    container_no: containerNo,
    size_type: sizeType || null,
  });
  if (error) {
    return { error: error.code === '23505' ? `${containerNo} is already listed.` : error.message };
  }

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: `${containerNo} added.` };
}

export async function saveContainer(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);
  const containerId = text(formData, 'containerId');

  const freeDays = numberOrNull(formData, 'freeDays');
  if (freeDays === null || (freeDays !== undefined && (!Number.isInteger(freeDays) || freeDays < 0))) {
    return { error: 'Free days must be a whole number of days, or blank to follow the job.' };
  }

  const { error } = await db
    .from('job_do_containers')
    .update({
      free_days: freeDays ?? null,
      free_time_from: dateOrNull(formData, 'freeTimeFrom'),
      gated_out_on: dateOrNull(formData, 'gatedOutOn'),
      returned_on: dateOrNull(formData, 'returnedOn'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', containerId)
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Container saved.' };
}

export async function removeContainer(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);
  const containerId = text(formData, 'containerId');

  const { error } = await db
    .from('job_do_containers')
    .delete()
    .eq('id', containerId)
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Container removed.' };
}

// ------------------------------------------------- step 4: the document set ----

export async function addDoDocument(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const name = text(formData, 'name');
  const requiredFor = text(formData, 'requiredFor') || 'do';
  if (name.length < 2) return { error: 'Name the document the line wants.' };
  if (requiredFor !== 'do' && requiredFor !== 'hss') return { error: 'Unknown document set.' };

  const { error } = await db.from('job_do_documents').insert({
    company_id: ctx.companyId,
    job_do_id: record.id,
    job_id: jobId,
    name,
    required_for: requiredFor,
  });
  if (error) {
    return { error: error.code === '23505' ? `${name} is already listed.` : error.message };
  }

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.document_added', { name, requiredFor });

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: `${name} added.` };
}

export async function setDoDocumentStatus(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const rowId = text(formData, 'rowId');
  const status = text(formData, 'status');
  if (status !== 'pending' && status !== 'received' && status !== 'waived') {
    return { error: 'Unknown status.' };
  }

  const settled = status !== 'pending';
  const { error } = await db
    .from('job_do_documents')
    .update({
      status,
      resolved_by: settled ? ctx.userId : null,
      resolved_at: settled ? new Date().toISOString() : null,
      // Reopening detaches the document that settled it, so a later upload is
      // not silently credited to the old one.
      ...(settled ? {} : { document_id: null }),
    })
    .eq('id', rowId)
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.document_settled', { rowId, status });
  await maybeAdvanceToInvoice(db, record.id, ctx.companyId);

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Saved.' };
}

export async function removeDoDocument(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const { error } = await db
    .from('job_do_documents')
    .delete()
    .eq('id', text(formData, 'rowId'))
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Removed.' };
}

/**
 * The line's papers are complete once nothing in the active set is still
 * pending. The active set follows the high-sea-sales flag, so a job that turns
 * into an HSS after the DO papers were assembled goes back to collecting.
 */
async function maybeAdvanceToInvoice(db: Db, doId: string, companyId: string) {
  const [{ data: fresh }, { data: rows }] = await Promise.all([
    db.from('job_do').select('*').eq('id', doId).eq('company_id', companyId).maybeSingle(),
    db
      .from('job_do_documents')
      .select('required_for, status')
      .eq('job_do_id', doId)
      .eq('company_id', companyId),
  ]);
  if (!fresh) return;

  const active = (rows ?? []).filter((r) =>
    fresh.is_high_sea_sale ? true : r.required_for === 'do',
  );
  if (active.length === 0 || active.some((r) => r.status === 'pending')) return;

  await advance(db, fresh, 'invoice', ['documents']);
}

// ------------------------------------------------------ high sea sales ----

export async function toggleHighSeaSale(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);
  const on = text(formData, 'isHighSeaSale') === 'true';

  const { error } = await db
    .from('job_do')
    .update({
      is_high_sea_sale: on,
      hss_flagged_at: on ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.hss_flagged', { on });

  revalidatePath(`/jobs/${jobId}/do`);
  return {
    ok: true,
    message: on
      ? 'Flagged as a high sea sale. Add the documents the line wants for it.'
      : 'High sea sale flag cleared.',
  };
}

// ----------------------------------------------------- steps 5-6: invoices ----

export async function saveInvoice(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const kind = text(formData, 'kind');
  if (kind !== 'proforma' && kind !== 'final') return { error: 'Unknown invoice.' };

  const amount = numberOrNull(formData, 'amount');
  if (amount === null || (amount !== undefined && amount < 0)) {
    return { error: 'Enter a valid invoice amount, or leave it blank.' };
  }

  const { error } = await db.from('job_do_invoices').upsert(
    {
      company_id: ctx.companyId,
      job_do_id: record.id,
      job_id: jobId,
      kind,
      invoice_number: text(formData, 'invoiceNumber') || null,
      invoice_date: dateOrNull(formData, 'invoiceDate'),
      amount: amount ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_do_id,kind' },
  );
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.invoice_recorded', { kind });

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Invoice saved.' };
}

export async function markScrutinised(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const kind = text(formData, 'kind');
  if (kind !== 'proforma' && kind !== 'final') return { error: 'Unknown invoice.' };

  const { data: invoice } = await db
    .from('job_do_invoices')
    .select('id')
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId)
    .eq('kind', kind)
    .maybeSingle();
  if (!invoice) return { error: 'Record the invoice before scrutinising it.' };

  const { error } = await db
    .from('job_do_invoices')
    .update({
      scrutinised_at: new Date().toISOString(),
      scrutinised_by: ctx.userId,
      scrutiny_note: text(formData, 'scrutinyNote') || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoice.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.invoice_scrutinised', { kind });
  if (kind === 'proforma') await advance(db, record, 'payment', ['documents', 'invoice']);

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Marked as scrutinised.' };
}

/**
 * Records that accounts have been told a payment is due.
 *
 * A stamp and a timeline entry, deliberately — there is no accounts module to
 * hand off to yet, and pretending otherwise would hide the gap.
 */
export async function notifyAccounts(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const kind = text(formData, 'kind');
  if (kind !== 'proforma' && kind !== 'final') return { error: 'Unknown invoice.' };

  const { error } = await db
    .from('job_do_invoices')
    .update({ accounts_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId)
    .eq('kind', kind);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.accounts_notified', { kind });

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Recorded that accounts have been told.' };
}

export async function markPaid(_prev: DoActionState, formData: FormData): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const kind = text(formData, 'kind');
  if (kind !== 'proforma' && kind !== 'final') return { error: 'Unknown invoice.' };

  const paidOn = dateOrNull(formData, 'paidOn');
  const amount = numberOrNull(formData, 'paymentAmount');
  if (!paidOn) return { error: 'Enter the date the payment went out.' };
  if (amount === null || (amount !== undefined && amount < 0)) {
    return { error: 'Enter a valid payment amount, or leave it blank.' };
  }

  const { error } = await db
    .from('job_do_invoices')
    .update({
      paid_on: paidOn,
      payment_amount: amount ?? null,
      payment_reference: text(formData, 'paymentReference') || null,
      updated_at: new Date().toISOString(),
    })
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId)
    .eq('kind', kind);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.invoice_paid', { kind, paidOn });

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Payment recorded. Send the details to the line next.' };
}

// ------------------------------------------------ mail to the shipping line ----

/**
 * Drafts the note to the shipping line — payment details, or the high sea sales
 * papers.
 *
 * Written here rather than by the model: both notes are a fixed handful of
 * facts the DO already holds, and the scrutiny prompts exist because *which
 * documents are missing* is a judgement. This is not.
 */
export async function prepareLineEmail(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, job, record } = await ownedDo(jobId);
  const purpose = text(formData, 'purpose');

  const [{ data: company }, { data: profile }, { data: invoices }, { data: containers }] =
    await Promise.all([
      db.from('companies').select('name').eq('id', ctx.companyId).single(),
      db.from('profiles').select('full_name').eq('id', ctx.userId).single(),
      db
        .from('job_do_invoices')
        .select('*')
        .eq('job_do_id', record.id)
        .eq('company_id', ctx.companyId),
      db
        .from('job_do_containers')
        .select('container_no')
        .eq('job_do_id', record.id)
        .eq('company_id', ctx.companyId),
    ]);

  const reference = job.job_number ?? job.reference ?? 'our shipment';
  const boxes = (containers ?? []).map((c) => c.container_no).join(', ');
  const signature = `\n\nRegards,\n${profile?.full_name ?? ctx.email}\n${company?.name ?? ''}`.trimEnd();

  if (purpose === 'hss') {
    return {
      ok: true,
      draft: {
        subject: `High sea sales documents — ${reference}`,
        body:
          `Dear Sir/Madam,\n\n` +
          `This consignment${boxes ? ` (${boxes})` : ''} has been sold on high seas. ` +
          `The high sea sales documents are attached for your records and for the delivery order to be issued in the buyer's name.\n\n` +
          `Please confirm receipt and let us know if anything further is required.` +
          signature,
      },
    };
  }

  const paid = (invoices ?? []).filter((i) => i.paid_on !== null);
  if (paid.length === 0) return { error: 'Record the payment before sending the details.' };

  const lines = paid
    .map((i) => {
      const bits = [
        i.kind === 'final' ? 'Final invoice' : 'Proforma invoice',
        i.invoice_number ? `no. ${i.invoice_number}` : null,
        i.payment_amount !== null ? `— ₹${Number(i.payment_amount).toLocaleString('en-IN')}` : null,
        i.paid_on ? `paid on ${i.paid_on}` : null,
        i.payment_reference ? `(ref ${i.payment_reference})` : null,
      ].filter(Boolean);
      return `  • ${bits.join(' ')}`;
    })
    .join('\n');

  return {
    ok: true,
    draft: {
      subject: `Payment details — ${reference}`,
      body:
        `Dear Sir/Madam,\n\n` +
        `Please find the payment details for the above shipment${boxes ? ` (${boxes})` : ''}:\n\n` +
        `${lines}\n\n` +
        `Kindly release the delivery order and confirm.` +
        signature,
    },
  };
}

/**
 * Sends a note to the shipping line as a reply on the job's own thread.
 *
 * Replying rather than composing keeps Graph's conversationId, which is what
 * the ingest matcher keys on — so the line's answer and its attachments come
 * back to this job by themselves.
 */
export async function sendLineEmail(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const purpose = text(formData, 'purpose');
  const to = text(formData, 'to').toLowerCase();
  const subject = text(formData, 'subject');
  const body = text(formData, 'body');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: "Enter the line's email address." };
  if (!subject || !body) return { error: 'The email needs a subject and a message.' };

  const { data: connection } = await db
    .from('mail_connections')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('profile_id', ctx.userId)
    .maybeSingle();
  if (!connection) return { error: 'Connect your Outlook mailbox before sending.' };
  if (connection.status !== 'active') return { error: 'Your mailbox needs reconnecting.' };
  if (missingScopes(connection.scopes).includes('Mail.Send')) {
    return { error: 'Reconnect your mailbox to grant permission to send email.' };
  }

  // Attach whatever has been filed against the relevant document set.
  const { data: rows } = await db
    .from('job_do_documents')
    .select('document_id, required_for')
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId)
    .eq('required_for', purpose === 'hss' ? 'hss' : 'do')
    .not('document_id', 'is', null);

  const documentIds = (rows ?? []).map((r) => r.document_id).filter((id): id is string => Boolean(id));
  const { data: documents } = documentIds.length
    ? await db
        .from('job_documents')
        .select('file_name, mime_type, storage_bucket, storage_path')
        .eq('company_id', ctx.companyId)
        .in('id', documentIds)
    : { data: [] };

  const attachments = [];
  for (const document of documents ?? []) {
    const { data: blob } = await db.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    if (!blob) continue;
    attachments.push({
      fileName: document.file_name,
      contentType: document.mime_type ?? 'application/octet-stream',
      data: Buffer.from(await blob.arrayBuffer()),
    });
  }

  const { data: sourceMail } = await db
    .from('mail_messages')
    .select('provider_message_id')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .not('provider_message_id', 'is', null)
    .order('received_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  try {
    const accessToken = isConsoleTransport()
      ? 'console'
      : await ensureAccessToken(connection, async (tokens) => {
          const { error } = await db.from('mail_connections').update(tokens).eq('id', connection.id);
          if (error) throw new Error(`Could not persist refreshed tokens: ${error.message}`);
        });

    await sendMailAsUser(accessToken, {
      replyToMessageId: sourceMail?.provider_message_id ?? null,
      to,
      subject,
      body,
      attachments,
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await db
        .from('mail_connections')
        .update({ status: 'needs_reauth', last_error: err.message })
        .eq('id', connection.id);
      return { error: 'Microsoft rejected the request. Reconnect your mailbox and try again.' };
    }
    return { error: err instanceof Error ? err.message : 'Could not send the email.' };
  }

  const now = new Date().toISOString();
  if (purpose === 'hss') {
    await db
      .from('job_do')
      .update({ hss_docs_sent_at: now, updated_at: now })
      .eq('id', record.id)
      .eq('company_id', ctx.companyId);
    await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.hss_docs_sent', { to });
  } else {
    await db
      .from('job_do_invoices')
      .update({ proof_sent_at: now, updated_at: now })
      .eq('job_do_id', record.id)
      .eq('company_id', ctx.companyId)
      .not('paid_on', 'is', null);
    await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.proof_sent', { to });
    await advance(db, record, 'awaiting_do', ['documents', 'invoice', 'payment']);
  }

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: `Sent to ${to}.` };
}

// -------------------------------------------- steps 7-8: the DO and delivery ----

export async function recordDo(_prev: DoActionState, formData: FormData): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const doNumber = text(formData, 'doNumber');
  const channel = text(formData, 'doChannel');
  const receivedAt = dateOrNull(formData, 'doReceivedAt');
  const validUntil = dateOrNull(formData, 'doValidUntil');

  if (!doNumber) return { error: 'Enter the delivery order number.' };
  if (channel !== 'email' && channel !== 'odex') return { error: 'Say where the DO came from.' };
  if (!receivedAt) return { error: 'Enter the date the DO was received.' };
  if (validUntil && validUntil < receivedAt) {
    return { error: 'The DO cannot expire before it was issued.' };
  }

  const { error } = await db
    .from('job_do')
    .update({
      do_number: doNumber,
      do_channel: channel,
      do_received_at: receivedAt,
      do_valid_until: validUntil,
      operations_notified_at: record.operations_notified_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.received', { doNumber, channel });
  if (!record.operations_notified_at) {
    await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.operations_notified', { doNumber });
  }
  await advance(db, record, 'do_received', ['documents', 'invoice', 'payment', 'awaiting_do']);

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'DO recorded. Operations can take delivery.' };
}

export async function recordDelivery(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const deliveredAt = dateOrNull(formData, 'deliveredAt');
  if (!deliveredAt) return { error: 'Enter the date delivery was taken.' };
  if (!record.do_number) return { error: 'Record the DO before recording delivery against it.' };

  const { error } = await db
    .from('job_do')
    .update({ delivered_at: deliveredAt, updated_at: new Date().toISOString() })
    .eq('id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.delivered', { deliveredAt });
  await advance(db, record, 'delivered', ['do_received']);

  revalidatePath(`/jobs/${jobId}/do`);
  return {
    ok: true,
    message: `Delivery recorded. The deposit has to be back within ${DEPOSIT_REFUND_DAYS} days.`,
  };
}

// -------------------------------------------------- step 9: deposit recovery ----

export async function saveDeposit(
  _prev: DoActionState,
  formData: FormData,
): Promise<DoActionState> {
  const jobId = text(formData, 'jobId');
  const { ctx, db, record } = await ownedDo(jobId);

  const containerId = text(formData, 'containerId');
  const status = text(formData, 'depositStatus');
  const allowed = ['not_applicable', 'pending', 'paid', 'claimed', 'refunded', 'forfeited'];
  if (!allowed.includes(status)) return { error: 'Unknown deposit status.' };

  const amount = numberOrNull(formData, 'depositAmount');
  if (amount === null || (amount !== undefined && amount < 0)) {
    return { error: 'Enter a valid deposit amount, or leave it blank.' };
  }

  const { error } = await db
    .from('job_do_containers')
    .update({
      deposit_status: status as Tables<'job_do_containers'>['deposit_status'],
      deposit_amount: amount ?? null,
      deposit_paid_on: dateOrNull(formData, 'depositPaidOn'),
      deposit_claimed_on: dateOrNull(formData, 'depositClaimedOn'),
      deposit_refunded_on: dateOrNull(formData, 'depositRefundedOn'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', containerId)
    .eq('job_do_id', record.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await logEvent(db, ctx.companyId, jobId, ctx.userId, 'do.deposit_updated', {
    containerId,
    status,
  });
  await maybeClose(db, record.id, ctx.companyId, jobId, ctx.userId);

  revalidatePath(`/jobs/${jobId}/do`);
  return { ok: true, message: 'Deposit saved.' };
}

/**
 * Closes the DO once the money is settled in both directions: the final
 * invoice paid, and every container's deposit either back, never due, or
 * written off.
 */
async function maybeClose(
  db: Db,
  doId: string,
  companyId: string,
  jobId: string,
  userId: string,
) {
  const [{ data: fresh }, { data: containers }, { data: invoices }] = await Promise.all([
    db.from('job_do').select('*').eq('id', doId).eq('company_id', companyId).maybeSingle(),
    db
      .from('job_do_containers')
      .select('deposit_status')
      .eq('job_do_id', doId)
      .eq('company_id', companyId),
    db
      .from('job_do_invoices')
      .select('kind, paid_on')
      .eq('job_do_id', doId)
      .eq('company_id', companyId),
  ]);
  if (!fresh || !fresh.delivered_at) return;

  const finalPaid = (invoices ?? []).some((i) => i.kind === 'final' && i.paid_on !== null);
  const settled = ['not_applicable', 'refunded', 'forfeited'];
  const depositsDone = (containers ?? []).every((c) => settled.includes(c.deposit_status));
  if (!finalPaid || !depositsDone) return;

  await advance(db, fresh, 'closed', ['delivered']);
  await logEvent(db, companyId, jobId, userId, 'do.closed', {});
}
