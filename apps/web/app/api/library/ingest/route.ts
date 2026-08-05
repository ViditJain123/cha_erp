import { NextRequest, NextResponse } from 'next/server';
import { fetchNotification, getDoc, indexDoc } from '@checklist/library';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Download a notification PDF by URL and index it into the library.
 * taxinformation.cbic.gov.in view-pdf URLs are resolved through the portal's
 * own anonymous metadata/content endpoints (handled inside fetchNotification).
 */
/** Only official document hosts may be fetched server-side (SSRF guard). */
const ALLOWED_HOSTS = new Set([
  'taxinformation.cbic.gov.in',
  'www.cbic.gov.in',
  'cbic.gov.in',
  'web.archive.org',
]);

export async function POST(req: NextRequest) {
  const { url, label } = (await req.json()) as { url: string; label?: string };
  let parsed: URL;
  try {
    parsed = new URL(url ?? '');
  } catch {
    return new NextResponse('invalid url', { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname))
    return new NextResponse(
      `only official document hosts are allowed: ${[...ALLOWED_HOSTS].join(', ')}`,
      { status: 400 },
    );
  const isPortal = parsed.hostname === 'taxinformation.cbic.gov.in';
  if (!isPortal && !label?.trim())
    return new NextResponse('label required for non-portal URLs', { status: 400 });

  const fetched = await fetchNotification(url, label ?? '');
  if (fetched.status === 'missing')
    return new NextResponse('could not download a PDF from that URL', { status: 422 });
  const meta = getDoc(fetched.id);
  if (!meta) return new NextResponse('fetch succeeded but doc missing', { status: 500 });
  const indexed = await indexDoc(meta);
  return NextResponse.json({ fetched, indexed, title: meta.title });
}
