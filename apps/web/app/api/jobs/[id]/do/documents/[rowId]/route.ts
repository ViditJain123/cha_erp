import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { MAX_UPLOAD_BYTES, safeFileName, sniffMime } from '@/lib/upload';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * A document the shipping line asked for, filed against the row it settles.
 *
 * The same shape as the compliance-request upload: sniff what the file really
 * is, reuse an identical copy already on the job rather than storing the bytes
 * twice, then settle the row so there is no separate "mark it received" step to
 * forget.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> },
) {
  const ctx = await requireCompany();
  const { id, rowId } = await params;
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

  const { data: row } = await db
    .from('job_do_documents')
    .select('id, name')
    .eq('id', rowId)
    .eq('job_id', job.id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'No such document.' }, { status: 404 });

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
      // The DO papers are letters, undertakings and authorisations the
      // classifier has no type for. Guessing one would put them in front of
      // scrutiny as though they were trade documents.
      doc_type: 'unknown',
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
    .from('job_do_documents')
    .update({
      status: 'received',
      document_id: documentId,
      resolved_by: ctx.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('company_id', ctx.companyId);
  if (settleError) return NextResponse.json({ error: settleError.message }, { status: 500 });

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: job.id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'do.document_settled',
    payload: {
      requestName: row.name,
      fileName: file.name,
      sizeBytes: data.byteLength,
      reusedExisting: Boolean(duplicate),
    },
  });

  return NextResponse.json({ ok: true, documentId, reusedExisting: Boolean(duplicate) });
}
