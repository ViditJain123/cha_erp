import { NextRequest, NextResponse } from 'next/server';
import { getJob, readJobPdf } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return new NextResponse('not found', { status: 404 });
  const pdf = await readJobPdf(id);
  if (!pdf) return new NextResponse('checklist not generated yet', { status: 404 });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Import CheckList-${job.jobNumber.replace(/\//g, '-')}.pdf"`,
    },
  });
}
