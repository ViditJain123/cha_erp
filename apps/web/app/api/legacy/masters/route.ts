import { NextResponse } from 'next/server';
import {
  allExchangeRates,
  allImporters,
  allProductMemory,
  allTariff,
  tariffBook,
  type TariffMaster,
} from '@checklist/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rows the tariff tab shows without a search.
 *
 * This used to return `allTariff()` whole, which was three rows plus whatever a
 * reviewer had corrected. With the printed First Schedule under it that is
 * ~12,000 rows and about five megabytes on every page load, rendered into one
 * table of 12,000 `<tr>`. So the full list is now something you ask for by
 * name, and the default is the rows a human actually authored — the seed and
 * the overlay — which are the ones worth seeing unprompted anyway.
 */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function matches(row: TariffMaster, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return row.cth.startsWith(query.replace(/\D/g, '')) || row.description.toLowerCase().includes(q);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get('q') ?? '').trim();
  const limit = Math.min(Number(params.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);

  const all = allTariff();
  // Without a query, the rows someone has taken responsibility for. The book's
  // own rows are reachable by searching, which is how you would look for one.
  const pool = query ? all.filter((r) => matches(r, query)) : all.filter((r) => r.provenance?.source !== 'book');
  const book = tariffBook();

  return NextResponse.json({
    tariff: pool.slice(0, limit),
    tariffTotal: all.length,
    tariffMatched: pool.length,
    tariffBook: book
      ? {
          edition: book.edition,
          rowCount: book.rowCount,
          checksumPassRate: book.checksumPassRate,
          confidence: book.confidence,
        }
      : null,
    importers: allImporters(),
    exchangeRates: allExchangeRates(),
    productMemory: allProductMemory(),
  });
}
