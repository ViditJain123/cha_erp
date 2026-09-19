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
  VALID_UQC,
  describeWarehouseCodeError,
  isBondCode,
  isValidContainerNumber,
  lookupCustomHouse,
  lookupTariff,
  normaliseContainerNumber,
  normalizePackageUnit,
  pad8,
  parseWarehouseCodeResult,
} from '@checklist/core';
import {
  ReauthRequiredError,
  ensureAccessToken,
  isConsoleTransport,
  missingScopes,
  sendMailAsUser,
} from '@checklist/graph';
import type { ChecklistDraft, ExBondClearanceKind } from '@checklist/extraction';
import type { TablesInsert } from '@checklist/db';
import { requireCompany } from '@/lib/auth';
import { applyContainerResolution } from '@/lib/containers';
import { applyGeneralResolution } from '@/lib/general';
import { applyInbondExbondResolution } from '@/lib/inbond';
import { applySecuritiesResolution } from '@/lib/securities';
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

// --------------------------------------------------- BE header (GENERAL) --

/** A date input that was left empty is null, not the empty string. */
function dateOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? '').trim();
  return v === '' ? null : v;
}

function textOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? '').trim();
  return v === '' ? null : v;
}

/**
 * Save the operator's Bill of Entry header and re-resolve the draft against it.
 *
 * The nine declaration checkboxes are written as explicit `false` rather than
 * left null once this form has been submitted: an unticked box after someone
 * has looked at the form is "no", which is a different thing from the null that
 * means nobody has looked. Both export as a blank cell, but only the second
 * should make the job screen ask.
 *
 * The custom house is validated against the master here rather than on export.
 * A code that is not an ICEGATE station is a typo, and finding it out at
 * download time is finding it out too late.
 */
