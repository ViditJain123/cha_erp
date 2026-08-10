import { NextResponse } from 'next/server';
import {
  allExchangeRates,
  allImporters,
  allProductMemory,
  allTariff,
} from '@checklist/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    tariff: allTariff(),
    importers: allImporters(),
    exchangeRates: allExchangeRates(),
    productMemory: allProductMemory(),
  });
}
