'use server';

import { revalidatePath } from 'next/cache';
import { END_USE_CODES, eximSchemeCode, iso2, pad8, reImportEntry } from '@checklist/core';
import type { ChecklistDraft, DraftItem, TradeRemedyLine } from '@checklist/extraction';
import {
  ReauthRequiredError,
  ensureAccessToken,
  isConsoleTransport,
  missingScopes,
  sendMailAsUser,
} from '@checklist/graph';
import type { Json } from '@checklist/db';
import { requireCompany } from '@/lib/auth';
import { applyItemResolution, rememberProduct, type OperatorItemFields } from '@/lib/items';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * The items panel's server actions — the ITEMS sheet's operator source
 * (docs/boe-mapping/06-items.md).
 *
 * Kept out of the job's main actions.ts, which six desks already edit.
 */

export interface ItemActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

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

async function latestDraft(db: ReturnType<typeof serviceClient>, companyId: string, jobId: string) {
  const { data } = await db
    .from('job_drafts')
    .select('id, draft')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id, draft: data.draft as unknown as ChecklistDraft } : null;
}

const str = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

/** The value the operator left in a field, or undefined when they left it as it was. */
function changed<T>(next: T | undefined, current: T | undefined): T | undefined {
  if (next === undefined) return undefined;
  return JSON.stringify(next) === JSON.stringify(current) ? undefined : next;
}

/**
 * Save one line. Only what differs from the draft is stored, so a later
 * re-read of a corrected document still reaches the fields nobody touched.
 * "Confirm" also clears the classification blocker and remembers the line in
 * the importer's product master.
 */
