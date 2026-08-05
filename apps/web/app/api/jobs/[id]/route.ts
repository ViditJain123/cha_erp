import { NextRequest, NextResponse } from 'next/server';
import type { ChecklistDraft } from '@checklist/extraction';
import { getJob, saveJob } from '@/lib/store';
import { recomputeDuty } from '@/lib/recompute';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return new NextResponse('not found', { status: 404 });
  return NextResponse.json(job);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return new NextResponse('not found', { status: 404 });
  if (job.status === 'approved') return new NextResponse('job already approved', { status: 409 });

  const draft = (await req.json()) as ChecklistDraft;
  job.draft = recomputeDuty(draft);
  await saveJob(job);
  return NextResponse.json(job);
}