export async function saveBeHeader(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const customsHouseCode = textOrNull(formData, 'customsHouseCode');
  if (customsHouseCode && !lookupCustomHouse(customsHouseCode)) {
    return { error: `"${customsHouseCode}" is not an ICEGATE customs station code.` };
  }

  const flag = (key: string) => formData.get(key) === 'on';
  const sec46Reason = textOrNull(formData, 'sec46OverrideReason');

  // The package kind is validated here rather than at export. A unit the
  // package-unit master does not know reaches Logi-Sys as a rejected upload,
  // and finding the typo then is finding it too late.
  const packageUnitCode = textOrNull(formData, 'packageUnitCode');
  if (packageUnitCode && !normalizePackageUnit(packageUnitCode)) {
    return { error: `"${packageUnitCode}" is not a package kind the Bill of Entry accepts.` };
  }

  const { error } = await db.from('job_boe_header').upsert(
    {
      job_id: jobId,
      company_id: ctx.companyId,
      customs_house_code: customsHouseCode
        ? (lookupCustomHouse(customsHouseCode)?.code ?? customsHouseCode)
        : null,
      be_type: (textOrNull(formData, 'beType') as 'home_consumption' | 'warehousing' | 'ex_bond' | null),
      duty_payment_status: textOrNull(formData, 'dutyPaymentStatus'),
      ad_code: textOrNull(formData, 'adCode'),
      importer_ref_no: textOrNull(formData, 'importerRefNo'),
      igm_no: textOrNull(formData, 'igmNo'),
      igm_date: dateOrNull(formData, 'igmDate'),
      inward_date: dateOrNull(formData, 'inwardDate'),
      be_filing_date: dateOrNull(formData, 'beFilingDate'),
      igm_checked: formData.get('igmChecked') === 'on',
      line_no: textOrNull(formData, 'lineNo'),
      gateway_igm_no: textOrNull(formData, 'gatewayIgmNo'),
      gateway_igm_date: dateOrNull(formData, 'gatewayIgmDate'),
      gateway_inward_date: dateOrNull(formData, 'gatewayInwardDate'),
      package_unit_code: packageUnitCode ? normalizePackageUnit(packageUnitCode)! : null,
      marks_and_nos: textOrNull(formData, 'marksAndNos'),
      is_first_check: flag('isFirstCheck'),
      is_green_channel: flag('isGreenChannel'),
      is_kachcha_be: flag('isKachchaBe'),
      is_hss: flag('isHss'),
      is_bonds_certificates: flag('isBondsCertificates'),
      is_transhipment: flag('isTranshipment'),
      itc_lic_details: flag('itcLicDetails'),
      is_under_provisional_assessment: flag('isUnderProvisionalAssessment'),
      // A reason given is a decision to clear the flag; no reason leaves the
      // derived value to stand.
      is_under_sec46: sec46Reason ? false : null,
      sec46_override_reason: sec46Reason,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' },
  );
  if (error) return { error: error.message };

  // Re-resolve rather than patch: the header's fields depend on each other —
  // an inward date changes the filing status and both section flags — and
  // re-running the resolver is the only way those stay consistent.
  const { data: latest } = await db
    .from('job_drafts')
    .select('id, draft')
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const resolved = await applyGeneralResolution(
      latest.draft as unknown as ChecklistDraft,
      ctx.companyId,
      jobId,
    );
    await db
      .from('job_drafts')
      .update({ draft: resolved as never })
      .eq('id', latest.id)
      .eq('company_id', ctx.companyId);
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'boe.header.saved',
    payload: {
      customsHouseCode,
      igmNo: textOrNull(formData, 'igmNo'),
      inwardDate: dateOrNull(formData, 'inwardDate'),
      beFilingDate: dateOrNull(formData, 'beFilingDate'),
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return {
    ok: true,
    message: latest
      ? 'Header saved and the Bill of Entry re-resolved.'
      : 'Header saved. Read the documents to build a draft.',
  };
}

// ------------------------------------------------------- CONTAINERS ------

/**
 * Save the operator's container list and re-resolve the draft against it.
 *
 * The whole list is submitted and the whole list is rewritten, rather than one
 * row at a time. That is the point of the table: a Bill of Entry declares the
 * containers on the bill of lading, all of them, and "these are the containers"
 * is a single statement a person makes after looking at the document. Saving an
 * empty list deletes the rows and hands the sheet back to whatever the
 * documents were read to say.
 *
 * A number that fails its ISO 6346 check digit is saved, not refused. Refusing
 * it would be this feature reintroducing its own bug — a container the system
 * declines to carry is a container missing from the Bill of Entry — so it is
 * saved and said out loud instead.
 */
export async function saveContainers(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const numbers = formData.getAll('containerNo').map((v) => String(v).trim());
  const seals = formData.getAll('sealNo').map((v) => String(v).trim());
  const sizes = formData.getAll('sizeType').map((v) => String(v).trim());

  const rows = numbers
    .map((containerNo, i) => ({
      containerNo,
      sealNo: seals[i]?.trim() || null,
      sizeType: sizes[i]?.trim() || null,
    }))
    .filter((r) => r.containerNo !== '');

  const seen = new Set<string>();
  for (const r of rows) {
    const key = normaliseContainerNumber(r.containerNo);
    if (seen.has(key)) return { error: `${r.containerNo} is listed twice.` };
    seen.add(key);
  }

  // Rewritten wholesale: the rows are one statement, and a partial update would
  // leave a container nobody meant to keep.
  const { error: clearError } = await db
    .from('job_containers')
    .delete()
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId);
  if (clearError) return { error: clearError.message };

  if (rows.length) {
    const { error } = await db.from('job_containers').insert(
      rows.map((r, i) => ({
        company_id: ctx.companyId,
        job_id: jobId,
        sr_no: i + 1,
        container_no: r.containerNo,
        seal_no: r.sealNo,
        size_type: r.sizeType,
        updated_by: ctx.userId,
      })),
    );
    if (error) return { error: error.message };
  }

  const { data: latest } = await db
    .from('job_drafts')
    .select('id, draft')
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const resolved = await applyContainerResolution(
      latest.draft as unknown as ChecklistDraft,
      ctx.companyId,
      jobId,
    );
    await db
      .from('job_drafts')
      .update({ draft: resolved as never })
      .eq('id', latest.id)
      .eq('company_id', ctx.companyId);
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'boe.containers.saved',
    payload: { count: rows.length, containers: rows.map((r) => r.containerNo) },
  });

  revalidatePath(`/jobs/${jobId}`);

  const bad = rows.filter((r) => !isValidContainerNumber(r.containerNo));
  if (bad.length) {
    return {
      ok: true,
      message:
        `Saved ${rows.length} container${rows.length === 1 ? '' : 's'}. ` +
        `${bad.map((r) => r.containerNo).join(', ')} ${bad.length === 1 ? 'does' : 'do'} not pass the ` +
        'ISO 6346 check digit — worth a second look at the B/L.',
    };
  }
  return {
    ok: true,
    message: rows.length
      ? `Saved ${rows.length} container${rows.length === 1 ? '' : 's'}.`
      : 'Container list cleared — the Bill of Entry will use what the documents say.',
  };
}

