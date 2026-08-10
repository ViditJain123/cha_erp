import { NextRequest, NextResponse } from 'next/server';
import { readJobFile } from '@/lib/store';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const data = await readJobFile(id, decodeURIComponent(name));
  if (!data) return new NextResponse('not found', { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline' },
  });
}
