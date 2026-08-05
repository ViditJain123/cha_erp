import { NextRequest, NextResponse } from 'next/server';
import { parseNotificationPdf } from '@checklist/extraction';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return new NextResponse('no file', { status: 400 });
  const parsed = await parseNotificationPdf(file.name, Buffer.from(await file.arrayBuffer()));
  return NextResponse.json(parsed);
}
