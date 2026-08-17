import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { MAX_UPLOAD_BYTES, safeFileName, sniffMime } from '@/lib/upload';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * A document the shipper sent outside the mailbox — handed over on WhatsApp, or
 * scanned at the desk — attached straight to the request it settles.
 *
 * The mail path fills these in automatically when a reply lands on the thread.
 * This is the same thing done by hand, so it ends in the same state: a row in
 * job_documents, and the request marked received against it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const ctx = await requireCompany();
  const { id, requestId } = await params;
  const db = serviceClient();

  // Both scoped by company: the service role bypasses RLS, so a guessed uuid
  // would otherwise cross tenants.
  const { data: job } = await db
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });

  const { data: docRequest } = await db
    .from('job_document_requests')
    .select('id, name')
    .eq('id', requestId)
    .eq('job_id', job.id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!docRequest) return NextResponse.json({ error: 'No such request.' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a file.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 25 MB.' }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffMime(data, file.name);
  if (!mimeType) {
    return NextResponse.json(
      { error: 'Upload a PDF, an image, or a Word or Excel document.' },
      { status: 400 },
    );
  }

  const sha256 = createHash('sha256').update(data).digest('hex');
  const { data: duplicate } = await db
    .from('job_documents')
    .select('id')
    .eq('company_id', ctx.companyId)
    .eq('sha256', sha256)
    .maybeSingle();

  // Already on the job — settle the request against the copy that is there
  // rather than storing the same bytes twice.
  let documentId = duplicate?.id ?? null;

  if (!documentId) {
    documentId = crypto.randomUUID();
    const safeName = safeFileName(file.name);
    const path = `${ctx.companyId}/${job.id}/${documentId}-${safeName}`;

    const { error: uploadError } = await db.storage
      .from('job-documents')
      .upload(path, data, { contentType: mimeType, upsert: false });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    const { error: rowError } = await db.from('job_documents').insert({
      id: documentId,
      company_id: ctx.companyId,
      job_id: job.id,
      doc_type: docTypeFor(docRequest.name),
      file_name: safeName,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: data.byteLength,
      sha256,
      source: 'upload',
      uploaded_by: ctx.userId,
    });
    if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  const { error: settleError } = await db
    .from('job_document_requests')
    .update({
      status: 'received',
      received_document_id: documentId,
      resolved_by: ctx.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', docRequest.id)
    .eq('company_id', ctx.companyId);
  if (settleError) return NextResponse.json({ error: settleError.message }, { status: 500 });

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: job.id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'request.document_uploaded',
    payload: {
      requestName: docRequest.name,
      fileName: file.name,
      sizeBytes: data.byteLength,
      reusedExisting: Boolean(duplicate),
    },
  });

  return NextResponse.json({ ok: true, documentId, reusedExisting: Boolean(duplicate) });
}

/**
 * Best-effort type from what was asked for. The request name is written by the
 * assessment in a shipper's vocabulary ("FSSAI import licence"), which is close
 * enough to sort the common cases; anything else stays `unknown` rather than
 * being guessed at.
 */
function docTypeFor(requestName: string) {
  const name = requestName.toLowerCase();
  if (/licen[cs]e|registration|permit|authorisation/.test(name)) return 'license' as const;
  if (/analysis|test report|coa\b/.test(name)) return 'certificate_of_analysis' as const;
  if (/origin/.test(name)) return 'certificate_of_origin' as const;
  if (/packing/.test(name)) return 'packing_list' as const;
  if (/invoice/.test(name)) return 'invoice' as const;
  return 'unknown' as const;
}
