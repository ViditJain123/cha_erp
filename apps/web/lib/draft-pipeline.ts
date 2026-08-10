import 'server-only';
import { enrichDraftFromLibrary, runPipeline, type ChecklistDraft } from '@checklist/extraction';
import { recomputeDuty } from './recompute';

export interface DraftPipelineFile {
  fileName: string;
  pdf: Buffer;
}

/**
 * Read a job's documents into a reviewable checklist draft.
 *
 * This chain — extract, enrich from the tariff library, recompute duty — was
 * only ever wired into the legacy filesystem app
 * (`app/api/legacy/jobs/route.ts`), which is why the ERP could open jobs but
 * never had the data to fill a Bill of Entry. Both callers now share it, so
 * the two paths cannot drift apart.
 *
 * Each step matters and the order is not arbitrary:
 *   1. `runPipeline` classifies and extracts each PDF, then merges them into a
 *      single draft, reconciling the fields that appear on more than one
 *      document.
 *   2. `enrichDraftFromLibrary` fills tariff data the masters do not carry, by
 *      searching the CBIC tariff — this can set duty rates on items.
 *   3. `recomputeDuty` therefore has to run last, or the totals will not
 *      reflect what enrichment just added.
 *
 * Expensive: one model call per document. Callers should run it in the worker
 * or a long-lived route, never inline in a request a user is waiting on.
 */
export async function buildDraftFromDocuments(
  files: DraftPipelineFile[],
): Promise<{ draft: ChecklistDraft; docs: Awaited<ReturnType<typeof runPipeline>>['docs'] }> {
  const { draft, docs } = await runPipeline(files);
  return { draft: recomputeDuty(await enrichDraftFromLibrary(draft)), docs };
}
