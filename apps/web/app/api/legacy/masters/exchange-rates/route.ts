import { NextRequest, NextResponse } from 'next/server';
import { addExchangeRateTable, type ExchangeRateMaster } from '@checklist/core';

export const runtime = 'nodejs';

/**
 * Key a fortnight by hand.
 *
 * The escape hatch for a table ICEGATE has published but this deployment
 * predates — the normal route is `packages/core/scripts/fetch-eram.py` plus a
 * rebuild. Both an import and an export rate are required because CBIC notifies
 * both and a table that carries only one cannot be told apart from a parse that
 * lost the other.
 *
 * Rates are **per single unit**. ICEGATE quotes the yen and the won per 100, so
 * `100 JPY = 62.45` is entered here as `0.6245`.
 */
export async function POST(req: NextRequest) {
  const row = (await req.json()) as ExchangeRateMaster;
  const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isDate(row.effectiveFrom))
    return new NextResponse('effectiveFrom must be YYYY-MM-DD', { status: 400 });
  if (row.effectiveTo != null && !isDate(row.effectiveTo))
    return new NextResponse('effectiveTo must be YYYY-MM-DD or null', { status: 400 });
  if (!row.source?.trim())
    return new NextResponse('source is required — the notification or ERAM publication', {
      status: 400,
    });

  const rates = Object.fromEntries(
    Object.entries(row.rates ?? {}).filter(
      ([c, r]) =>
        /^[A-Z]{3}$/.test(c) &&
        typeof r?.import === 'number' &&
        r.import > 0 &&
        typeof r?.export === 'number' &&
        r.export > 0,
    ),
  );
  if (!Object.keys(rates).length) return new NextResponse('no valid rates', { status: 400 });

  addExchangeRateTable({
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo ?? null,
    source: row.source.trim(),
    rates,
  });
  return NextResponse.json({ ok: true });
}
