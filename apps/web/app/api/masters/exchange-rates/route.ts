import { NextRequest, NextResponse } from 'next/server';
import { addExchangeRateTable, type ExchangeRateMaster } from '@checklist/core';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const row = (await req.json()) as ExchangeRateMaster;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveFrom ?? ''))
    return new NextResponse('effectiveFrom must be YYYY-MM-DD', { status: 400 });
  const rates = Object.fromEntries(
    Object.entries(row.rates ?? {}).filter(([c, r]) => /^[A-Z]{3}$/.test(c) && typeof r === 'number' && r > 0),
  );
  if (!Object.keys(rates).length) return new NextResponse('no valid rates', { status: 400 });
  addExchangeRateTable({ effectiveFrom: row.effectiveFrom, rates });
  return NextResponse.json({ ok: true });
}
