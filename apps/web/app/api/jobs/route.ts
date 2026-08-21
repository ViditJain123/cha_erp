import { NextResponse } from 'next/server';
import { processUpload } from '@checklist/ingest';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_UPLOAD_BYTES, sniffMime } from '@/lib/upload';

export const runtime = 'nodejs';
// Every document in the batch is read by a model, and they run concurrently, so
// the ceiling is the slowest single document rather than their sum. Still well
// above the default: a dense B/L can take the better part of a minute.
export const maxDuration = 300;

/**
 * Opens a job from documents dropped in by hand.
 *
 * The mailbox watcher is the main way jobs appear, but it is not the only one a
 * company has: a broker who has not connected Outlook yet, or who was handed a
 * folder of scans, still needs a way in. This runs the identical triage and
 * matching the watcher runs, so a job started here is indistinguishable from one
 * an email opened — same document rows, same identifiers, same timeline.
 */
export async function POST(request: Request) {
  const ctx = await requireCompany();

  const form = await request.formData();
  const uploaded = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  if (uploaded.length === 0) {
    return NextResponse.json({ error: 'Drop at least one document.' }, { status: 400 });
  }
  if (uploaded.length > MAX_BATCH_FILES) {
    return NextResponse.json(
      { error: `Drop at most ${MAX_BATCH_FILES} documents at a time.` },
      { status: 400 },
    );
  }

  let total = 0;
  const files = [];

  for (const file of uploaded) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `${file.name} is larger than 25 MB.` }, { status: 400 });
    }
    total += file.size;
    if (total > MAX_BATCH_BYTES) {
      return NextResponse.json(
        { error: 'That batch is over 40 MB in total. Drop them in two goes.' },
        { status: 400 },
      );
    }

    const data = Buffer.from(await file.arrayBuffer());
    // Sniffed, not trusted: storage rejects a mime outside the bucket's list
    // only after the bytes have crossed the wire, and the model has to be told
    // what it is being handed.
    const mimeType = sniffMime(data, file.name);
    if (!mimeType) {
      return NextResponse.json(
        { error: `${file.name} is not a PDF, an image, or a Word or Excel document.` },
        { status: 400 },
      );
    }

    files.push({ fileName: file.name, contentType: mimeType, data });
  }

  try {
    const result = await processUpload(serviceClient(), {
      companyId: ctx.companyId,
      uploadedBy: ctx.userId,
      files,
    });

    if (result.outcome === 'ambiguous') {
      // Two shipments merged into one job cannot be pulled apart again from the
      // audit trail, so the person who has the documents in front of them
      // decides. Named jobs rather than bare ids: the drop zone links to them.
      return NextResponse.json({ ...result, candidates: await nameJobs(ctx.companyId, result.candidateJobIds ?? []) });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Titles for the jobs an ambiguous batch matched, so the UI can offer them. */
async function nameJobs(companyId: string, jobIds: string[]) {
  if (jobIds.length === 0) return [];
  const { data } = await serviceClient()
    .from('jobs')
    .select('id, job_number, title')
    .eq('company_id', companyId)
    .in('id', jobIds);
  return (data ?? []).map((j) => ({
    id: j.id,
    label: j.job_number ?? j.title ?? 'Untitled job',
  }));
}
