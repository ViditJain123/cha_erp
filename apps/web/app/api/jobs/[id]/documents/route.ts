import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { safeZipName, zipEntries } from '@/lib/zip';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Every document on a job as a single zip.
 *
 * Deliberately a secondary action: by the time a job reaches scrutiny the user
 * usually already has these files from the original email. It exists so nobody
 * has to click through fifteen links, not as the main way in.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  const { data: job } = await db
    .from('jobs')
    .select('id, job_number, title')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 });

  const { data: documents } = await db
    .from('job_documents')
    .select('file_name, storage_bucket, storage_path')
    .eq('company_id', ctx.companyId)
    .eq('job_id', id)
    .order('created_at');

  if (!documents || documents.length === 0) {
    return NextResponse.json({ error: 'This job has no documents.' }, { status: 404 });
  }

  const seen = new Map<string, number>();
  const entries = [];

  for (const doc of documents) {
    const { data: blob, error } = await db.storage
      .from(doc.storage_bucket)
      .download(doc.storage_path);
    if (error || !blob) continue;

    // File names come off email attachments, so sanitise before they become
    // paths on someone's disk.
    const base = safeZipName(doc.file_name);

    // Two documents can legitimately share a file name; a zip with duplicate
    // entries extracts to a single file and silently loses one.
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const name = count === 0 ? base : base.replace(/(\.[^.]+)?$/, `-${count + 1}$1`);

    entries.push({ name, data: Buffer.from(await blob.arrayBuffer()) });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'Could not read any of the documents.' }, { status: 500 });
  }

  const label = (job.job_number ?? job.title ?? job.id).replace(/[^A-Za-z0-9._-]+/g, '-');
  return new NextResponse(new Uint8Array(zipEntries(entries)), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="job-${label}-documents.zip"`,
      'cache-control': 'no-store',
    },
  });
}
