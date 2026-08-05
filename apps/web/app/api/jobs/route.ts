import { NextRequest, NextResponse } from 'next/server';
import { enrichDraftFromLibrary, runPipeline } from '@checklist/extraction';
import { createJob, getJob, saveJob } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function process(jobId: string, files: { fileName: string; pdf: Buffer }[]) {
  const job = await getJob(jobId);
  if (!job) return;
  try {
    const { draft, docs } = await runPipeline(files);
    job.draft = await enrichDraftFromLibrary(draft);
    job.docs = docs;
    job.status = 'review';
  } catch (err) {
    job.status = 'failed';
    job.error = (err as Error).message;
  }
  await saveJob(job);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const uploads = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!uploads.length) return new NextResponse('no files', { status: 400 });

  const files = await Promise.all(
    uploads.map(async (f) => ({ fileName: f.name, data: Buffer.from(await f.arrayBuffer()) })),
  );
  const job = await createJob(files);

  // fire-and-forget; the job page polls status (a queue/worker takes over in prod)
  void process(job.id, files.map((f) => ({ fileName: f.fileName, pdf: f.data })));

  return NextResponse.json({ id: job.id });
}