// ------------------------------------------------- bond (INBOND_EXBOND) --

/** One finished-goods entry as it is stored, before the job id is known. */
type FinishedGoodInput = Omit<
  TablesInsert<'job_sec65_finished_goods'>,
  'company_id' | 'job_id'
>;

/**
 * The SEC65_EXBOND_INFO block off the form.
 *
 * Validated here as well as in the exporter, and for a different reason: the
 * exporter refuses a workbook, while this refuses a *save*, so the operator is
 * told about a bad CTH while they are still looking at the field. The rules are
 * ICES's own (BE filing errors 728, 730, 731, 732) — what the exporter adds is
 * the cross-row ones it can only see once the items are known.
 *
 * Returns an Error rather than throwing so the caller answers with `{ error }`,
 * which is what the panel renders.
 */
function readFinishedGoods(formData: FormData): FinishedGoodInput[] | Error {
  const count = Number(formData.get('sec65Count') ?? '0');
  if (!Number.isFinite(count) || count <= 0) return [];

  const rows: FinishedGoodInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = (field: string) => textOrNull(formData, `sec65_${i}_${field}`);
    const where = `Finished product ${i + 1}`;

    const gstInvoiceNo = at('gstInvoiceNo');
    const gstInvoiceDate = at('gstInvoiceDate');
    const rawCth = at('cth');
    const description = at('description');
    const rawQty = at('quantity');
    const rawUqc = at('uqc');

    // A row the operator added and left empty is a row they changed their mind
    // about, not an error.
    if (
      !gstInvoiceNo &&
      !gstInvoiceDate &&
      !rawCth &&
      !description &&
      !rawQty &&
      !rawUqc
    ) {
      continue;
    }

    if (!gstInvoiceNo) return new Error(`${where}: the GST invoice number is missing.`);
    if (gstInvoiceNo.length > 16) {
      return new Error(
        `${where}: a GST invoice number is sixteen characters at most — "${gstInvoiceNo}" is ${gstInvoiceNo.length}.`,
      );
    }
    if (!gstInvoiceDate) return new Error(`${where}: the GST invoice date is missing.`);

    const cth = pad8(rawCth ?? undefined);
    if (!cth) return new Error(`${where}: the finished product's CTH is missing.`);
    if (!lookupTariff(cth)) {
      return new Error(
        `${where}: ${cth} is not a tariff item. This is the finished product's own heading, ` +
          'which is rarely the heading of any input it was made from.',
      );
    }
    if (!description) return new Error(`${where}: the finished product has no description.`);

    const quantity = Number(rawQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return new Error(`${where}: the quantity cleared must be greater than zero.`);
    }

    const uqc = (rawUqc ?? '').toUpperCase();
    if (!VALID_UQC.has(uqc)) {
      return new Error(
        `${where}: "${uqc || 'no unit'}" is not an ICES unit quantity code. One of ` +
          `${[...VALID_UQC].join(', ')}.`,
      );
    }

    // Empty means every item on the BE, which is the ordinary case and is
    // stored as null rather than as a list that would go stale when an item is
    // added.
    const rawItems = at('itemSrNos');
    let appliesTo: number[] | null = null;
    if (rawItems) {
      const parsed = rawItems
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (parsed.some((n) => !Number.isInteger(n) || n <= 0)) {
        return new Error(`${where}: "made from item" takes item serial numbers, comma separated.`);
      }
      appliesTo = [...new Set(parsed)].sort((a, b) => a - b);
    }

    rows.push({
      seq: rows.length + 1,
      gst_invoice_no: gstInvoiceNo,
      gst_invoice_date: gstInvoiceDate,
      finished_cth: cth,
      finished_desc: description,
      finished_qty: quantity,
      finished_uqc: uqc,
      applies_to_items: appliesTo,
      source: 'operator',
    });
  }
  return rows;
}


/**
 * Save the warehouse, the into-bond BE and the release quantity for a bonded
 * Bill of Entry.
 *
 * The warehouse code is validated here rather than at export because a code
 * that names no customs station is a typo, and the operator is looking at the
 * field right now. `parseWarehouseCode` also normalises case, so "maa1u001"
 * is stored the way ICES writes it.
 *
 * Like `saveBeHeader`, this re-runs the resolvers rather than patching the
 * draft: a released package count changes the item quantities, which changes
 * the assessable value, which changes the duty. Patching one of those would
 * leave the other three stale.
 */
