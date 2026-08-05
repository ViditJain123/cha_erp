import { NextRequest, NextResponse } from 'next/server';
import { fetchNotification, getDoc, indexDoc } from '@checklist/library';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Download a notification PDF by URL and index it into the library.
 * taxinformation.cbic.gov.in view-pdf URLs are resolved through the portal's
 * own anonymous metadata/content endpoints (handled inside fetchNotification).
 */
export async function POST(req: NextRequest) {
  const { url, label } = (await req.json()) as { url: string; label?: string };
  if (!url?.startsWith('https://')) return new NextResponse('need https url', { status: 400 });
  if (!url.includes('taxinformation.cbic.gov.in') && !label?.trim())
    return new NextResponse('label required for non-portal URLs', { status: 400 });

  const fetched = await fetchNotification(url, label ?? '');
  if (fetched.status === 'missing')
    return new NextResponse('could not download a PDF from that URL', { status: 422 });
  const meta = getDoc(fetched.id);
  if (!meta) return new NextResponse('fetch succeeded but doc missing', { status: 500 });
  const indexed = await indexDoc(meta);
  return NextResponse.json({ fetched, indexed, title: meta.title });
}
