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
export function learnFromApprovedJob(draft: ChecklistDraft, jobNumber: string): string[] {
  const learned: string[] = [];

  for (const item of draft.items) {
    if (!/^\d{8}$/.test(item.ritc)) continue;

    if (!lookupTariff(item.ritc) && (item.bcdRate > 0 || item.igstRate > 0)) {
      upsertTariff({
        cth: item.ritc,
        description: item.description.slice(0, 80),
        bcdRate: item.bcdRate,
        unit: item.unit,
        igstRate: item.igstRate,
        igstNotification: item.igstNotification ?? '',
        aidcRate: item.aidcRate,
        aidcNotification: item.aidcNotification ?? '',
        compCessRate: item.compCessRate,
        compCessNotification: item.compCessNotification ?? '',
      });
      learned.push(`tariff row ${item.ritc}`);
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