export async function saveBondDetails(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const rawCode = textOrNull(formData, 'warehouseCode');
  const parsedCode = rawCode ? parseWarehouseCodeResult(rawCode) : null;
  if (parsedCode && !parsedCode.ok) {
    return { error: describeWarehouseCodeError(parsedCode.error) };
  }

  const packagesRaw = textOrNull(formData, 'releasedPackages');
  const packages = packagesRaw ? Number(packagesRaw) : null;
  if (packages !== null && (!Number.isFinite(packages) || packages <= 0)) {
    return { error: 'Packages released must be a whole number greater than zero.' };
  }

  const weightRaw = textOrNull(formData, 'releasedGrossWeightKg');
  const weight = weightRaw ? Number(weightRaw) : null;
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) {
    return { error: 'Released gross weight must be greater than zero.' };
  }

  // ---------------------------------------------------------- section 65 ----
  const isSec65 = formData.get('isSec65ManufacturingWh') === 'on';
  const clearanceKind = isSec65
    ? ((textOrNull(formData, 'exbondClearanceKind') ?? null) as ExBondClearanceKind | null)
    : null;

  // The eight columns of SEC65_EXBOND_INFO, one set per finished product. Only
  // read when the clearance is one that declares them, so switching a job to an
  // as-such clearance drops the rows rather than leaving them to be written.
  const finishedGoods =
    clearanceKind === 'resultant_product' ? readFinishedGoods(formData) : [];
  if (finishedGoods instanceof Error) return { error: finishedGoods.message };

  const { error } = await db.from('job_boe_header').upsert(
    {
      job_id: jobId,
      company_id: ctx.companyId,
      warehouse_code: parsedCode?.ok ? parsedCode.parsed.code : null,
      inbond_be_no: textOrNull(formData, 'inbondBeNo'),
      inbond_be_date: dateOrNull(formData, 'inbondBeDate'),
      bond_no: textOrNull(formData, 'bondNo'),
      bond_date: dateOrNull(formData, 'bondDate'),
      bond_expiry_date: dateOrNull(formData, 'bondExpiryDate'),
      is_warehouse_sale: formData.get('isWarehouseSale') === 'on',
      is_sec65_manufacturing_wh: isSec65,
      exbond_clearance_kind: clearanceKind,
      released_packages: packages,
      released_package_code: textOrNull(formData, 'releasedPackageCode'),
      released_gross_weight_kg: weight,
      released_uom: textOrNull(formData, 'releasedUom'),
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' },
  );
  if (error) return { error: error.message };

  // Replaced wholesale rather than merged: the seq is the declaration order,
  // and reconciling a reordered list row by row would renumber the wrong ones.
  const { error: clearError } = await db
    .from('job_sec65_finished_goods')
    .delete()
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId);
  if (clearError) return { error: clearError.message };

  if (finishedGoods.length) {
    const { error: insertError } = await db.from('job_sec65_finished_goods').insert(
      finishedGoods.map((row) => ({
        ...row,
        company_id: ctx.companyId,
        job_id: jobId,
        updated_by: ctx.userId,
      })),
    );
    if (insertError) return { error: insertError.message };
  }

  const { data: latest } = await db
    .from('job_drafts')
    .select('id, draft')
    .eq('job_id', jobId)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const withHeader = await applyGeneralResolution(
      latest.draft as unknown as ChecklistDraft,
      ctx.companyId,
      jobId,
    );
    const resolved = await applyInbondExbondResolution({
      draft: withHeader,
      companyId: ctx.companyId,
      jobId,
    });
    await db
      .from('job_drafts')
      .update({ draft: resolved as never })
      .eq('id', latest.id)
      .eq('company_id', ctx.companyId);
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'boe.bond.saved',
    payload: {
      warehouseCode: parsedCode?.ok ? parsedCode.parsed.code : null,
      inbondBeNo: textOrNull(formData, 'inbondBeNo'),
      releasedPackages: packages,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Bond details saved.' };
}

/* ------------------------------------------------------------------ *
 * Securities — the HSS chain, the bonds and certificates, the IRNs
 * ------------------------------------------------------------------ */

interface HssRowInput {
  level: number;
  iec: string;
  branch_sr_no: number | null;
  name: string | null;
  branch_name: string | null;
  ad_code: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
}

/**
 * The high-seas chain, read off the repeated form rows.
 *
 * `level` is ICES' *preceding level*, and it is positional: the first row is
 * the party who sold to the filing importer. The panel does not let the
 * operator type it, because getting it wrong shifts the whole chain.
 */
