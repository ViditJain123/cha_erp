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

/** A batch of documents handed over by a person rather than arriving by mail. */
export interface UploadBatch {
  companyId: string;
  /** The profile dropping the files. Recorded on every row it creates. */
  uploadedBy: string | null;
  files: IncomingAttachment[];
}

export type UploadOutcome = 'created_job' | 'attached' | 'ambiguous';

/** What one dropped file turned out to be, so the drop zone can show it back. */
export interface UploadedFileResult {
  fileName: string;
  docType: DocumentType;
  /** True when these exact bytes were already on a job and were not stored again. */
  duplicate: boolean;
}

export interface UploadResult {
  outcome: UploadOutcome;
  /** Absent only when the outcome is `ambiguous` — nothing was written then. */
  jobId?: string;
  created: boolean;
  matchScore?: number;
  matchedOn?: { kind: Identifier['kind']; value: string }[];
  documentsAdded: number;
  documentsDuplicate: number;
  files: UploadedFileResult[];
  /** The jobs the documents matched equally well, when the call was too close. */
  candidateJobIds?: string[];
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

async function triageAll(attachments: IncomingAttachment[]): Promise<TriagedFile[]> {
  return Promise.all(
    attachments.map(async (attachment): Promise<TriagedFile> => {
      try {
        const triage = await triageDocument(
          attachment.fileName,
          attachment.data,
          attachment.contentType,
        );
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

/**
 * The documents already holding these exact bytes, keyed by digest.
 *
 * `job_documents` is unique on (company_id, sha256), so this is both the
 * duplicate check and — for a hand-dropped batch — a second way of telling
 * which job the files belong to.
 */
async function findByDigest(
  db: Db,
  companyId: string,
  digests: string[],
): Promise<Map<string, { id: string; jobId: string }>> {
  const found = new Map<string, { id: string; jobId: string }>();
  if (digests.length === 0) return found;

  const { data } = await db
    .from('job_documents')
    .select('id, job_id, sha256')
    .eq('company_id', companyId)
    .in('sha256', [...new Set(digests)]);

  for (const row of data ?? []) found.set(row.sha256, { id: row.id, jobId: row.job_id });
  return found;
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

function jobTitle(files: TriagedFile[], fallback: string | null): string {
  const invoice = files.flatMap((f) => f.identifiers).find((i) => i.kind === 'invoice');
  const transport = files.flatMap((f) => f.identifiers).find((i) => i.kind === 'bl' || i.kind === 'awb');
  if (transport) return `${transport.kind.toUpperCase()} ${transport.raw}`;
  if (invoice) return `Invoice ${invoice.raw}`;
  return fallback?.slice(0, 120) ?? 'Untitled job';
}

interface StoreOptions {
  companyId: string;
  jobId: string;
  files: TriagedFile[];
  source: 'email' | 'upload';
  mailMessageId?: string | null;
  uploadedBy?: string | null;
  /** Digests already in the company, mutated as this batch stores its own. */
  seen: Map<string, { id: string; jobId: string }>;
}

/**
 * Puts each new document in storage and records it against the job.
 *
 * Shared by the mail watcher and the manual drop zone so both end in exactly
 * the same rows — only `source` and who to credit differ.
 */
async function storeDocuments(db: Db, opts: StoreOptions) {
  let added = 0;
  let duplicate = 0;
  const results: UploadedFileResult[] = [];

  for (const file of opts.files) {
    // The same document resent across several emails — or dropped twice in one
    // batch — should not pile up.
    if (opts.seen.has(file.sha256)) {
      duplicate++;
      results.push({ fileName: file.attachment.fileName, docType: file.docType, duplicate: true });
      continue;
    }

    const documentId = crypto.randomUUID();
    const path = storagePath(opts.companyId, opts.jobId, documentId, file.attachment.fileName);

    const { error: uploadError } = await db.storage
      .from('job-documents')
      .upload(path, file.attachment.data, {
        contentType: file.attachment.contentType,
        upsert: false,
      });
    if (uploadError) throw new Error(`Could not store ${file.attachment.fileName}: ${uploadError.message}`);

    const { error: rowError } = await db.from('job_documents').insert({
      id: documentId,
      company_id: opts.companyId,
      job_id: opts.jobId,
      mail_message_id: opts.mailMessageId ?? null,
      doc_type: file.docType,
      file_name: file.attachment.fileName,
      storage_path: path,
      mime_type: file.attachment.contentType,
      size_bytes: file.attachment.data.byteLength,
      sha256: file.sha256,
      classification: file.classification as never,
      classified_at: new Date().toISOString(),
      source: opts.source,
      uploaded_by: opts.uploadedBy ?? null,
    });
    if (rowError) throw new Error(`Could not record ${file.attachment.fileName}: ${rowError.message}`);

    opts.seen.set(file.sha256, { id: documentId, jobId: opts.jobId });
    added++;
    results.push({ fileName: file.attachment.fileName, docType: file.docType, duplicate: false });
  }

  return { added, duplicate, results };
}

/**
 * Folds what a fresh batch of documents says into a job that already existed.
 *
 * A later document — often the invoice — can carry HS codes the first batch did
 * not, so the codes merge rather than replace.
 */
async function refreshJobFromDocuments(db: Db, companyId: string, jobId: string, files: TriagedFile[]) {
  const { data: existingJob } = await db
    .from('jobs')
    .select('hs_codes')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle();

  const merged = [...new Set([...(existingJob?.hs_codes ?? []), ...collectHsCodes(files)])];

  await db
    .from('jobs')
    .update({ hs_codes: merged, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', companyId);

  await db
    .from('jobs')
    .update({ stage: 'documents_received', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('company_id', companyId)
    // Do not drag a job that has moved on back to an earlier stage.
    .in('stage', ['new', 'documents_received']);
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

  const files = await triageAll(message.attachments);

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

  await recordIdentifiers(db, message.companyId, jobId, identifiers);

  const { added, duplicate } = await storeDocuments(db, {
    companyId: message.companyId,
    jobId,
    files,
    source: 'email',
    mailMessageId: message.mailMessageId,
    seen: await findByDigest(db, message.companyId, files.map((f) => f.sha256)),
  });

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
    await refreshJobFromDocuments(db, message.companyId, jobId, files);
  }

  return {
    outcome: created ? 'created_job' : 'attached',
    jobId,
    matchScore: match.score,
    documentsAdded: added,
    documentsDuplicate: duplicate,
  };
}

/**
 * Identifiers are unique per (company, kind, value): a conflict means another
 * job already owns it, which is the same signal the matcher uses. Ignore it
 * rather than failing the whole batch.
 */
async function recordIdentifiers(db: Db, companyId: string, jobId: string, identifiers: Identifier[]) {
  if (identifiers.length === 0) return;
  await db.from('job_identifiers').upsert(
    identifiers.map((i) => ({
      company_id: companyId,
      job_id: jobId,
      kind: i.kind,
      value: i.value,
      value_raw: i.raw,
    })),
    { onConflict: 'company_id,kind,value', ignoreDuplicates: true },
  );
}

/**
 * Opens a job from documents dropped in by hand.
 *
 * The same triage, matching and storage as the mail path, with one deliberate
 * difference: a person dropping files has *said* they want a job, so a batch
 * whose documents are all unrecognised still opens one instead of being
 * skipped. Matching is kept because it is not optional — `job_identifiers` is
 * unique per company, so a second job over the same B/L would silently end up
 * with no identifiers at all and never match another email again.
 *
 * Ambiguity is still handed back to the person rather than guessed at, for the
 * same reason the mail path refuses it: merging two shipments cannot be undone.
 */
export async function processUpload(db: Db, batch: UploadBatch): Promise<UploadResult> {
  if (batch.files.length === 0) throw new Error('Drop at least one document.');

  const files = await triageAll(batch.files);
  const identifiers = dedupeIdentifiers(files.flatMap((f) => f.identifiers));
  const seen = await findByDigest(db, batch.companyId, files.map((f) => f.sha256));
  const readBack = files.map((f) => ({
    fileName: f.attachment.fileName,
    docType: f.docType,
    duplicate: seen.has(f.sha256),
  }));

  const match = scoreMatches(identifiers, await findCandidates(db, batch.companyId, identifiers));

  if (match.decision === 'ambiguous') {
    await db.from('job_events').insert({
      company_id: batch.companyId,
      job_id: null,
      actor_kind: 'user',
      actor_user_id: batch.uploadedBy,
      type: 'upload.ambiguous',
      payload: {
        fileNames: files.map((f) => f.attachment.fileName),
        candidates: match.tiedJobIds,
        score: match.score,
      },
    });
    return {
      outcome: 'ambiguous',
      created: false,
      matchScore: match.score,
      documentsAdded: 0,
      documentsDuplicate: 0,
      files: readBack,
      candidateJobIds: match.tiedJobIds,
    };
  }

  let jobId = match.jobId;

  // Nothing matched on identifiers, but every file is already stored. Dropping
  // the same folder twice must land back on the job it made the first time
  // rather than opening an empty one beside it. Compared over distinct digests,
  // not the file count: a batch holding the same document under two names would
  // otherwise fall through and open a job with nothing in it.
  const digests = new Set(files.map((f) => f.sha256));
  if (!jobId && seen.size === digests.size) {
    const owners = [...new Set([...seen.values()].map((d) => d.jobId))];
    if (owners.length === 1) {
      jobId = owners[0] as string;
    } else if (owners.length > 1) {
      return {
        outcome: 'ambiguous',
        created: false,
        documentsAdded: 0,
        documentsDuplicate: files.length,
        files: readBack,
        candidateJobIds: owners,
      } satisfies UploadResult;
    }
  }

  const created = !jobId;

  if (!jobId) {
    const { data: job, error } = await db
      .from('jobs')
      .insert({
        company_id: batch.companyId,
        title: jobTitle(files, files[0]?.attachment.fileName ?? null),
        stage: 'documents_received',
        source: 'manual',
        created_by: batch.uploadedBy,
        importer_name: files.find((f) => f.importerName)?.importerName ?? null,
        supplier_name: files.find((f) => f.supplierName)?.supplierName ?? null,
        hs_codes: collectHsCodes(files),
      })
      .select('id')
      .single();
    if (error || !job) throw new Error(`Could not create a job: ${error?.message}`);
    jobId = job.id;
  }

  await recordIdentifiers(db, batch.companyId, jobId, identifiers);

  const { added, duplicate, results } = await storeDocuments(db, {
    companyId: batch.companyId,
    jobId,
    files,
    source: 'upload',
    uploadedBy: batch.uploadedBy,
    seen,
  });

  await db.from('job_events').insert({
    company_id: batch.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: batch.uploadedBy,
    type: created ? 'job.created_from_upload' : 'upload.attached',
    payload: {
      fileNames: files.map((f) => f.attachment.fileName),
      documentsAdded: added,
      documentsDuplicate: duplicate,
      matchScore: match.score ?? null,
      matchedOn: match.matched ?? null,
      documentTypes: files.map((f) => f.docType),
    },
  });

  if (!created && added > 0) {
    await refreshJobFromDocuments(db, batch.companyId, jobId, files);
  }

  return {
    outcome: created ? 'created_job' : 'attached',
    jobId,
    created,
    matchScore: match.score,
    matchedOn: match.matched,
    documentsAdded: added,
    documentsDuplicate: duplicate,
    files: results,
  };
}
