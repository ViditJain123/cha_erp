import { NextRequest, NextResponse } from 'next/server';
import { searchLibrary } from '@checklist/library';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query: string };
  if (!query?.trim()) return new NextResponse('no query', { status: 400 });
  const hits = await searchLibrary(query, { topK: 8 });
  return NextResponse.json({ hits });
}
