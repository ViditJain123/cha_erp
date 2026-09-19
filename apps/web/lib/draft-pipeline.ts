import 'server-only';
import {
  enrichDraftDescriptions,
  enrichDraftClassification,
  enrichDraftFromLibrary,
  enrichDraftFromNotifications,
  runPipeline,
  type ChecklistDraft,
  type GstTaxInvoiceExtract,
  type IntoBondBeExtract,
} from '@checklist/extraction';
import { applyContainerResolution } from './containers';
import { applyExchangeRateResolution } from './exchange-rates';
import { applyGeneralResolution } from './general';
import { applyInbondExbondResolution } from './inbond';
import { applySecuritiesResolution } from './securities';
import { applyItemResolution } from './items';
import { applyPartyResolution } from './parties';
import { recomputeDuty } from './recompute';

export interface DraftPipelineFile {
  fileName: string;
  pdf: Buffer;
  /** The stored media type, so a photographed document is sent as one. */
  mimeType?: string;
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
 *   2. `enrichDraftClassification` answers the one question no document does:
 *      which tariff item goods with no usable HS code are. It runs first among
 *      the enrichments because every later step keys off the CTH, and it is the
 *      only step that can work from the goods description alone. Its candidates
 *      are real rows of the printed First Schedule reached through that
 *      tariff's own alphabetical product index, so the model picks between
 *      tariff items rather than proposing a code.
 *   3. `enrichDraftFromLibrary` fills tariff data the masters do not carry, by
 *      searching the CBIC tariff — this can set duty rates on items. It follows
 *      the classification step, which answers from an exact tariff row where it
 *      can; retrieved prose is the weaker source and only handles what is left.
 *   4. `enrichDraftDescriptions` turns each invoice line into the general
 *      description the ITEMS sheet asks for, dropping the manufacturer's grade
 *      code. It runs before the notification step because that step passes the
 *      general description to the model as context for the duty choice, so a
 *      cleaned one makes a better choice.
 *   5. `enrichDraftFromNotifications` settles what the notification masters
 *      narrowed but could not decide: which IGST schedule entry describes the
 *      goods, and whether a BCD concession in 45/2025-Customs applies. It needs
 *      the item's CTH, so it follows the library step that can supply one.
 *   6. `recomputeDuty` therefore has to run last, or the totals will not
 *      reflect what enrichment just added.
 *   7. `applyPartyResolution` binds the importer and supplier to the company's
 *      organization repository, replacing the names read off the documents
 *      with the ones Logi-Sys holds. It needs a company and a database, which
 *      is why it is here and not inside the merge. It may adjust insurance
 *      from the importer's marine open policy, and recomputes duty itself when
 *      it does.
 *
 *   8. `applyGeneralResolution` fills the Bill of Entry header — the GENERAL
 *      sheet. It runs last because it needs the bound importer for the AEO
 *      status, the AD codes and the reference policy, and it needs the job to
 *      find the customer's mail thread. Thirteen of that sheet's columns used
 *      to be constants in code; this is where they get an actual source.
 *
 *  8b. `applyExchangeRateResolution` re-values the draft at the rate of exchange
 *      the filing date actually carries. It has to follow the header, because
 *      the header is where the Bill of Entry date and the entry-inwards date
 *      are settled, and it has to precede everything below, because every step
 *      after it recomputes duty off `invoiceMeta.exchangeRates`. The merge can
 *      only seed a provisional table from the day it ran — section 14 fixes the
 *      rate by the date of presentation, which no shipping document states.
 *
 *   9. `applyContainerResolution` settles the container list — the CONTAINERS
 *      sheet. The merge reads it off the bills of lading; this adds the numbers
 *      ingest saw on the attachments when they arrived, and lets an operator's
 *      own list replace both. It runs here rather than in the merge for the
 *      same reason as the two steps above: it needs the job and the database,
 *      and it must be re-applied every time the documents are read again or a
 *      corrected list would be lost on the next reading.
 *
 *   9b. `applyItemResolution` settles the ITEMS sheet: the importer's product
 *      master, the mail's end use and FTA answer, the duty masters for the CTH
 *      as it finally stands, and the operator's own edits to the lines. After
 *      the header, because the mail instructions are read there; before the
 *      ex-bond step, which rescales the items it settles.
 *
 *  10. `applyInbondExbondResolution` fills the warehousing block — the
 *      INBOND_EXBOND sheet. It runs after the header because everything on that
 *      sheet is conditional on the BE type the header settles, and for a
 *      home-consumption BE it does nothing at all. On a partial ex-bond release
 *      it also rescales the items to the portion being cleared and recomputes
 *      duty, because an ex-bond Bill of Entry declares what leaves the
 *      warehouse rather than what went into it.
 *
 *  11. `applySecuritiesResolution` fills the three sheets whose sources only a
 *      person holds — the high-seas chain (HSS), the bonds and certificates
 *      lodged with Customs (BONDS_CERTIFICATES), and the eSanchit IRNs that
 *      make SUPPORTING_DOCS filable. Last, because the warehouse bond it picks
 *      up comes off the block the step above settles.
 *
 * `companyId` is optional only for the legacy single-tenant path, which has no
 * company and therefore no repository to resolve against. `jobId` is optional
 * for the same reason — without one there is no mail thread and no operator
 * entries, so the header stays unresolved and the export warns rather than
 * inventing values.
 *
 * Expensive: one model call per document, plus one over the mail thread.
 * Callers should run it in the worker or a long-lived route, never inline in a
 * request a user is waiting on.
 */
export async function buildDraftFromDocuments(
  files: DraftPipelineFile[],
  companyId?: string,
  jobId?: string,
): Promise<{ draft: ChecklistDraft; docs: Awaited<ReturnType<typeof runPipeline>>['docs'] }> {
  const { draft, docs } = await runPipeline(files);
  const enriched = recomputeDuty(
    await enrichDraftFromNotifications(
      await enrichDraftDescriptions(
        await enrichDraftFromLibrary(await enrichDraftClassification(draft)),
      ),
    ),
  );
  if (!companyId) return { draft: enriched, docs };

  const bound = await applyPartyResolution(enriched, companyId);
  if (!jobId) return { draft: bound, docs };

  return { draft: await applyJobResolution(bound, docs, companyId, jobId), docs };
}

/**
 * Steps 8–11 above: everything that comes off the job rather than off a
 * document — the header, the containers, the lines, the warehousing block and
 * the securities.
 *
 * Separate from the reading because it is the cheap half. Nothing here calls a
 * model except the one pass over the mail thread, which is cached, so a draft
 * can be re-resolved as often as an operator changes their mind: pick a custom
 * house, confirm a classification, name the AD code, and the stored draft
 * catches up without paying to read the documents again. `applyItemResolution`
 * was already being used that way on its own from the items panel; a header
 * decision needs the whole tail, and this is it.
 */
export async function applyJobResolution(
  draft: ChecklistDraft,
  docs: Awaited<ReturnType<typeof runPipeline>>['docs'],
  companyId: string,
  jobId: string,
): Promise<ChecklistDraft> {
  const withHeader = await applyItemResolution(
    await applyContainerResolution(
      await applyExchangeRateResolution(
        await applyGeneralResolution(draft, companyId, jobId),
        companyId,
        jobId,
      ),
      companyId,
      jobId,
    ),
    companyId,
    jobId,
  );
  const intoBond = docs.find((d) => d.docType === 'into_bond_be')?.data as
    | IntoBondBeExtract
    | undefined;

  // Every GST tax invoice attached, not just the first: a section 65 clearance
  // routinely covers several, and each one is a separate declaration.
  const gstInvoices = docs
    .filter((d) => d.docType === 'gst_tax_invoice')
    .map((d) => d.data as GstTaxInvoiceExtract | null)
    .filter((d): d is GstTaxInvoiceExtract => d !== null);

  return applySecuritiesResolution({
    draft: await applyInbondExbondResolution({
      draft: withHeader,
      companyId,
      jobId,
      intoBond,
      gstInvoices,
    }),
    companyId,
    jobId,
  });
}
