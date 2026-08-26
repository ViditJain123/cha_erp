import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { serviceClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Both buckets a job's files live in. Keys are `{company_id}/{job_id}/...`. */
const JOB_BUCKETS = ['job-documents', 'job-exports'] as const;

/**
 * Deletes a job and everything attached to it.
 *
 * Every child table cascades off `jobs.id`, so the database side is one delete.
 * Storage does not cascade, and that is the part worth being careful about: the
 * documents and the generated workbooks are keyed by `{company}/{job}/`, and
 * left behind they are files nothing points at, in a tenant's bucket, that no
 * screen can reach.
 *
 * The order is deliberate. The tombstone is written **first**, storage is
 * emptied **second**, and the row goes **last**:
 *
 *   - Tombstone first, because `job_events` is the audit trail and it cascades
 *     away with the job it describes. Written after the delete, a crash in
 *     between would lose the only record that the job ever existed.
 *   - Row last, because a failed storage sweep leaves a job that still lists
 *     its documents and can be deleted again. The reverse — row gone, files
 *     orphaned — leaves nothing to retry with.
 *
 * A storage failure therefore aborts before the row is touched, rather than
 * being logged and carried past.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;

  // Deleting a job is not ordinary desk work: it destroys the filing history of
  // a consignment. Scrutiny and the DO desk can do everything else on a job and
  // not this.
  if (!COMPANY_MANAGER_ROLES.includes(ctx.role)) {
    return NextResponse.json(
      { error: 'Only a company owner or admin can delete a job.' },
      { status: 403 },
    );
  }

  const db = serviceClient();

  // Scoped by company as well as id: the service role bypasses RLS.
  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });

  // The caller must name the job it means to destroy. A DELETE that fires on a
  // stale id from a list the user scrolled past is exactly the accident this is
  // here to stop, and there is no undo behind it.
  let confirm: string | undefined;
  let reason: string | undefined;
  try {
    const body = (await request.json()) as { confirm?: string; reason?: string };
    confirm = body.confirm;
    reason = body.reason;
  } catch {
    // No body — falls through to the mismatch below.
  }
  if (confirm !== job.id) {
    return NextResponse.json(
      { error: 'Confirm the deletion by sending the job id as `confirm`.' },
      { status: 400 },
    );
  }

  const [{ count: documentCount }, { count: draftCount }, { count: exportCount }] = await Promise.all([
    db.from('job_documents').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
    db.from('job_drafts').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
    db.from('job_exports').select('id', { count: 'exact', head: true }).eq('job_id', job.id),
  ]);

  // Listed from storage rather than read off `job_documents`, so a file whose
  // row was already lost still goes.
  const prefix = `${ctx.companyId}/${job.id}`;
  const removed: string[] = [];
  for (const bucket of JOB_BUCKETS) {
    const { data: objects, error: listError } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
    if (listError) {
      return NextResponse.json(
        { error: `Could not list ${bucket} for this job: ${listError.message}` },
        { status: 500 },
      );
    }
    for (const object of objects ?? []) removed.push(`${bucket}:${prefix}/${object.name}`);
  }

  await db.from('deleted_jobs').insert({
    company_id: ctx.companyId,
    job_id: job.id,
    title: job.title,
    job_number: job.job_number,
    importer_name: job.importer_name,
    stage: job.stage,
    reason: reason?.trim() || null,
    snapshot: {
      job,
      counts: { documents: documentCount ?? 0, drafts: draftCount ?? 0, exports: exportCount ?? 0 },
      storageObjects: removed,
    },
    deleted_by: ctx.userId,
  });

  for (const bucket of JOB_BUCKETS) {
    const paths = removed
      .filter((key) => key.startsWith(`${bucket}:`))
      .map((key) => key.slice(bucket.length + 1));
    if (!paths.length) continue;
    const { error: removeError } = await db.storage.from(bucket).remove(paths);
    if (removeError) {
      return NextResponse.json(
        {
          error:
            `Could not delete this job's files from ${bucket}: ${removeError.message}. ` +
            'The job was left in place — nothing was destroyed. Try again.',
        },
        { status: 500 },
      );
    }
  }

  const { error: deleteError } = await db
    .from('jobs')
    .delete()
    .eq('id', job.id)
    .eq('company_id', ctx.companyId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deleted: {
      id: job.id,
      title: job.title,
      documents: documentCount ?? 0,
      drafts: draftCount ?? 0,
      exports: exportCount ?? 0,
      files: removed.length,
    },
  });
}
