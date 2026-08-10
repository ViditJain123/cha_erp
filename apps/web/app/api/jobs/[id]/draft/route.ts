import { NextResponse } from 'next/server';
import type { ChecklistDraft } from '@checklist/extraction';
import { requireCompany } from '@/lib/auth';
import { buildDraftFromDocuments } from '@/lib/draft-pipeline';
import { serviceClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** The job's latest draft, or 404 when it has not been read yet. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  const { data } = await db
    .from('job_drafts')
    .select('draft, version, status, created_at')
    .eq('job_id', id)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: 'No draft for this job yet.' }, { status: 404 });
  return NextResponse.json(data);
}

/**
 * Read the job's documents into a checklist draft and file it as a new version.
 *
 * One model call per document, so this is deliberately its own request rather
 * than something the export route does on demand — a broker pressing "export"
 * should not wait on extraction, and should not silently pay for it twice.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  // Scoped by company as well as id: the service role bypasses RLS.
  const { data: job } = await db
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });

  const { data: documents } = await db
    .from('job_documents')
    .select('file_name, storage_bucket, storage_path')
    .eq('job_id', id)
    .eq('company_id', ctx.companyId);

  if (!documents?.length) {
    return NextResponse.json(
      { error: 'This job has no documents to read.' },
      { status: 409 },
    );
  }

  const files = await Promise.all(
    documents.map(async (doc) => {
      const { data, error } = await db.storage.from(doc.storage_bucket).download(doc.storage_path);
      if (error || !data) {
        throw new Error(`Could not download ${doc.file_name}: ${error?.message ?? 'no data'}`);
      }
      return { fileName: doc.file_name, pdf: Buffer.from(await data.arrayBuffer()) };
    }),
  );

  let draft: ChecklistDraft;
  try {
    ({ draft } = await buildDraftFromDocuments(files));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Drafts are versioned, not overwritten: a Bill of Entry filed from one
  // revision has to stay reconstructible after someone saves the next.
  const { data: latest } = await db
    .from('job_drafts')
    .select('version')
    .eq('job_id', id)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (latest?.version ?? 0) + 1;

  const { error: insertError } = await db.from('job_drafts').insert({
    company_id: ctx.companyId,
    job_id: id,
    // The draft's shape belongs to @checklist/extraction, not to the generated
    // database types; the column is deliberately schemaless jsonb.
    draft: draft as never,
    version,
    created_by: ctx.userId,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'draft.generated',
    payload: {
      version,
      documents: files.length,
      flags: draft.flags.length,
    },
  });

  return NextResponse.json({ version, flags: draft.flags });
}
