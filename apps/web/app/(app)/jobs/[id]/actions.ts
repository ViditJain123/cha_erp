'use server';

import { revalidatePath } from 'next/cache';
import {
  analyseScrutiny,
  draftFinalNotice,
  hsLookupKeys,
  normaliseHsCode,
  suggestRequestMatches,
} from '@checklist/ingest';
import {
  ReauthRequiredError,
  ensureAccessToken,
  isConsoleTransport,
  missingScopes,
  sendMailAsUser,
} from '@checklist/graph';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export interface JobActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Populated by prepareFinalNotice, which drafts on demand rather than on render. */
  draft?: { subject: string; body: string };
}

/** Loads a job, refusing anything outside the caller's company. */
async function ownedJob(jobId: string) {
  const ctx = await requireCompany();
  const db = serviceClient();
  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) throw new Error('No such job.');
  return { ctx, db, job };
}

export async function updateHsCodes(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const codes = [
    ...new Set(
      String(formData.get('hsCodes') ?? '')
        .split(/[\s,;]+/)
        .map((c) => normaliseHsCode(c))
        .filter((c): c is string => c !== null),
    ),
  ];

  const { error } = await db
    .from('jobs')
    .update({ hs_codes: codes, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message: codes.length > 0 ? `${codes.length} HS code(s) saved.` : 'HS codes cleared.',
  };
}

/** The requirements matching a job's HS codes, plus which are already applied. */
export async function suggestCcrs(jobId: string) {
  const { ctx, db, job } = await ownedJob(jobId);

  const keys = hsLookupKeys(job.hs_codes);
  const [{ data: matches }, { data: applied }] = await Promise.all([
    keys.length > 0
      ? db
          .from('ccr_master')
          .select('*')
          .eq('company_id', ctx.companyId)
          .eq('is_active', true)
          .in('hs_code', keys)
          .order('hs_code')
      : Promise.resolve({ data: [] as never[] }),
    db.from('job_ccrs').select('*').eq('job_id', jobId).eq('company_id', ctx.companyId),
  ]);

  return {
    hsCodes: job.hs_codes,
    suggestions: matches ?? [],
    applied: applied ?? [],
  };
}

/**
 * Applies the selected requirements and runs the scrutiny analysis.
 *
 * One model call produces the missing-document list, the remarks and the draft
 * email together — see packages/ingest/src/scrutiny.ts for why.
 */
export async function applyCcrs(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db, job } = await ownedJob(jobId);

  const ccrIds = formData.getAll('ccrId').map(String).filter(Boolean);
  if (ccrIds.length === 0) return { error: 'Select at least one requirement.' };

  const { data: ccrs } = await db
    .from('ccr_master')
    .select('*')
    .eq('company_id', ctx.companyId)
    .in('id', ccrIds);
  if (!ccrs || ccrs.length === 0) return { error: 'Those requirements no longer exist.' };

  // Denormalised onto the job so the assessment survives the master changing.
  const { error: applyError } = await db.from('job_ccrs').upsert(
    ccrs.map((c) => ({
      company_id: ctx.companyId,
      job_id: jobId,
      ccr_id: c.id,
      code: c.code,
      title: c.title,
      applied_by: ctx.userId,
    })),
    { onConflict: 'job_id,code', ignoreDuplicates: true },
  );
  if (applyError) return { error: applyError.message };

  const [{ data: documents }, { data: company }, { data: profile }] = await Promise.all([
    db.from('job_documents').select('*').eq('job_id', jobId).eq('company_id', ctx.companyId),
    db.from('companies').select('name').eq('id', ctx.companyId).single(),
    db.from('profiles').select('full_name').eq('id', ctx.userId).single(),
  ]);

  let analysis;
  try {
    analysis = await analyseScrutiny({
      jobNumber: job.job_number,
      importerName: job.importer_name,
      supplierName: job.supplier_name,
      hsCodes: job.hs_codes,
      // Digests captured at ingest — no PDF is uploaded again.
      documents: (documents ?? []).map((d) => {
        const c = (d.classification ?? {}) as Record<string, unknown>;
        return {
          fileName: d.file_name,
          docType: d.doc_type,
          summary: typeof c.summary === 'string' ? c.summary : null,
          goodsDescription: typeof c.goodsDescription === 'string' ? c.goodsDescription : null,
        };
      }),
      requirements: ccrs.map((c) => ({
        code: c.code,
        title: c.title,
        requirementText: c.requirement_text,
      })),
      senderName: profile?.full_name ?? ctx.email,
      companyName: company?.name ?? 'our office',
    });
  } catch (err) {
    return {
      error: `The analysis failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (analysis.missingDocuments.length > 0) {
    const { error } = await db.from('job_document_requests').upsert(
      analysis.missingDocuments.map((d) => ({
        company_id: ctx.companyId,
        job_id: jobId,
        name: d.name,
        reason: d.reason,
        ccr_code: d.ccrCode,
        status: 'pending' as const,
      })),
      { onConflict: 'job_id,name', ignoreDuplicates: true },
    );
    if (error) return { error: error.message };
  }

  await db
    .from('jobs')
    .update({ remarks: analysis.remarks, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId);

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'scrutiny.assessed',
    payload: {
      ccrCodes: ccrs.map((c) => c.code),
      missingCount: analysis.missingDocuments.length,
      draftSubject: analysis.draftEmail.subject,
      draftBody: analysis.draftEmail.body,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message:
      analysis.missingDocuments.length === 0
        ? 'Assessed — nothing is missing.'
        : `Assessed — ${analysis.missingDocuments.length} document(s) to request.`,
  };
}

export async function updateRemarks(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const { error } = await db
    .from('jobs')
    .update({ remarks: String(formData.get('remarks') ?? ''), updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Remarks saved.' };
}

export async function setRequestStatus(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const requestId = String(formData.get('requestId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (status !== 'pending' && status !== 'received' && status !== 'waived') {
    return { error: 'Unknown status.' };
  }

  const { error } = await db
    .from('job_document_requests')
    .update({
      status,
      resolved_by: status === 'pending' ? null : ctx.userId,
      resolved_at: status === 'pending' ? null : new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Updated.' };
}

// ------------------------------------------------------- shipper requests --

/** The best-guess shipper for a job, matched on the supplier name. */
export async function suggestShipper(jobId: string) {
  const { ctx, db, job } = await ownedJob(jobId);

  const [{ data: shippers }, { data: events }, { data: connection }] = await Promise.all([
    db
      .from('shippers')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('is_active', true)
      .order('name'),
    db
      .from('job_events')
      .select('payload, created_at, type')
      .eq('job_id', jobId)
      .eq('type', 'scrutiny.assessed')
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('mail_connections')
      .select('id, email_address, scopes, status')
      .eq('company_id', ctx.companyId)
      .eq('profile_id', ctx.userId)
      .maybeSingle(),
  ]);

  const supplier = (job.supplier_name ?? '').trim().toLowerCase();
  const matched =
    supplier.length > 0
      ? (shippers ?? []).find((s) => {
          const names = [s.name, ...s.aliases].map((n) => n.toLowerCase());
          // Either side may be the fuller form: "Fuchs" vs "Fuchs Lubricants GmbH".
          return names.some((n) => n === supplier || n.includes(supplier) || supplier.includes(n));
        })
      : undefined;

  const draft = (events?.[0]?.payload ?? {}) as Record<string, unknown>;

  return {
    shippers: shippers ?? [],
    suggested: matched ?? null,
    currentEmail: job.shipper_email ?? matched?.email ?? null,
    draftSubject: typeof draft.draftSubject === 'string' ? draft.draftSubject : '',
    draftBody: typeof draft.draftBody === 'string' ? draft.draftBody : '',
    connection: connection ?? null,
  };
}

/**
 * Sends the document request to the shipper as a reply on the job's original
 * email thread, then parks the job until they answer.
 */
export async function sendShipperRequest(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db, job } = await ownedJob(jobId);

  const to = String(formData.get('to') ?? '').trim().toLowerCase();
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'Enter a valid shipper address.' };
  if (!subject) return { error: 'The email needs a subject.' };
  if (!body) return { error: 'The email is empty.' };

  const { data: connection } = await db
    .from('mail_connections')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('profile_id', ctx.userId)
    .maybeSingle();

  if (!connection) return { error: 'Connect your Outlook mailbox before sending.' };
  if (connection.status !== 'active') {
    return { error: 'Your mailbox needs reconnecting before it can send.' };
  }
  if (missingScopes(connection.scopes).includes('Mail.Send')) {
    // Consented before sending was added. Failing here with an explanation is
    // better than Graph returning an opaque 403 at the moment they click send.
    return { error: 'Reconnect your mailbox to grant permission to send email.' };
  }

  // Reply on the thread the documents arrived on, so the shipper's answer keeps
  // the same conversationId and the matcher can find its way home.
  const { data: sourceMail } = await db
    .from('mail_messages')
    .select('provider_message_id')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .not('provider_message_id', 'is', null)
    .order('received_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let sent;
  try {
    // The console transport never reaches Microsoft, so it must not demand a
    // token — a fixture mailbox has none.
    const accessToken = isConsoleTransport()
      ? 'console'
      : await ensureAccessToken(connection, async (tokens) => {
          const { error } = await db
            .from('mail_connections')
            .update(tokens)
            .eq('id', connection.id);
          if (error) throw new Error(`Could not persist refreshed tokens: ${error.message}`);
        });

    sent = await sendMailAsUser(accessToken, {
      replyToMessageId: sourceMail?.provider_message_id ?? null,
      to,
      subject,
      body,
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

  // Register the outgoing conversation so the reply matches this job even if it
  // arrives with no recognisable shipment identifiers of its own.
  if (sent.conversationId) {
    await db.from('job_identifiers').upsert(
      {
        company_id: ctx.companyId,
        job_id: jobId,
        kind: 'conversation',
        value: sent.conversationId,
        value_raw: sent.conversationId,
      },
      { onConflict: 'company_id,kind,value', ignoreDuplicates: true },
    );
  }

  const shipperId = String(formData.get('shipperId') ?? '') || null;
  await db
    .from('jobs')
    .update({
      stage: 'awaiting_shipper',
      shipper_email: to,
      shipper_id: shipperId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .in('stage', ['scrutiny', 'awaiting_shipper']);

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'shipper.requested',
    payload: {
      to,
      subject: sent.subject,
      body,
      conversationId: sent.conversationId,
      threaded: Boolean(sourceMail?.provider_message_id),
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `Sent to ${to}.` };
}

/**
 * Proposes which documents on the job satisfy the outstanding requests.
 *
 * Nothing is closed here — the suggestions come back for a human to accept.
 * Auto-closing on a model's say-so is how a job reaches noting believing it
 * holds a document it does not.
 */
export async function matchArrivedDocuments(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const [{ data: requests }, { data: documents }] = await Promise.all([
    db
      .from('job_document_requests')
      .select('id, name, reason')
      .eq('company_id', ctx.companyId)
      .eq('job_id', jobId)
      .eq('status', 'pending'),
    db.from('job_documents').select('*').eq('company_id', ctx.companyId).eq('job_id', jobId),
  ]);

  if (!requests || requests.length === 0) return { ok: true, message: 'Nothing is outstanding.' };

  let result;
  try {
    result = await suggestRequestMatches({
      requests: requests.map((r) => ({ name: r.name, reason: r.reason })),
      documents: (documents ?? []).map((d) => {
        const c = (d.classification ?? {}) as Record<string, unknown>;
        return {
          fileName: d.file_name,
          docType: d.doc_type,
          summary: typeof c.summary === 'string' ? c.summary : null,
          goodsDescription: typeof c.goodsDescription === 'string' ? c.goodsDescription : null,
        };
      }),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not check the documents.' };
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'scrutiny.reconciled',
    payload: { matches: result.matches },
  });

  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message:
      result.matches.length === 0
        ? 'Nothing on the job matches what is still outstanding.'
        : `${result.matches.length} possible match(es): ${result.matches
            .map((m) => `${m.requestName} ← ${m.fileName} (${m.confidence})`)
            .join('; ')}. Mark them received if you agree.`,
  };
}

// ------------------------------------------------- revision and hand-off --

/** Sends the job back to the documents branch for an updated checklist. */
export async function requestChecklistRevision(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const { data: outstanding } = await db
    .from('job_document_requests')
    .select('id')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .eq('status', 'pending');

  if ((outstanding ?? []).length > 0) {
    return {
      error: `${outstanding?.length} document(s) are still outstanding. Settle them first.`,
    };
  }

  const { error } = await db
    .from('jobs')
    .update({ stage: 'checklist_revision', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .in('stage', ['scrutiny', 'awaiting_shipper']);
  if (error) return { error: error.message };

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'checklist.revision_requested',
    payload: { note: String(formData.get('note') ?? '') },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Sent back for a revised checklist.' };
}

/**
 * Drafts the closing note.
 *
 * A form action rather than something the page computes, so the model is only
 * called when a user actually asks for the draft — not on every render of every
 * job that happens to be in scrutiny.
 */
export async function prepareFinalNotice(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db, job } = await ownedJob(jobId);

  const [{ data: requests }, { data: company }, { data: profile }] = await Promise.all([
    db
      .from('job_document_requests')
      .select('name, status')
      .eq('company_id', ctx.companyId)
      .eq('job_id', jobId),
    db.from('companies').select('name').eq('id', ctx.companyId).single(),
    db.from('profiles').select('full_name').eq('id', ctx.userId).single(),
  ]);

  try {
    const notice = await draftFinalNotice({
      jobNumber: job.job_number,
      importerName: job.importer_name,
      supplierName: job.supplier_name,
      documentsRequested: (requests ?? [])
        .filter((r) => r.status === 'received')
        .map((r) => r.name),
      checklistAttached: true,
      senderName: profile?.full_name ?? ctx.email,
      companyName: company?.name ?? 'our office',
    });
    return { ok: true, draft: notice };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not draft the message.' };
  }
}

/**
 * Tells the shipper the checklist is final, attaches it, and hands the job to
 * noting.
 *
 * Noting has no system yet — this only records that scrutiny is done and the
 * job is sitting there.
 */
export async function sendFinalNotice(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db, job } = await ownedJob(jobId);

  const to = String(formData.get('to') ?? '').trim().toLowerCase();
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const attachChecklist = String(formData.get('attachChecklist') ?? '') === 'on';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'Enter a valid shipper address.' };
  if (!subject || !body) return { error: 'The email needs a subject and a message.' };

  const { data: connection } = await db
    .from('mail_connections')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('profile_id', ctx.userId)
    .maybeSingle();
  if (!connection) return { error: 'Connect your Outlook mailbox before sending.' };
  if (missingScopes(connection.scopes).includes('Mail.Send')) {
    return { error: 'Reconnect your mailbox to grant permission to send email.' };
  }

  // The latest checklist, so a revision is what goes out rather than the first
  // version.
  const { data: checklist } = await db
    .from('job_documents')
    .select('file_name, storage_bucket, storage_path')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .eq('doc_type', 'checklist')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const attachments = [];
  if (attachChecklist && checklist) {
    const { data: blob } = await db.storage
      .from(checklist.storage_bucket)
      .download(checklist.storage_path);
    if (blob) {
      attachments.push({
        fileName: checklist.file_name,
        contentType: 'application/pdf',
        data: Buffer.from(await blob.arrayBuffer()),
      });
    }
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
          const { error } = await db
            .from('mail_connections')
            .update(tokens)
            .eq('id', connection.id);
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

  await db
    .from('jobs')
    .update({ stage: 'noting', shipper_email: to, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .in('stage', ['scrutiny', 'awaiting_shipper']);

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'scrutiny.completed',
    payload: {
      to,
      subject,
      body,
      checklistAttached: attachments.length > 0,
      jobNumber: job.job_number,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Sent. Scrutiny is done and the job is at noting.' };
}
