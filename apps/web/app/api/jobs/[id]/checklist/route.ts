import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Uploads the checklist PDF that came back from Logi-Sys, together with the
 * details Logi-Sys assigned it.
 *
 * This is the handover between the two branches: documents ends here and
 * scrutiny begins, so branch, job number and ETA are required alongside the
 * file. A revision (the job is already past scrutiny) keeps the existing
 * details and only adds the new PDF.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  const { data: job } = await db
    .from('jobs')
    .select('id, stage, branch_id, job_number, eta')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Attach the checklist PDF.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 25 MB.' }, { status: 400 });
  }

  // A revision re-uses whatever was recorded the first time round.
  const isRevision = job.branch_id !== null && job.job_number !== null;

  const branchId = String(form.get('branchId') ?? '').trim();
  const jobNumber = String(form.get('jobNumber') ?? '').trim();
  const eta = String(form.get('eta') ?? '').trim();

  if (!isRevision) {
    if (!branchId) return NextResponse.json({ error: 'Choose the branch.' }, { status: 400 });
    if (!jobNumber) return NextResponse.json({ error: 'Enter the job number.' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eta)) {
      return NextResponse.json({ error: 'Enter the ETA.' }, { status: 400 });
    }

    // The branch must belong to this company; the service role would not care.
    const { data: branch } = await db
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (!branch) return NextResponse.json({ error: 'Unknown branch.' }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());

  // Check the magic bytes, not the declared content type — the latter is set by
  // the client and can say anything.
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: 'That file is not a PDF.' }, { status: 400 });
  }

  const sha256 = createHash('sha256').update(data).digest('hex');
  const { data: duplicate } = await db
    .from('job_documents')
    .select('id')
    .eq('company_id', ctx.companyId)
    .eq('sha256', sha256)
    .maybeSingle();
  if (duplicate) {
    return NextResponse.json({ error: 'That exact file has already been uploaded.' }, { status: 409 });
  }

  const documentId = crypto.randomUUID();
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'checklist.pdf';
  const path = `${ctx.companyId}/${job.id}/${documentId}-${safeName}`;

  const { error: uploadError } = await db.storage
    .from('job-documents')
    .upload(path, data, { contentType: 'application/pdf', upsert: false });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: rowError } = await db.from('job_documents').insert({
    id: documentId,
    company_id: ctx.companyId,
    job_id: job.id,
    doc_type: 'checklist',
    file_name: safeName,
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: data.byteLength,
    sha256,
    source: 'upload',
    uploaded_by: ctx.userId,
  });
  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: job.id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'checklist.uploaded',
    payload: { fileName: safeName, sizeBytes: data.byteLength, revision: isRevision },
  });

  if (isRevision) {
    // A revised checklist returns the job to scrutiny for a final look.
    await db
      .from('jobs')
      .update({ stage: 'scrutiny', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('company_id', ctx.companyId)
      .eq('stage', 'checklist_revision');
    return NextResponse.json({ ok: true, documentId, revision: true });
  }

  await db
    .from('jobs')
    .update({
      branch_id: branchId,
      job_number: jobNumber,
      eta,
      stage: 'scrutiny',
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('company_id', ctx.companyId)
    // Never drag a job that has already moved on back into scrutiny.
    .in('stage', ['new', 'documents_received', 'exported']);

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: job.id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'job.details_recorded',
    payload: { jobNumber, eta },
  });

  return NextResponse.json({ ok: true, documentId });
}
