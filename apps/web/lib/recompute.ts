import { computeBeDuty, type ExchangeRateTable } from '@checklist/core';
import { toInvoiceInputs, type ChecklistDraft } from '@checklist/extraction';

/** Recompute the duty block after reviewer edits; never throws. */
export function recomputeDuty(draft: ChecklistDraft): ChecklistDraft {
  // Every currency the BE invoices in. Insurance and misc may be quoted in
  // others (typically INR), which the engine handles natively.
  const rates: ExchangeRateTable = { ...draft.invoiceMeta.exchangeRates };
  try {
    const duty = computeBeDuty(toInvoiceInputs(draft), rates);
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
