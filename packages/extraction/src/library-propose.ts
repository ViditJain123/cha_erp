import { z } from 'zod';
import { searchLibrary } from '@checklist/library';
import { MODELS, structuredTextCall } from './openai.js';
import type { ChecklistDraft } from './draft.js';

/**
 * "RAG proposes, masters dispose": when the tariff masters have no row for an
 * item's CTH, retrieve the relevant working-tariff pages from the official
 * document library and let the model propose a tariff row — always with a
 * citation, always subject to reviewer approval.
 */

const TariffProposalSchema = z.object({
  found: z.boolean(),
  cth: z.string().nullable(),
  tariffDescription: z.string().nullable(),
  /** standard/scheduled BCD rate % as printed in the tariff schedule */
  bcdRateStandard: z.number().nullable(),
  unit: z.string().nullable(),
  reasoning: z.string(),
});

export interface TariffProposal {
  cth: string;
  tariffDescription: string;
  bcdRateStandard: number | null;
  unit: string | null;
  citation: { title: string; page: number; sourceUrl: string };
}

export async function proposeTariffFromLibrary(item: {
  ritc?: string;
  description: string;
}): Promise<TariffProposal | null> {
  const hits = await searchLibrary(`${item.ritc ?? ''} ${item.description}`.trim(), {
    topK: 5,
    docIdPrefix: 'tariff',
  });
  if (!hits.length) return null;

  const context = hits
    .map((h, i) => `[${i}] ${h.title}, page ${h.page}:\n${h.text}`)
    .join('\n\n');

  const proposal = await structuredTextCall({
    schema: TariffProposalSchema.extend({ citationIndex: z.number().nullable() }),
    schemaName: 'tariff_proposal',
    system: `You are reading excerpts of the official Indian Customs Tariff (First Schedule). Given a product, identify the applicable 8-digit tariff item (CTH), its description, unit and the standard rate of duty printed in the schedule.
Only answer from the excerpts — if they do not contain the applicable tariff item, set found=false. Do not guess rates. citationIndex: which excerpt number the answer comes from.`,
    userText: `Product: ${item.description}\nHS/CTH hint: ${item.ritc ?? 'unknown'}\n\nTariff excerpts:\n${context}`,
    model: MODELS.extract,
  });

  if (!proposal.found || !proposal.cth) return null;
  const hit = hits[proposal.citationIndex ?? 0] ?? hits[0]!;
  return {
    cth: proposal.cth.replace(/\D/g, '').slice(0, 8),
    tariffDescription: proposal.tariffDescription ?? '',
    bcdRateStandard: proposal.bcdRateStandard,
    unit: proposal.unit,
    citation: { title: hit.title, page: hit.page, sourceUrl: hit.sourceUrl },
  };
}

/**
 * Post-merge enrichment: try a library proposal for every item the masters
 * could not price. Prefills the item (reviewer still approves) and swaps the
 * blocking error flag for a citation-carrying warning.
 */
export async function enrichDraftFromLibrary(draft: ChecklistDraft): Promise<ChecklistDraft> {
  for (const [idx, item] of draft.items.entries()) {
    const path = `items.${idx}.ritc`;
    const blocking = draft.flags.find((f) => f.severity === 'error' && f.path === path);
    if (!blocking) continue;

    let proposal: TariffProposal | null = null;
    try {
      proposal = await proposeTariffFromLibrary({ ritc: item.ritc, description: item.description });
    } catch {
      continue; // library not seeded / no index — keep the original error flag
    }
    if (!proposal) continue;

    if (!item.ritc && proposal.cth.length === 8) item.ritc = proposal.cth;
    if (item.bcdRate === 0 && proposal.bcdRateStandard != null) item.bcdRate = proposal.bcdRateStandard;

    draft.flags = draft.flags.filter((f) => f !== blocking);
    draft.flags.push({
      severity: 'warning',
      path,
      message:
        `Library proposal: CTH ${proposal.cth} "${proposal.tariffDescription.slice(0, 60)}" ` +
        `standard BCD ${proposal.bcdRateStandard ?? '?'}% — from ${proposal.citation.title}, p.${proposal.citation.page}. ` +
        `Verify current effective rate/notification (schedule rates can be amended by later notifications, and 45/2025-Customs may cut it further). IGST comes from the 9/2025-IT(R) masters.`,
    });
  }
  return draft;
}
