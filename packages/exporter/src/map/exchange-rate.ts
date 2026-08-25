import { BLANK, code, qty } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/** The rupee itself, at parity. Logi-Sys' own export leads with this row. */
const INR_BASE: SheetRow = {
  CURRENCY_CODE: code('INR'),
  EXCHANGE_RATE: qty(1),
  BANK_NAME: BLANK,
  BANK_CERTIFICATE: BLANK,
  BANK_CERTIFICATE_DATE: BLANK,
};

/** EXCHANGE_RATE — the CBIC customs rate the invoice currency is converted at. */
export function exchangeRateRows(ctx: MapContext): SheetRow[] {
  const { exchangeRate } = ctx.draft.invoiceMeta;

  if (!exchangeRate?.rate) {
    ctx.blocker(
      'EXCHANGE_RATE',
      'No exchange rate on the draft. Every INR value on the Bill of Entry derives from it.',
    );
    return [];
  }

  // An INR invoice needs no second row; anything else is converted against the
  // base, which is why both are listed.
  if (exchangeRate.currency === 'INR') return [INR_BASE];

  return [
    INR_BASE,
    {
      CURRENCY_CODE: code(exchangeRate.currency),
      EXCHANGE_RATE: qty(exchangeRate.rate),
      BANK_NAME: BLANK,
      BANK_CERTIFICATE: BLANK,
      BANK_CERTIFICATE_DATE: BLANK,
    },
  ];
}
