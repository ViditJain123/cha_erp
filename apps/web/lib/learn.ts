import {
  lookupTariff,
  normalizeMemoryKeys,
  upsertImporter,
  upsertProductMemory,
  upsertTariff,
} from '@checklist/core';
import type { ChecklistDraft } from '@checklist/extraction';

/**
 * Self-improvement: every approved job teaches the masters —
 * new importers, importer+product → RITC memory, and tariff rows the
 * reviewer had to fill by hand. The next job with the same importer or
 * product auto-fills.
 */
export function learnFromApprovedJob(draft: ChecklistDraft, jobNumber: string): string[] {
  const learned: string[] = [];

  if (!draft.importer.matchedFromMasters && draft.importer.name && (draft.importer.gstin || draft.importer.iec)) {
    upsertImporter({
      name: draft.importer.name,
      aliases: [],
      iec: draft.importer.iec ?? '',
      pan: draft.importer.pan ?? '',
      gstin: draft.importer.gstin ?? '',
      gstStateCode: draft.importer.gstStateCode ?? (draft.importer.gstin?.slice(0, 2) ?? ''),
      gstStateName: draft.importer.gstStateName ?? '',
      adCode: draft.importer.adCode ?? '',
      branchSno: draft.importer.branchSno ?? '0',
      address: draft.importer.addressLines,
      city: '',
      state: draft.importer.gstStateName ?? '',
    });
    learned.push(`importer "${draft.importer.name}"`);
  }

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
