import { BLANK, code, isoDate, qty, text } from '../cell.js';
import type { DraftInvoice } from '@checklist/extraction';
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

/**
 * EXCHANGE_RATE — the rate every foreign figure on the BE converts at.
 *
 * ICES `<TABLE>EXCHANGE` (BE Message format 2.25, CACHI01 Part 2/24). One row
 * per currency, not per invoice: `ex_job5` files twelve invoices and its
 * checklist prints "100 JPY = 60.8000 INR, 1 USD = 96.6000 INR". A BE that
 * declares one of the two rates values eleven invoices at the wrong one.
 * Contract: docs/boe-mapping/19-exchange-rate.md.
 *
 * ICES splits currencies two ways, and the split decides three columns:
 *
 *   - **standard** — the Ministry of Finance issues a rate notification for it.
 *     `draft.invoiceMeta.exchangeRates` *is* that notification, so membership of
 *     that map is the test. The bank columns stay blank.
 *   - **non-standard** — no notification, so the importer's bank certifies a
 *     rate. Bank name, certificate number and certificate date are then all
 *     mandatory (ICES 155), and the certificate date must equal the filing date.
 *
 * An ex-bond BE carries no rows at all: `<TABLE>EXCHANGE` is `X` for ex-bond in
 * the components matrix, and ICES 662 says so outright.
 */
export function exchangeRateRows(ctx: MapContext): SheetRow[] {
  if (ctx.draft.beType === 'Ex-Bond') return [];

  const { exchangeRates, bankRateCertificates } = ctx.draft.invoiceMeta;

  // Every currency the BE converts at: the invoices, plus any charge billed in
  // a currency no invoice uses. ICES rejects a freight, insurance, misc or
  // loading currency with no exchange row of its own (220 / 227 / 234 / 241).
  const currencies = [
    ...new Set([
      ...ctx.draft.invoices.map((i) => i.currency),
      ...ctx.draft.invoices.flatMap((i) => chargeCurrencies(i)),
    ]),
  ].filter((c): c is string => !!c && c !== 'INR');

  const rows: SheetRow[] = [INR_BASE];
  const unanswered: string[] = [];

  for (const currency of currencies) {
    const notified = exchangeRates?.[currency];
    if (notified != null) {
      rows.push({
        CURRENCY_CODE: code(currency),
        EXCHANGE_RATE: qty(notified),
        BANK_NAME: BLANK,
        BANK_CERTIFICATE: BLANK,
        BANK_CERTIFICATE_DATE: BLANK,
      });
      continue;
    }

    // Not in the notification, so ICES calls it non-standard and wants the
    // bank's certificate instead. This is not the error case it used to be.
    const cert = bankRateCertificates?.[currency];
    if (!cert) {
      unanswered.push(currency);
      continue;
    }

    const beDate = ctx.draft.shipment.beFilingDate;
    if (beDate && cert.certificateDate !== beDate) {
      ctx.warn(
        'EXCHANGE_RATE',
        `The bank rate certificate for ${currency} is dated ${cert.certificateDate} and the Bill of ` +
          `Entry is dated ${beDate}. ICES requires the certificate date to match the filing date ` +
          'for a non-notified currency, so this one needs re-issuing before the BE is filed.',
      );
    }

    rows.push({
      CURRENCY_CODE: code(currency),
      EXCHANGE_RATE: qty(cert.rate),
      BANK_NAME: text(cert.bankName),
      BANK_CERTIFICATE: code(cert.certificateNo),
      BANK_CERTIFICATE_DATE: isoDate(cert.certificateDate),
    });
  }

  if (unanswered.length) {
    ctx.blocker(
      'EXCHANGE_RATE',
      `No rate for ${unanswered.join(', ')}: the CBIC notification does not cover ` +
        `${unanswered.length === 1 ? 'it' : 'them'} and no bank rate certificate is on the job. ` +
        'Every INR value on the Bill of Entry derives from this rate, so the export refuses rather ' +
        'than guessing one.',
    );
    return [];
  }

  return rows;
}

/**
 * The currencies an invoice's charges are billed in.
 *
 * A freight certificate in EUR against a USD invoice needs its own row here;
 * notional percentage insurance has no currency of its own and needs none.
 */
function chargeCurrencies(invoice: DraftInvoice): string[] {
  const insurance = invoice.insurance?.kind === 'amount' ? invoice.insurance.value.currency : undefined;
  return [invoice.freight?.currency, insurance, invoice.miscCharges?.currency].filter(
    (c): c is string => !!c,
  );
}
