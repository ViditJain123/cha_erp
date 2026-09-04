import { z } from 'zod';
import { tradeDescription } from '@checklist/core';
import { MODELS, structuredTextCall } from './openai.js';
import type { ChecklistDraft } from './draft.js';

/**
 * The goods as customs names them, beside the goods as the seller invoices them.
 *
 * The ITEMS sheet asks for `Product_Description` and `General_Description`
 * separately and they are not the same field. The invoice says "Random
 * Polypropylene RP2248N"; the Bill of Entry declares "Random Polypropylene".
 * The difference is the manufacturer's grade code, which identifies a product
 * line and classifies nothing.
 *
 * `tradeDescription()` in @checklist/core already removes what a rule can see —
 * a trailing token that mixes letters and digits. This handles what it cannot:
 * "PP GRANULES (POLYPROPYLENE)" is declared as "PP PELLET (POLYPROPYLENE)",
 * which is a change of trade term, not a deletion.
 *
 * One call for the whole draft, not one per item — this is a rewrite, not a
 * duty judgement, and a ten-line invoice should not cost ten calls.
 */

const DescriptionsSchema = z.object({
  items: z.array(
    z.object({
      slNo: z.number(),
      /** The goods without the grade code, or the description unchanged. */
      generalDescription: z.string(),
    }),
  ),
});

/** Beyond this a general description has stopped being general. */
const MAX_LENGTH = 80;

const SYSTEM = `You are an Indian customs broker filling the "General Description" column of a Bill of Entry, from the description printed on the commercial invoice.

The general description names what the goods ARE — the substance and its physical form. Remove what identifies a particular batch or product line and classifies nothing: manufacturer grade codes ("RP2248N", "HJ333MO"), part and catalogue numbers, lot and batch references, pack sizes and net weights, and the seller's brand.

Keep the chemical or trade name in full, including a parenthesised synonym or abbreviation the trade uses ("MALEIC ANHYDRIDE (MA)" stays as it is). Where the trade has a plainer word for the form the goods arrive in, use it — polypropylene shipped as granules is declared as pellets.

Never name a different product, never add a use or a grade the invoice does not state, and never guess at goods you cannot read. When there is nothing to remove, return the description unchanged. Return one entry per item, with the slNo you were given.`;

/**
 * General descriptions for a draft's items, keyed by `slNo`.
 *
 * Returns only what the model gave back for an item it was actually asked
 * about; a `slNo` that was not in the input is dropped rather than trusted.
 */
export async function describeGoodsGenerically(
  items: { slNo: number; description: string; ritc: string }[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!items.length) return out;

  const result = await structuredTextCall({
    schema: DescriptionsSchema,
    schemaName: 'general_descriptions',
    system: SYSTEM,
    userText: items
      .map((it) => `slNo ${it.slNo} | CTH ${it.ritc} | ${it.description}`)
      .join('\n'),
    model: MODELS.extract,
  });

  const asked = new Set(items.map((it) => it.slNo));
  for (const row of result.items) {
    const value = row.generalDescription.replace(/\s+/g, ' ').trim();
    if (asked.has(row.slNo) && value) out.set(row.slNo, value);
  }
  return out;
}

/**
 * Fill `generalDescription` on every item of a draft.
 *
 * Never leaves an item worse off than the deterministic seed the merge already
 * set: a model answer is taken only when it is shorter than the invoice
 * description (a general description that grew has added something the invoice
 * did not say) and within a sane length. Everything it changes is flagged with
 * the original, because the reviewer is the one who signs the declaration.
 *
 * A missing or failing model is not an error. The seed stands, and the exporter
 * falls back to the invoice description below that, so the column is never
 * blank.
 */
export async function enrichDraftDescriptions(draft: ChecklistDraft): Promise<ChecklistDraft> {
  const items = draft.items.map((it) => ({
    slNo: it.slNo,
    description: it.description,
    ritc: it.ritc,
  }));

  let proposed: Map<number, string>;
  try {
    proposed = await describeGoodsGenerically(items);
  } catch {
    return draft; // no model available — the deterministic seed stands
  }

  for (const [idx, item] of draft.items.entries()) {
    const value = proposed.get(item.slNo);
    if (!value || value.length > MAX_LENGTH) continue;
    if (value === item.description || value === item.generalDescription) continue;
    // Longer than the invoice line means the model elaborated rather than
    // generalised, and an elaboration is a declaration we cannot evidence.
    if (value.length > item.description.length) continue;
    item.generalDescription = value;
    draft.flags.push({
      severity: 'info',
      path: `items.${idx}.generalDescription`,
      message:
        `General description "${value}" derived from the invoice line ` +
        `"${item.description}" — verify it names the same goods.`,
    });
  }
  return draft;
}

/** The deterministic half, re-exported so callers can seed without a model. */
export { tradeDescription };
