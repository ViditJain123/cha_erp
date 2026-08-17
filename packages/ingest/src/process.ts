import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@checklist/db';
import { normaliseHsCode } from './hs.js';
import { scoreMatches, type CandidateIdentifier } from './match.js';
import { dedupeIdentifiers, makeIdentifier, type Identifier } from './normalise.js';
import { TRADE_DOCUMENT_TYPES, triageDocument, type DocumentType } from './triage.js';

type Db = SupabaseClient<Database>;

export interface IncomingAttachment {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface IncomingMessage {
  companyId: string;
  connectionId: string;
  mailMessageId: string;
  conversationId: string | null;
  subject: string | null;
  fromAddress: string | null;
  attachments: IncomingAttachment[];
}

export type ProcessOutcome = Database['public']['Enums']['mail_outcome'];

export interface ProcessResult {
  outcome: ProcessOutcome;
  jobId?: string;
  skipReason?: string;
  matchScore?: number;
  documentsAdded: number;
  documentsDuplicate: number;
}

interface TriagedFile {
  attachment: IncomingAttachment;
  docType: DocumentType;
  sha256: string;
  identifiers: Identifier[];
  importerName: string | null;
  supplierName: string | null;
  hsCodes: string[];
  classification: unknown;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Object keys start with company_id so the storage RLS prefix rule applies. */
function storagePath(companyId: string, jobId: string, documentId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
  return `${companyId}/${jobId}/${documentId}-${safe}`;
}

async function triageAll(message: IncomingMessage): Promise<TriagedFile[]> {
  return Promise.all(
    message.attachments.map(async (attachment): Promise<TriagedFile> => {
      try {
        const triage = await triageDocument(attachment.fileName, attachment.data);
        const identifiers = dedupeIdentifiers(
          [
            makeIdentifier('bl', triage.blNumber),
            makeIdentifier('awb', triage.awbNumber),
            makeIdentifier('invoice', triage.invoiceNumber),
            makeIdentifier('po', triage.poNumber),
            ...triage.containerNumbers.map((c) => makeIdentifier('container', c)),
          ].filter((x): x is Identifier => x !== null),
        );
        return {
          attachment,
          docType: triage.docType as DocumentType,
          sha256: sha256(attachment.data),
          identifiers,
          importerName: triage.importerName,
          supplierName: triage.supplierName,
          hsCodes: triage.hsCodes,
          // Everything scrutiny will need later, captured while the PDF is
          // already in front of the model. It is never uploaded again.
          classification: {
            docType: triage.docType,
            reason: triage.reason,
            model: triage.model,
            summary: triage.summary,
            goodsDescription: triage.goodsDescription,
            hsCodes: triage.hsCodes,
            // Read here so the delivery order desk can seed itself without the
            // document ever going back to a model.
            blSurrenderIndication: triage.blSurrenderIndication,
            detentionFreeDays: triage.detentionFreeDays,
            shippingLine: triage.shippingLine,
            containerMode: triage.containerMode,
          },
        };
      } catch (err) {
        // One unreadable attachment must not sink the whole email; the rest may
        // still be enough to identify the shipment.
        return {
          attachment,
          docType: 'unknown',
          sha256: sha256(attachment.data),
          identifiers: [],
          importerName: null,
          supplierName: null,
          hsCodes: [],
          classification: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }),
  );
}

/** Looks up every job in this company already carrying one of these identifiers. */
async function findCandidates(
  db: Db,
  companyId: string,
  identifiers: Identifier[],
): Promise<CandidateIdentifier[]> {
  if (identifiers.length === 0) return [];

  const byKind = new Map<string, string[]>();
  for (const identifier of identifiers) {
    byKind.set(identifier.kind, [...(byKind.get(identifier.kind) ?? []), identifier.value]);
  }

  const results = await Promise.all(
    [...byKind.entries()].map(async ([kind, values]) => {
      const { data } = await db
        .from('job_identifiers')
        .select('job_id, kind, value')
        .eq('company_id', companyId)
        .eq('kind', kind as Identifier['kind'])
        .in('value', values);
      return data ?? [];
    }),
  );

  return results.flat() as CandidateIdentifier[];
}

/** Every valid HS code across a message's attachments, deduplicated. */
function collectHsCodes(files: TriagedFile[]): string[] {
  const codes = new Set<string>();
  for (const file of files) {
    for (const raw of file.hsCodes) {
      const code = normaliseHsCode(raw);
      if (code) codes.add(code);
    }
  }
  return [...codes];
}

function jobTitle(files: TriagedFile[], subject: string | null): string {
  const invoice = files.flatMap((f) => f.identifiers).find((i) => i.kind === 'invoice');
  const transport = files.flatMap((f) => f.identifiers).find((i) => i.kind === 'bl' || i.kind === 'awb');
  if (transport) return `${transport.kind.toUpperCase()} ${transport.raw}`;
  if (invoice) return `Invoice ${invoice.raw}`;
  return subject?.slice(0, 120) ?? 'Untitled job';
}

/**
 * Classifies an email's attachments and either attaches them to the job they
 * belong to, opens a new job, or skips the message.
 *
 * Every decision — including skips — is recorded on `mail_messages` and in
 * `job_events`, so a mis-match can be diagnosed after the fact rather than
 * vanishing.
 */
export async function processMessage(db: Db, message: IncomingMessage): Promise<ProcessResult> {
  if (message.attachments.length === 0) {
    return { outcome: 'skipped', skipReason: 'no_attachments', documentsAdded: 0, documentsDuplicate: 0 };
  }

  const files = await triageAll(message);

  const identifiers = dedupeIdentifiers([
    ...files.flatMap((f) => f.identifiers),
    ...(message.conversationId
      ? [makeIdentifier('conversation', message.conversationId)].filter(
          (x): x is Identifier => x !== null,
        )
      : []),
  ]);

  const recognised = files.filter((f) => TRADE_DOCUMENT_TYPES.includes(f.docType));
  const match = scoreMatches(identifiers, await findCandidates(db, message.companyId, identifiers));

  if (match.decision === 'ambiguous') {
    // Guessing here silently merges two shipments, which cannot be undone from
    // the audit trail. A human decides.
    await db.from('job_events').insert({
      company_id: message.companyId,
      job_id: null,
      actor_kind: 'worker',
      type: 'mail.ambiguous',
      payload: { mailMessageId: message.mailMessageId, candidates: match.tiedJobIds, score: match.score },
    });
    return {
      outcome: 'skipped',
      skipReason: 'ambiguous_match',
      matchScore: match.score,
      documentsAdded: 0,
      documentsDuplicate: 0,
    };
  }

  if (match.decision === 'none' && recognised.length === 0) {
    return {
      outcome: 'skipped',
      skipReason: 'no_recognised_documents',
      documentsAdded: 0,
      documentsDuplicate: 0,
    };
  }

  let jobId = match.jobId;
  const created = !jobId;

  if (!jobId) {
    const { data: job, error } = await db
      .from('jobs')
      .insert({
        company_id: message.companyId,
        title: jobTitle(files, message.subject),
        stage: 'documents_received',
        source: 'email',
        importer_name: files.find((f) => f.importerName)?.importerName ?? null,
        supplier_name: files.find((f) => f.supplierName)?.supplierName ?? null,
        hs_codes: collectHsCodes(files),
      })
      .select('id')
      .single();
    if (error || !job) throw new Error(`Could not create a job: ${error?.message}`);
    jobId = job.id;
  }

  // Identifiers are unique per (company, kind, value): a conflict means another
  // job already owns it, which is the same signal the matcher uses. Ignore it
  // rather than failing the whole message.
  if (identifiers.length > 0) {
    await db.from('job_identifiers').upsert(
      identifiers.map((i) => ({
        company_id: message.companyId,
        job_id: jobId as string,
        kind: i.kind,
        value: i.value,
        value_raw: i.raw,
      })),
      { onConflict: 'company_id,kind,value', ignoreDuplicates: true },
    );
  }

  let added = 0;
  let duplicate = 0;

  for (const file of files) {
    // The same document resent across several emails should not pile up.
    const { data: existing } = await db
      .from('job_documents')
      .select('id')
      .eq('company_id', message.companyId)
      .eq('sha256', file.sha256)
      .maybeSingle();
    if (existing) {
      duplicate++;
      continue;
    }

    const documentId = crypto.randomUUID();
    const path = storagePath(message.companyId, jobId, documentId, file.attachment.fileName);

    const { error: uploadError } = await db.storage
      .from('job-documents')
      .upload(path, file.attachment.data, {
        contentType: file.attachment.contentType,
        upsert: false,
      });
    if (uploadError) throw new Error(`Could not store ${file.attachment.fileName}: ${uploadError.message}`);

    const { error: rowError } = await db.from('job_documents').insert({
      id: documentId,
      company_id: message.companyId,
      job_id: jobId,
      mail_message_id: message.mailMessageId,
      doc_type: file.docType,
      file_name: file.attachment.fileName,
      storage_path: path,
      mime_type: file.attachment.contentType,
      size_bytes: file.attachment.data.byteLength,
      sha256: file.sha256,
      classification: file.classification as never,
      classified_at: new Date().toISOString(),
      source: 'email',
    });
    if (rowError) throw new Error(`Could not record ${file.attachment.fileName}: ${rowError.message}`);
    added++;
  }

  await db.from('job_events').insert({
    company_id: message.companyId,
    job_id: jobId,
    actor_kind: 'worker',
    type: created ? 'job.created_from_mail' : 'mail.attached',
    payload: {
      mailMessageId: message.mailMessageId,
      subject: message.subject,
      from: message.fromAddress,
      documentsAdded: added,
      documentsDuplicate: duplicate,
      matchScore: match.score ?? null,
      matchedOn: match.matched ?? null,
      documentTypes: files.map((f) => f.docType),
    },
  });

  if (!created && added > 0) {
    // A later document — often the invoice — can carry HS codes the first mail
    // did not, so merge rather than replace.
    const { data: existingJob } = await db
      .from('jobs')
      .select('hs_codes')
      .eq('id', jobId)
      .eq('company_id', message.companyId)
      .maybeSingle();

    const merged = [...new Set([...(existingJob?.hs_codes ?? []), ...collectHsCodes(files)])];

    await db
      .from('jobs')
      .update({ hs_codes: merged, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('company_id', message.companyId);

    await db
      .from('jobs')
      .update({ stage: 'documents_received', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('company_id', message.companyId)
      // Do not drag a job that has moved on back to an earlier stage.
      .in('stage', ['new', 'documents_received']);
  }

  return {
    outcome: created ? 'created_job' : 'attached',
    jobId,
    matchScore: match.score,
    documentsAdded: added,
    documentsDuplicate: duplicate,
  };
}
