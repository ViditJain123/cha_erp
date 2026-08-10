import { BLANK, code, num } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

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

  return [
    {
      CURRENCY_CODE: code(exchangeRate.currency),
      EXCHANGE_RATE: num(exchangeRate.rate),
      BANK_NAME: BLANK,
      BANK_CERTIFICATE: BLANK,
      BANK_CERTIFICATE_DATE: BLANK,
    },
  ];
}
