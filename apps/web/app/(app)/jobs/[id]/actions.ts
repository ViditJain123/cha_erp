'use server';

import { revalidatePath } from 'next/cache';
import {
  analyseScrutiny,
  draftFinalNotice,
  hsLookupKeys,
  hsMatchesPrefix,
  nameRequirement,
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
import type { ChecklistDraft } from '@checklist/extraction';
import { requireCompany } from '@/lib/auth';
import { CCR_WAIVED_EVENT } from '@/lib/jobs';
import { importerFrom, organizationById, supplierFrom } from '@/lib/parties';
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
  const [{ data: matches }, { data: applied }, { data: waivers }] = await Promise.all([
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
    db
      .from('job_events')
      .select('created_at')
      .eq('job_id', jobId)
      .eq('type', CCR_WAIVED_EVENT)
      .limit(1),
  ]);

  return {
    hsCodes: job.hs_codes,
    suggestions: matches ?? [],
    applied: applied ?? [],
    // Like the draft email in suggestShipper, the decision lives in the event
    // log rather than in a column of its own.
    waived: (waivers ?? []).length > 0,
  };
}

/**
 * Records a requirement typed in during scrutiny, so the person assessing the
 * job is not sent to Settings to paste CSV mid-job.
 *
 * It writes the tenant master, not the job: an HS code that obliged this
 * importer once will oblige the next shipment too, and the whole point of the
 * master is that nobody has to remember it a second time. The new row then
 * comes back as a suggestion like any other, so the assessment that finds
 * missing documents stays the single path onto the job.
 */
export async function createCcr(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db, job } = await ownedJob(jobId);

  // 2–8 digits, matching the ccr_master check constraint: a requirement filed
  // at chapter level ('33') is as legitimate as one at full 8-digit level.
  const hsCode = String(formData.get('hsCode') ?? '').replace(/\D/g, '');
  const requirementText = String(formData.get('requirementText') ?? '').trim();

  if (hsCode.length < 2 || hsCode.length > 8) {
    return { error: 'Enter the HS code the requirement applies to (2–8 digits).' };
  }
  if (requirementText.length < 12) {
    return { error: 'Paste what the requirement obliges the importer to hold.' };
  }

  // Saving a prefix none of the job's codes fall under would file the
  // requirement correctly in the master and leave this job looking untouched —
  // the one failure the operator would not spot.
  if (!job.hs_codes.some((c: string) => hsMatchesPrefix(c, hsCode))) {
    return {
      error:
        job.hs_codes.length === 0
          ? 'Record the job’s HS codes first.'
          : `${hsCode} does not cover any of this job's HS codes (${job.hs_codes.join(', ')}).`,
    };
  }

  // The operator pastes the substance; the name is ours to derive. A failed
  // call must not lose what they typed, so it falls back to the text itself.
  let title: string;
  let code: string;
  try {
    const named = await nameRequirement({ requirementText, hsCode });
    title = named.title.trim() || firstClause(requirementText);
    code = tidyCcrCode(named.code) || tidyCcrCode(title);
  } catch {
    title = firstClause(requirementText);
    code = tidyCcrCode(title);
  }

  // (company, hs_code, code) is unique and the code is no longer typed by a
  // human, so two unrelated requirements under one heading can derive the same
  // handle. Upserting on that would quietly replace the first one.
  const { data: existing } = await db
    .from('ccr_master')
    .select('code, requirement_text')
    .eq('company_id', ctx.companyId)
    .eq('hs_code', hsCode)
    .like('code', `${code}%`);
  const identical = (existing ?? []).find((row) => row.requirement_text === requirementText);
  if (identical) {
    // Same requirement typed twice: update the row it already has, whatever
    // suffix that one ended up with.
    code = identical.code;
  } else if ((existing ?? []).some((row) => row.code === code)) {
    code = `${code}-${(existing ?? []).length + 1}`;
  }

  const { data: ccr, error } = await db
    .from('ccr_master')
    .upsert(
      {
        company_id: ctx.companyId,
        hs_code: hsCode,
        code,
        title,
        requirement_text: requirementText,
        is_active: true,
      },
      { onConflict: 'company_id,hs_code,code' },
    )
    .select()
    .single();
  if (error) return { error: error.message };

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'ccr.created',
    payload: { hsCode, code: ccr.code, title: ccr.title },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/settings/ccr');
  return {
    ok: true,
    message: `Saved under ${hsCode}. It is ticked below — apply it to assess the job.`,
  };
}

/**
 * Records that no compliance requirement applies, which is a real outcome and
 * not the same as nobody having looked. Close-out needs one or the other.
 */