function readHssChain(formData: FormData): HssRowInput[] | Error {
  const count = Number(formData.get('hssCount') ?? '0');
  if (!Number.isFinite(count) || count <= 0) return [];

  const rows: HssRowInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = (field: string) => textOrNull(formData, `hss_${i}_${field}`);
    const where = `High-seas seller ${i + 1}`;

    const iec = at('iec');
    const name = at('name');
    if (!iec && !name && !at('address')) continue;

    if (!iec) return new Error(`${where}: the IE Code is missing. ICES looks the party up by it.`);
    const normalised = iec.trim().toUpperCase();
    if (!/^[0-9A-Z]{10}$/.test(normalised)) {
      return new Error(
        `${where}: "${iec}" is not an IE Code — ICES wants exactly ten characters. A GSTIN is ` +
          'fifteen and a PAN is ten but starts with five letters.',
      );
    }

    const branchRaw = at('branchSrNo');
    const branchSrNo = branchRaw ? Number(branchRaw) : null;
    if (branchSrNo !== null && (!Number.isInteger(branchSrNo) || branchSrNo <= 0)) {
      return new Error(`${where}: the branch serial must be a whole number greater than zero.`);
    }

    rows.push({
      // Positional, not typed: rows.length rather than i, so deleting the
      // middle of a chain closes the gap instead of leaving a hole ICES rejects.
      level: rows.length,
      iec: normalised,
      branch_sr_no: branchSrNo,
      name,
      branch_name: at('branchName'),
      ad_code: at('adCode'),
      address: at('address'),
      city: at('city'),
      country: at('country'),
      postal_code: at('postalCode'),
    });
  }
  return rows;
}

interface BondRowInput {
  seq: number;
  kind: 'bond' | 'certificate';
  type: string;
  number: string;
  cert_date: string | null;
  commissionerate: string | null;
  division: string | null;
  range_office: string | null;
  registration_port: string | null;
}

/**
 * The BONDS_CERTIFICATES rows.
 *
 * The two shapes are enforced here as well as in the database, because the
 * message an operator needs is "a bond has no date" rather than a constraint
 * name. See docs/boe-mapping/17-bonds-certificates.md.
 */
function readBonds(formData: FormData): BondRowInput[] | Error {
  const count = Number(formData.get('bondCount') ?? '0');
  if (!Number.isFinite(count) || count <= 0) return [];

  const rows: BondRowInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = (field: string) => textOrNull(formData, `bond_${i}_${field}`);
    const where = `Security ${i + 1}`;

    const number = at('number');
    const type = at('type');
    if (!number && !type) continue;

    const kind = at('kind') === 'certificate' ? 'certificate' : 'bond';
    if (!type) return new Error(`${where}: the ${kind} type is missing.`);
    const code = type.trim().toUpperCase();

    if (kind === 'bond' && !isBondCode(code)) {
      return new Error(
        code === 'EB'
          ? `${where}: an eBond is declared by its purpose code, not by "EB".`
          : `${where}: "${code}" is not an ICES bond code.`,
      );
    }
    if (!number) return new Error(`${where}: the ${kind} number is missing.`);
    if (kind === 'bond' && !/^[0-9]{1,10}$/.test(number.trim())) {
      return new Error(
        `${where}: an ICES bond number is up to ten digits — "${number}" is not one. A certificate ` +
          'number can be anything, so switch the row to a certificate if that is what it is.',
      );
    }

    rows.push({
      seq: rows.length,
      kind,
      type: code,
      number: number.trim(),
      cert_date: kind === 'certificate' ? dateOrNull(formData, `bond_${i}_date`) : null,
      commissionerate: kind === 'certificate' ? at('commissionerate') : null,
      division: kind === 'certificate' ? at('division') : null,
      range_office: kind === 'certificate' ? at('range') : null,
      registration_port: kind === 'bond' ? at('registrationPort') : null,
    });
  }
  return rows;
}

/**
 * Save the high-seas chain and the securities, then re-resolve the draft.
 *
 * Both lists are replaced wholesale rather than merged: `level` and `seq` are
 * positional, and reconciling a reordered list row by row renumbers the wrong
 * ones — the same reason the section 65 finished goods are replaced.
 */
