import { computeJobDuty, type ExchangeRateTable } from '@checklist/core';
import { toInvoiceInput, type ChecklistDraft } from '@checklist/extraction';

/** Recompute the duty block after reviewer edits; never throws. */
export function recomputeDuty(draft: ChecklistDraft): ChecklistDraft {
  const rates: ExchangeRateTable = {
    [draft.invoiceMeta.exchangeRate.currency]: draft.invoiceMeta.exchangeRate.rate,
  };
  // insurance/misc may be quoted in other currencies (e.g. INR) — INR handled natively
  try {
    const duty = computeJobDuty(toInvoiceInput(draft), rates);
    return { ...draft, duty };
  } catch (err) {
    return {
      ...draft,
      duty: null,
      flags: [
        ...draft.flags.filter((f) => !f.message.startsWith('Duty computation failed')),
        { severity: 'error' as const, message: `Duty computation failed: ${(err as Error).message}` },
      ],
    };
  }
}
