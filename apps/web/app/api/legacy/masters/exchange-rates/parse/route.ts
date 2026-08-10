import { NextRequest, NextResponse } from 'next/server';
import { parseExchangeRateText } from '@checklist/extraction';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return new NextResponse('no text', { status: 400 });
  const parsed = await parseExchangeRateText(text);
  return NextResponse.json(parsed);
}
