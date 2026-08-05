import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { getJob, saveJob, writeJobPdf } from '@/lib/store';
import { checklistHtml } from '@/lib/checklist-html';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return new NextResponse('not found', { status: 404 });
  if (!job.draft) return new NextResponse('job has no draft yet', { status: 409 });

  const html = checklistHtml(job);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'A4',
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:right;font-size:8px;padding:0 10mm;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: '14mm', bottom: '16mm', left: '10mm', right: '10mm' },
    });
    await writeJobPdf(id, Buffer.from(pdf));
  } finally {
    await browser.close();
  }

  job.status = 'approved';
  job.approvedAt = new Date().toISOString();
  await saveJob(job);
  return NextResponse.json({ ok: true });
}