export async function saveItem(_prev: ItemActionState, formData: FormData): Promise<ItemActionState> {
  const jobId = str(formData, 'jobId');
  const invoiceSrNo = Number(str(formData, 'invoiceSrNo'));
  const itemSrNo = Number(str(formData, 'itemSrNo'));
  const confirm = str(formData, 'confirm') === 'on';
  const { ctx, db } = await ownedJob(jobId);

  const latest = await latestDraft(db, ctx.companyId, jobId);
  if (!latest) return { error: 'The documents have not been read yet — there is no item to save.' };
  const item = latest.draft.items.find((i) => i.invoiceSrNo === invoiceSrNo && i.slNo === itemSrNo);
  if (!item) return { error: `Item ${invoiceSrNo}/${itemSrNo} is not on the current draft.` };

  // ---- read and check the form ----
  const ritcRaw = str(formData, 'ritc');
  const ritc = ritcRaw ? pad8(ritcRaw) : undefined;
  if (ritcRaw && (!ritc || ritcRaw.replace(/\D/g, '').length !== 8)) return { error: 'The CTH must be 8 digits.' };

  const endUseCode = str(formData, 'endUseCode').toUpperCase();
  if (endUseCode && !END_USE_CODES[endUseCode]) return { error: `${endUseCode} is not an ICES end-use code.` };

  const originRaw = str(formData, 'originCountry');
  const originCountry = originRaw ? iso2(originRaw) : undefined;
  if (originRaw && !originCountry) return { error: `"${originRaw}" is not a country we can code.` };

  const eximRaw = str(formData, 'eximCode');
  const eximCode = eximRaw ? eximSchemeCode(eximRaw) : undefined;
  if (eximRaw && !eximCode) return { error: `"${eximRaw}" is not a known Exim scheme code.` };

  const accessoryStatus = str(formData, 'accessoryStatus') as '' | '0' | '1' | '2';
  const accessoriesDetails = str(formData, 'accessoriesDetails');
  if (accessoryStatus === '1' && !accessoriesDetails) {
    return { error: 'Describe the accessories supplied with the item.' };
  }

  const ftaChoice = str(formData, 'fta'); // '' keep | 'none' drop the claim
  const remedyChoice = str(formData, 'tradeRemedy'); // '' keep | 'none' | candidate index

  const fields: OperatorItemFields = {};
  const set = <K extends keyof OperatorItemFields>(key: K, value: OperatorItemFields[K] | undefined) => {
    const diff = changed(value, item[key as keyof DraftItem] as OperatorItemFields[K]);
    if (diff !== undefined) fields[key] = diff;
  };
  set('ritc', ritc);
  set('generalDescription', str(formData, 'generalDescription') || undefined);
  set('brand', str(formData, 'brand') || undefined);
  set('model', str(formData, 'model') || undefined);
  set('endUseCode', endUseCode || undefined);
  set('originCountry', originCountry);
  set('manufacturerName', str(formData, 'manufacturerName') || undefined);
  set('manufacturerAddress', str(formData, 'manufacturerAddress') || undefined);
  if (eximCode) {
    set('eximScheme', {
      code: eximCode,
      ...(str(formData, 'eximNotn') && { notification: str(formData, 'eximNotn') }),
      ...(str(formData, 'eximSerial') && { serial: str(formData, 'eximSerial') }),
      ...(str(formData, 'policyPara') && { policyPara: str(formData, 'policyPara') }),
      ...(str(formData, 'policyYear') && { policyYear: str(formData, 'policyYear') }),
    });
  }
  if (accessoryStatus) set('accessoryStatus', accessoryStatus);
  if (accessoriesDetails) set('accessoriesDetails', accessoriesDetails);
  set('foc', str(formData, 'foc') === 'on' ? true : item.foc ? false : undefined);

  const previousBe = {
    ...(str(formData, 'prevBeNo') && { beNo: str(formData, 'prevBeNo') }),
    ...(str(formData, 'prevBeDate') && { beDate: str(formData, 'prevBeDate') }),
    ...(str(formData, 'prevCustomHouse') && { customHouse: str(formData, 'prevCustomHouse') }),
    ...(str(formData, 'prevCurrency') && { currency: str(formData, 'prevCurrency').toUpperCase() }),
    ...(Number(str(formData, 'prevUnitPrice')) > 0 && { unitPrice: Number(str(formData, 'prevUnitPrice')) }),
  };
  if (Object.keys(previousBe).length) set('previousBe', previousBe);

  if (ftaChoice === 'none' && item.fta) (fields as Record<string, unknown>).fta = null;
  // The operator has looked at the certificate itself: the retroactive box
  // and the stamp are on paper, and a misread date should not hold the job.
  if ((ftaChoice === 'retro-N' || ftaChoice === 'retro-Y') && item.fta) {
    fields.fta = {
      ...item.fta,
      retroactiveIssuance: ftaChoice === 'retro-Y',
      retroactiveCheck: { compliant: true, reason: `Retroactive issuance confirmed as ${ftaChoice === 'retro-Y' ? 'Yes' : 'No'} by the operator against the certificate.` },
    };
  }

  if (remedyChoice === 'none') {
    (fields as Record<string, unknown>).tradeRemedies = null;
  } else if (remedyChoice !== '' && item.tradeRemedyCandidates) {
    const picked = item.tradeRemedyCandidates[Number(remedyChoice)];
    if (!picked) return { error: 'That trade-remedy row is no longer a candidate.' };
    const line: TradeRemedyLine = picked.line ?? {
      kind: picked.kind,
      notification: picked.notification,
      ...(picked.cthSerial && { cthSerial: picked.cthSerial }),
      ...(picked.supplierSerial && { supplierSerial: picked.supplierSerial }),
    };
    fields.tradeRemedies = [...(item.tradeRemedies ?? []).filter((l) => l.kind !== picked.kind), line];
  }

  // ---- re-import ----
  // The entry is chosen here and nowhere else. `reImportEntry` is the form's
  // "NNN/YYYY serial" value; an empty one leaves the claim unconfirmed, which
  // is what the exporter refuses on.
  const reImportChoice = str(formData, 'reImportEntry');
  const reImportPatch: Record<string, unknown> = {};
  if (item.reImport) {
    if (reImportChoice) {
      const [notification, serial] = reImportChoice.split(/\s+/);
      if (!notification || !serial) return { error: 'That is not a re-import notification entry.' };
      if (!reImportEntry(notification, serial)) {
        return {
          error: `${reImportChoice} is not an entry of any re-import notification. ICES rejects the pair (error 352).`,
        };
      }
      reImportPatch.notification = {
        value: { notification, serial },
        source: 'operator',
        because: 'Chosen against the shipping bill on the job screen.',
      };
    }
    // The export leg's freight and insurance are rupees, apportioned to this
    // line — not the inbound figures, which are INVOICES' business.
    const amount = (field: string, key: string) => {
      const raw = str(formData, field);
      if (raw === '') return;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return;
      reImportPatch[key] = { value, source: 'operator' };
    };
    amount('reImportExportFreight', 'exportFreightInr');
    amount('reImportExportInsurance', 'exportInsuranceInr');
    amount('reImportCustomsDuty', 'customsDuty');
    amount('reImportExciseDuty', 'exciseDuty');
    amount('reImportIgstPaid', 'igstPaid');
  }

  // ---- merge with what the operator saved before ----
  const { data: existing } = await db
    .from('job_items')
    .select('fields, classification_confirmed, re_import')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .eq('invoice_sr_no', invoiceSrNo)
    .eq('item_sr_no', itemSrNo)
    .maybeSingle();

  const merged = { ...((existing?.fields as Record<string, unknown> | null) ?? {}), ...fields };
  const mergedReImport = Object.keys(reImportPatch).length
    ? { ...((existing?.re_import as Record<string, unknown> | null) ?? {}), ...reImportPatch }
    : ((existing?.re_import as Record<string, unknown> | null) ?? null);
  const { error } = await db.from('job_items').upsert(
    {
      company_id: ctx.companyId,
      job_id: jobId,
      invoice_sr_no: invoiceSrNo,
      item_sr_no: itemSrNo,
      fields: merged as unknown as Json,
      classification_confirmed: confirm || (existing?.classification_confirmed ?? false),
      ...(mergedReImport ? { re_import: mergedReImport as unknown as Json } : {}),
      // Confirming the entry is what clears the export's blocker, so it is set
      // by choosing one and never by saving the rest of the line.
      ...(reImportPatch.notification ? { re_import_confirmed: true } : {}),
      updated_by: ctx.userId,
    },
    { onConflict: 'job_id,invoice_sr_no,item_sr_no' },
  );
  if (error) return { error: error.message };

  // ---- re-resolve the stored draft, so the export sees it at once ----
  const resolved = await applyItemResolution(latest.draft, ctx.companyId, jobId);
  await db
    .from('job_drafts')
    .update({ draft: resolved as never })
    .eq('id', latest.id)
    .eq('company_id', ctx.companyId);

  let remembered = '';
  if (confirm) {
    const importerOrgId = resolved.importer.organizationId;
    const confirmed = resolved.items.find((i) => i.invoiceSrNo === invoiceSrNo && i.slNo === itemSrNo);
    if (!importerOrgId) {
      remembered = ' Not remembered: bind the importer to the organization repository first.';
    } else if (confirmed) {
      const out = await rememberProduct({
        companyId: ctx.companyId,
        importerOrgId,
        jobId,
        userId: ctx.userId,
        item: confirmed,
      });
      remembered = out.error ? ` Could not remember it: ${out.error}` : ' Remembered for this importer.';
    }
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'boe.item.saved',
    payload: { invoiceSrNo, itemSrNo, fields: merged as unknown as Json, confirmed: confirm },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `Item ${invoiceSrNo}/${itemSrNo} saved.${remembered}` };
}

/**
 * Ask the importer whether to take a preferential rate the documents did not
 * claim — the customer's rule when there is no certificate of origin. Sent
 * from the operator's own mailbox, as a reply on the job's thread.
 */
export async function sendFtaBenefitQuestion(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const jobId = str(formData, 'jobId');
  const to = str(formData, 'to').toLowerCase();
  const subject = str(formData, 'subject');
  const body = str(formData, 'body');
  const { ctx, db } = await ownedJob(jobId);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: 'Enter a valid address for the importer.' };
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
      attachments: [],
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await db.from('mail_connections').update({ status: 'needs_reauth', last_error: err.message }).eq('id', connection.id);
      return { error: 'Microsoft rejected the request. Reconnect your mailbox and try again.' };
    }
    return { error: err instanceof Error ? err.message : 'Could not send the email.' };
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'boe.fta_benefit.asked',
    payload: { to, subject, body },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: 'Sent. The answer will be read off the thread on the next reading.' };
}
