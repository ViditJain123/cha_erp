import { NextRequest, NextResponse } from 'next/server';
import { upsertTariff, type TariffMaster } from '@checklist/core';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const row = (await req.json()) as TariffMaster;
  if (!/^\d{8}$/.test(row.cth ?? '')) return new NextResponse('cth must be 8 digits', { status: 400 });
  if (typeof row.bcdRate !== 'number' || typeof row.igstRate !== 'number')
    return new NextResponse('bcdRate and igstRate must be numbers', { status: 400 });
  upsertTariff({
    ...row,
    aidcRate: row.aidcRate ?? 0,
    aidcNotification: row.aidcNotification ?? '011/2021',
    compCessRate: row.compCessRate ?? 0,
    compCessNotification: row.compCessNotification ?? '001/2017',
    igstNotification: row.igstNotification ?? '009/2025',
    unit: row.unit ?? 'KGS',
    description: row.description ?? '',
  });
  return NextResponse.json({ ok: true });
}