export async function waiveCcrs(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db, job } = await ownedJob(jobId);

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: CCR_WAIVED_EVENT,
    payload: { hsCodes: job.hs_codes },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Recorded — no compliance requirement applies.' };
}

/**
 * A short code for a hand-entered requirement: the master's uniqueness key is
 * (company, hs_code, code), so it only has to be stable and readable.
 */
function tidyCcrCode(raw: string): string {
  return (
    raw
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16)
      .replace(/-+$/, '') || 'CCR'
  );
}

/** Fallback title when the model is unavailable: the opening clause, capped. */
function firstClause(text: string): string {
  const sentence = text.split(/(?<=[.;])\s/)[0]?.trim() ?? text.trim();
  const clean = sentence.replace(/[.;]+$/, '');
  if (clean.length <= 72) return clean;
  const cut = clean.slice(0, 72);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : 72);
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

  // What the invoice's goods did to each requirement, kept against the
  // requirement rather than only as prose in remarks.
  const assessedAt = new Date().toISOString();
  await Promise.all(
    analysis.assessments.map((a) =>
      db
        .from('job_ccrs')
        .update({ applies: a.applies, assessment_note: a.note, assessed_at: assessedAt })
        .eq('company_id', ctx.companyId)
        .eq('job_id', jobId)
        .eq('code', a.ccrCode),
    ),
  );

  if (analysis.missingDocuments.length > 0) {
    // The model is asked to cite the requirement that drives each document, and
    // will happily cite one it inferred from inside a requirement's text rather
    // than one we gave it. Anything we did not supply becomes null instead of a
    // code that resolves to nothing.
    const known = new Set(ccrs.map((c) => c.code));
    const { error } = await db.from('job_document_requests').upsert(
      analysis.missingDocuments.map((d) => ({
        company_id: ctx.companyId,
        job_id: jobId,
        name: d.name,
        reason: d.reason,
        ccr_code: d.ccrCode && known.has(d.ccrCode) ? d.ccrCode : null,
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

  const inapplicable = analysis.assessments.filter((a) => !a.applies).length;
  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message: [
      analysis.missingDocuments.length === 0
        ? 'Assessed — nothing is missing.'
        : `Assessed — ${analysis.missingDocuments.length} document(s) to request.`,
      inapplicable > 0 ? `${inapplicable} did not apply to these goods.` : '',
    ]
      .filter(Boolean)
      .join(' '),
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

// ------------------------------------------------------------- parties --

/**
 * Bind a party on the job to a row in the organization repository.
 *
 * Logi-Sys resolves the importer and supplier from its own repository on the
 * name and branch we send it, so this is not cosmetic: it decides which party
 * the Bill of Entry is filed for. The chosen row is written straight onto the
 * latest draft and marked 'manual', which stops a re-read of the documents
 * putting the guessed name back.
 *
 * Called from a client component rather than a form, because the picker
 * already knows the id it wants and has nothing else to submit.
 */
export async function setJobParty(
  jobId: string,
  slot: 'importer' | 'supplier',
  organizationId: string,
): Promise<JobActionState> {
  const { ctx, db } = await ownedJob(jobId);

  const org = await organizationById(ctx.companyId, organizationId);
  if (!org) return { error: 'That organization is not in this company’s repository.' };

  const { data: latest } = await db
    .from('job_drafts')
    .select('id, draft')
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) return { error: 'Read the documents first — there is no draft to change.' };

  const draft = latest.draft as unknown as ChecklistDraft;
  const updated: ChecklistDraft =
    slot === 'importer'
      ? { ...draft, importer: importerFrom(org, 'manual') }
      : { ...draft, supplier: supplierFrom(org, 'manual') };

  // The stale warning for this party is the one thing the choice invalidates.
  updated.flags = draft.flags.filter((f) => f.path !== slot);

  // Edited in place rather than versioned: this corrects the draft's party
  // rather than superseding the draft, and a new version would read as a
  // second reading of the documents in the timeline.
  const { error } = await db
    .from('job_drafts')
    .update({ draft: updated as never })
    .eq('id', latest.id)
    .eq('company_id', ctx.companyId);
  if (error) return { error: error.message };

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'party.bound',
    payload: {
      slot,
      organizationId: org.id,
      name: org.name,
      branchName: org.branch_name,
      previousName: slot === 'importer' ? draft.importer.name : draft.supplier.name,
    },
  });

  if (slot === 'importer') {
    // jobs.importer_name is what the job list and the bond matcher read.
    await db
      .from('jobs')
      .update({ importer_name: org.name })
      .eq('id', jobId)
      .eq('company_id', ctx.companyId);
  }

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `${slot === 'importer' ? 'Importer' : 'Supplier'} set to ${org.name}.` };
}
