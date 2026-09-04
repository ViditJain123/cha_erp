import 'server-only';
import {
  enrichDraftDescriptions,
  enrichDraftFromLibrary,
  enrichDraftFromNotifications,
  runPipeline,
  type ChecklistDraft,
} from '@checklist/extraction';
import { applyPartyResolution } from './parties';
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
 *   3. `enrichDraftDescriptions` turns each invoice line into the general
 *      description the ITEMS sheet asks for, dropping the manufacturer's grade
 *      code. It runs before the notification step because that step passes the
 *      general description to the model as context for the duty choice, so a
 *      cleaned one makes a better choice.
 *   4. `enrichDraftFromNotifications` settles what the notification masters
 *      narrowed but could not decide: which IGST schedule entry describes the
 *      goods, and whether a BCD concession in 45/2025-Customs applies. It needs
 *      the item's CTH, so it follows the library step that can supply one.
 *   5. `recomputeDuty` therefore has to run last, or the totals will not
 *      reflect what enrichment just added.
 *   6. `applyPartyResolution` binds the importer and supplier to the company's
 *      organization repository, replacing the names read off the documents
 *      with the ones Logi-Sys holds. It needs a company and a database, which
 *      is why it is here and not inside the merge. It may adjust insurance
 *      from the importer's marine open policy, and recomputes duty itself when
 *      it does.
 *
 * `companyId` is optional only for the legacy single-tenant path, which has no
 * company and therefore no repository to resolve against.
 *
 * Expensive: one model call per document. Callers should run it in the worker
 * or a long-lived route, never inline in a request a user is waiting on.
 */
export async function buildDraftFromDocuments(
  files: DraftPipelineFile[],
  companyId?: string,
): Promise<{ draft: ChecklistDraft; docs: Awaited<ReturnType<typeof runPipeline>>['docs'] }> {
  const { draft, docs } = await runPipeline(files);
  const enriched = recomputeDuty(
    await enrichDraftFromNotifications(
      await enrichDraftDescriptions(await enrichDraftFromLibrary(draft)),
    ),
  );
  if (!companyId) return { draft: enriched, docs };
  return { draft: await applyPartyResolution(enriched, companyId), docs };
}
