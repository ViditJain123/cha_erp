import { exchangeRateTableOn, rateDeterminingDate } from '@checklist/core';
import { draftCurrencies, type ChecklistDraft } from '@checklist/extraction';
import { recomputeDuty } from './recompute';
import { serviceClient } from '@checklist/db';

/**
 * Re-value the draft at the rate of exchange its filing date actually carries.
 *
 * ## Why this is a job step and not part of the merge
 *
 * Section 14 of the Customs Act fixes the rate by the date the Bill of Entry is
 * presented. The merge cannot know that date: it is a pure function over the
 * documents, and the shipper's documents never state when we will file. The
 * date is keyed by an operator on `job_boe_header`, often days later. So the
 * merge seeds provisional rates from the day it runs and says so, and this step
 * — which has the job, the database and therefore the date — settles them.
 *
 * It sits in `applyJobResolution`, the cheap tail that re-runs on every header
 * change, so keying the BE date moves the rates, the assessable values and the
 * duty in one go, without paying to read the documents again.
 *
 * ## What it refuses to do
 *
 * Nothing here defaults. A date the master has no table for produces empty
 * rates and an error flag, which reaches the exporter's existing EXCHANGE_RATE
 * blocker and stops the workbook. That is the intended outcome: the previous
 * behaviour was to hand back whatever table was typed into `masters/data.ts`
 * last, which filed `liv_job1` at USD 96.05 when its date carried 86.20 — about
 * 11% on the assessable value of every line, and invisible unless somebody
 * checked.
 *
 * A currency missing from a table that *does* apply is a different statement
 * and is left alone: ICES calls it non-standard and wants the importer's bank
 * certificate on the row instead (error 155), which the exporter models.
 */
export async function applyExchangeRateResolution(
  draft: ChecklistDraft,
  companyId: string,
  jobId: string,
): Promise<ChecklistDraft> {
  const db = serviceClient();
  const { data: header } = await db
    .from('job_boe_header')
    .select('be_filing_date, inward_date')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .maybeSingle();

  return recomputeDuty(valueAtFilingDate(draft, header ?? null));
}

/** The keyed dates this step reads off `job_boe_header`. */
export interface RateHeader {
  be_filing_date?: string | null;
  inward_date?: string | null;
}

/**
 * The decision, with no database in it.
 *
 * Split out so it can be tested directly: the rule about *which* date values a
 * Bill of Entry is the part worth pinning, and it should not need a Supabase
 * client to exercise. The wrapper above does the read and the duty recompute.
 */
export function valueAtFilingDate(draft: ChecklistDraft, header: RateHeader | null): ChecklistDraft {
  // The same precedence the GENERAL header uses: what the operator keyed, then
  // what the documents said.
  const rateDate = rateDeterminingDate({
    ...(header?.be_filing_date ? { beFilingDate: header.be_filing_date } : {}),
    ...(header?.inward_date
      ? { inwardDate: header.inward_date }
      : draft.shipment.inwardDate
        ? { inwardDate: draft.shipment.inwardDate }
        : {}),
  });

  // This step owns every flag on this path, so re-resolving replaces rather
  // than accumulates — including the merge's provisional notice.
  const flags = draft.flags.filter((f) => f.path !== 'invoiceMeta.exchangeRates');

  if (!rateDate) {
    flags.push({
      severity: 'warning',
      path: 'invoiceMeta.exchangeRates',
      message:
        'The exchange rates on this draft are provisional — they are the table in force ' +
        'when the documents were read, not the one that applies to the filing. Key the ' +
        'Bill of Entry date on the job and the rates, the assessable values and the duty ' +
        'all follow.',
    });
    return { ...draft, flags };
  }

  const found = exchangeRateTableOn(rateDate);
  if (!found.ok) {
    flags.push({
      severity: 'error',
      path: 'invoiceMeta.exchangeRates',
      message:
        `No customs exchange rate applies to ${rateDate}: ${found.detail} Every rupee ` +
        'figure on this Bill of Entry derives from that rate, so it is left unset rather ' +
        'than guessed.',
    });
    return { ...draft, flags, invoiceMeta: { ...draft.invoiceMeta, exchangeRates: {} } };
  }

  const needed = draftCurrencies(draft.invoices);
  const exchangeRates = Object.fromEntries(
    needed.filter((c) => found.rates[c] != null).map((c) => [c, found.rates[c]!]),
  );

  const unnotified = needed.filter((c) => found.rates[c] == null);
  flags.push({
    severity: 'info',
    path: 'invoiceMeta.exchangeRates',
    message:
      `Valued at the rates in force on ${rateDate} (${found.table.source})` +
      (rateDate === header?.be_filing_date
        ? ', the date the Bill of Entry is presented.'
        : ', the date of entry inwards — the Bill of Entry was presented before the vessel arrived.') +
      (unnotified.length
        ? ` ${unnotified.join(', ')} ${unnotified.length === 1 ? 'is' : 'are'} not in that ` +
          'notification, so ICES treats it as non-standard and wants the bank rate certificate.'
        : ''),
  });

  return { ...draft, flags, invoiceMeta: { ...draft.invoiceMeta, exchangeRates } };
}
