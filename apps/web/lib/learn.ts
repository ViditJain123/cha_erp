import {
  lookupTariff,
  normalizeMemoryKeys,
  upsertProductMemory,
  upsertTariff,
} from '@checklist/core';
import type { ChecklistDraft } from '@checklist/extraction';

/**
 * Self-improvement: every approved job teaches the masters —
 * importer+product → RITC memory, and tariff rows the reviewer had to fill by
 * hand. The next job with the same importer or product auto-fills.
 *
 * Importers are deliberately not learned. The party master is the Organization
 * Repository the company uploads out of Logi-Sys, and Logi-Sys resolves its
 * parties on the exact name it holds — so a row invented from a bill of lading
 * would be a name Logi-Sys does not know, which is the problem the repository
 * exists to solve. A missing party is added in Logi-Sys and re-uploaded.
 */
type DraftItem = ChecklistDraft['items'][number];

/**
 * Whether an approved line teaches the tariff master anything, and why.
 *
 * This used to be "learn when the master has no row for the CTH", written when
 * the master held three rows and nearly every line missed. Against the ~12,000
 * rows of the printed tariff it almost never misses, so that rule quietly
 * stopped learning — including the reviewer corrections that are the whole
 * point of learning. So the question is now what the job knows that the master
 * does not.
 *
 * - **No row at all** — as before.
 * - **The book's row is unverified** — its rates did not reconcile on the scan,
 *   and a job a person approved is exactly the confirmation it lacks.
 * - **The reviewer's rate differs from the book's** — a correction.
 *
 * What never counts as a correction is a concession. An approved line's BCD is
 * very often not the tariff rate at all: 39021000 is 7.5% in the tariff and
 * job I-13844 paid 0% under the India-Japan CEPA. Writing that 0% into the
 * master would give every later importer of polypropylene a concession they
 * have not claimed. A line carrying an exemption claim or a BCD notification
 * teaches nothing about BCD. IGST is compared regardless: the pipeline sets it
 * from the rate schedule, so an approved difference is the reviewer's own.
 *
 * Rows a person wrote — the seed, earlier corrections — are left alone unless
 * the reviewer changed a rate; only the book's rows are ever "confirmed".
 */
function tariffLesson(
  item: DraftItem,
  master: ReturnType<typeof lookupTariff>,
): string | null {
  if (!master) {
    return item.bcdRate > 0 || item.igstRate > 0 ? 'new to the master' : null;
  }
  const concession = Boolean(item.bcdExemption || item.bcdNotification);
  const bcdChanged = !concession && item.bcdRate !== master.bcdRate;
  const igstChanged = item.igstRate !== master.igstRate;
  if (bcdChanged || igstChanged) {
    return [
      bcdChanged && `BCD ${master.bcdRate}% → ${item.bcdRate}%`,
      igstChanged && `IGST ${master.igstRate}% → ${item.igstRate}%`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  if (master.provenance?.source === 'book' && master.provenance.confidence === 'unverified') {
    return 'confirms an unverified row of the printed tariff';
  }
  return null;
}

export function learnFromApprovedJob(draft: ChecklistDraft, jobNumber: string): string[] {
  const learned: string[] = [];

  for (const item of draft.items) {
    if (!/^\d{8}$/.test(item.ritc)) continue;

    const master = lookupTariff(item.ritc);
    const reason = tariffLesson(item, master);
    if (reason) {
      upsertTariff({
        // Everything the master already knew about the line — policy, remarks,
        // notification references — survives; only the rates the reviewer
        // approved are taken from the job.
        ...master,
        cth: item.ritc,
        description: master?.description ?? item.description.slice(0, 80),
        unit: master?.unit || item.unit,
        bcdRate: item.bcdRate,
        igstRate: item.igstRate,
        igstNotification: item.igstNotification ?? master?.igstNotification ?? '',
        aidcRate: item.aidcRate,
        aidcNotification: item.aidcNotification ?? master?.aidcNotification ?? '',
        compCessRate: item.compCessRate,
        compCessNotification: item.compCessNotification ?? master?.compCessNotification ?? '',
        provenance: { source: 'learned', learnedFrom: jobNumber },
      });
      learned.push(`tariff row ${item.ritc} (${reason})`);
    }

    if (draft.importer.name) {
      upsertProductMemory({
        ...normalizeMemoryKeys(draft.importer.name, item.description),
        ritc: item.ritc,
        bcdRate: item.bcdRate,
        igstRate: item.igstRate,
        ...(item.igstNotification && { igstNotification: item.igstNotification }),
        ...(item.bcdNotification && { bcdNotification: item.bcdNotification }),
        learnedFrom: jobNumber,
        learnedAt: new Date().toISOString().slice(0, 10),
      });
    }
  }
  if (draft.items.some((i) => /^\d{8}$/.test(i.ritc)) && draft.importer.name) {
    learned.push(`product memory for ${draft.items.length} item(s)`);
  }
  return learned;
}
