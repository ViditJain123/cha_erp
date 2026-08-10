import { NextResponse } from 'next/server';
import { buildLogisysWorkbook } from '@checklist/exporter';
import type { ChecklistDraft } from '@checklist/extraction';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Builds the Logi-Sys import workbook for a job, files a copy in storage, and
 * streams it back.
 *
 * The workbook is generated from the job's latest checklist draft. Without one
 * there is nothing to declare, so this returns 409 rather than handing back an
 * empty-but-valid spreadsheet — which is what it used to do, and which reads to
 * a user as a working export.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  // Scoped by company as well as id: the service role bypasses RLS.
  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });

  const { data: draftRow } = await db
    .from('job_drafts')
    .select('draft, version')
    .eq('job_id', id)
    .eq('company_id', ctx.companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draftRow) {
    return NextResponse.json(
      {
        error:
          'This job has no checklist draft yet, so there is nothing to export. ' +
          'Read its documents first.',
      },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await buildLogisysWorkbook({
      draft: draftRow.draft as unknown as ChecklistDraft,
      job: { id: job.id, reference: job.reference },
    });
  } catch (err) {
    // The exporter refuses to emit a workbook that would misstate the
    // consignment — a missing tariff code, a line that does not reconcile.
    // Surface that rather than turning it into a 500.
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }

  const exportId = crypto.randomUUID();
  const path = `${ctx.companyId}/${job.id}/${exportId}.xlsx`;

  const { error: uploadError } = await db.storage
    .from('job-exports')
    .upload(path, result.buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  await db.from('job_exports').insert({
    id: exportId,
    company_id: ctx.companyId,
    job_id: job.id,
    kind: 'logisys_xlsx',
    storage_path: path,
    template_version: result.templateVersion,
    draft_version: draftRow.version,
    generated_by: ctx.userId,
  });

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: job.id,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'export.generated',
    payload: {
      fileName: result.fileName,
      templateVersion: result.templateVersion,
      draftVersion: draftRow.version,
      warnings: result.warnings,
    },
  });

  // Never move a job backwards: one that already has its checklist stays there.
  await db
    .from('jobs')
    .update({ stage: 'exported', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('company_id', ctx.companyId)
    .in('stage', ['new', 'documents_received']);

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${result.fileName}"`,
      // Columns we could not fill. The UI reads this so an incomplete export
      // is visible rather than silent.
      'x-logisys-warnings': encodeURIComponent(JSON.stringify(result.warnings)),
      'cache-control': 'no-store',
    },
  });
}