export async function saveSecurities(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const hss = readHssChain(formData);
  if (hss instanceof Error) return { error: hss.message };
  const bonds = readBonds(formData);
  if (bonds instanceof Error) return { error: bonds.message };

  const iins = bonds.filter((b) => b.kind === 'certificate' && b.type === 'EI');
  if (iins.length > 1) {
    return { error: 'ICES accepts exactly one IGCR Identification Number per Bill of Entry.' };
  }

  for (const table of ['job_hss_chain', 'job_bonds_certificates'] as const) {
    const { error } = await db.from(table).delete().eq('job_id', jobId).eq('company_id', ctx.companyId);
    if (error) return { error: error.message };
  }

  if (hss.length) {
    const { error } = await db
      .from('job_hss_chain')
      .insert(hss.map((row) => ({ ...row, company_id: ctx.companyId, job_id: jobId, updated_by: ctx.userId })));
    if (error) return { error: error.message };
  }
  if (bonds.length) {
    const { error } = await db
      .from('job_bonds_certificates')
      .insert(bonds.map((row) => ({ ...row, company_id: ctx.companyId, job_id: jobId, updated_by: ctx.userId })));
    if (error) return { error: error.message };
  }

  await reresolveSecurities(db, ctx.companyId, jobId);

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'boe.securities.saved',
    payload: { hssParties: hss.length, securities: bonds.length },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'High-seas chain and securities saved.' };
}

/**
 * Record the eSanchit reference for one document.
 *
 * The IRN is the only thing on SUPPORTING_DOCS that nothing in this system can
 * derive — ICEGATE generates it when the signed PDF is uploaded. Blanking the
 * field removes the row, which puts the document back in the "waiting" warning.
 */
export async function saveEsanchitReference(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobId = String(formData.get('jobId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const { ctx, db } = await ownedJob(jobId);

  const irn = textOrNull(formData, 'irn')?.replace(/\s+/g, '') ?? null;

  if (!irn) {
    const { error } = await db
      .from('job_document_esanchit')
      .delete()
      .eq('document_id', documentId)
      .eq('company_id', ctx.companyId);
    if (error) return { error: error.message };
    await reresolveSecurities(db, ctx.companyId, jobId);
    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, message: 'eSanchit reference cleared.' };
  }

  if (!/^[0-9]{16}$/.test(irn)) {
    return {
      error:
        `"${irn}" is not an eSanchit IRN. ICEGATE issues sixteen digits — eight for the upload ` +
        'date, then an eight-digit serial.',
    };
  }

  const uploadedAtRaw = textOrNull(formData, 'uploadedAt');
  if (!uploadedAtRaw) {
    return { error: 'The eSanchit upload time is needed as well as the IRN; both go on the row.' };
  }
  const uploadedAt = new Date(uploadedAtRaw);
  if (Number.isNaN(uploadedAt.getTime())) {
    return { error: 'The eSanchit upload time is not a date.' };
  }

  // The IRN carries its own upload date in the first eight digits. A mismatch
  // means one of the two was pasted against the wrong document.
  const stamped = `${uploadedAt.getFullYear()}${String(uploadedAt.getMonth() + 1).padStart(2, '0')}${String(uploadedAt.getDate()).padStart(2, '0')}`;
  if (irn.slice(0, 8) !== stamped) {
    return {
      error:
        `The IRN begins ${irn.slice(0, 8)} but the upload time is ${stamped}. An eSanchit IRN ` +
        'starts with the date it was issued, so one of the two belongs to a different document.',
    };
  }

  const { error } = await db.from('job_document_esanchit').upsert(
    {
      company_id: ctx.companyId,
      job_id: jobId,
      document_id: documentId,
      irn,
      uploaded_at: uploadedAt.toISOString(),
      reference_no: textOrNull(formData, 'referenceNo'),
      issued_at: textOrNull(formData, 'issuedAt'),
      issue_date: dateOrNull(formData, 'issueDate'),
      expiry_date: dateOrNull(formData, 'expiryDate'),
      doc_type_code: textOrNull(formData, 'docTypeCode'),
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'document_id' },
  );
  if (error) return { error: error.message };

  await reresolveSecurities(db, ctx.companyId, jobId);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'eSanchit reference saved.' };
}

/** Re-run the securities resolution over the latest draft, as the panels change it. */
async function reresolveSecurities(
  db: ReturnType<typeof serviceClient>,
  companyId: string,
  jobId: string,
): Promise<void> {
  const { data: latest } = await db
    .from('job_drafts')
    .select('id, draft')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return;

  const resolved = await applySecuritiesResolution({
    draft: latest.draft as unknown as ChecklistDraft,
    companyId,
    jobId,
  });
  await db
    .from('job_drafts')
    .update({ draft: resolved as never })
    .eq('id', latest.id)
    .eq('company_id', companyId);
}
