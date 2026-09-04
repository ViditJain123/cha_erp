import { z } from 'zod';
import {
  bcdConditionTexts,
  bcdExemptionMatches,
  bcdExemptionNotification,
  compCessForCth,
  compCessMatches,
  igstRateForCth,
  igstScheduleMatches,
  isStale,
  type BcdExemptionEntry,
  type CompCessEntry,
  type IgstScheduleEntry,
} from '@checklist/core';
import { MODELS, structuredTextCall } from './openai.js';
import type { ChecklistDraft } from './draft.js';

/**
 * The half of a duty rate that a code lookup cannot settle.
 *
 * Both standing notifications are indexed by tariff code *and* description, and
 * the description is often the whole difference: heading 1702 is 5% as jaggery
 * and 18% as lactose, and every BCD concession in 45/2025-Customs is written
 * for particular goods put to a particular use. `masters/index.ts` narrows a
 * CTH to the entries that could apply; this asks the model which of them the
 * goods on the invoice actually are.
 *
 * It only ever chooses between entries the masters produced — the model cannot
 * invent a rate, a serial or a notification — and it is called only when there
 * is something to choose. Everything it decides is flagged for the reviewer.
 */

/** Entries offered to the model. Beyond this the list is noise, not choice. */
const CANDIDATES = 8;

const ChoiceSchema = z.object({
  /** Index into the IGST candidate list, or null when none of them describes the goods. */
  igstIndex: z.number().nullable(),
  igstReason: z.string(),
  /** Index into the BCD candidate list, or null when no concession applies. */
  bcdIndex: z.number().nullable(),
  bcdReason: z.string(),
  /** Index into the compensation cess candidate list, or null when none describes the goods. */
  compCessIndex: z.number().nullable(),
  compCessReason: z.string(),
});

export interface NotificationChoice {
  igst?: { entry: IgstScheduleEntry; reason: string };
  bcd?: { entry: BcdExemptionEntry; reason: string };
  compCess?: { entry: CompCessEntry; reason: string };
}

function igstCandidateText(entries: IgstScheduleEntry[]): string {
  return entries
    .map((e, i) => `[${i}] ${e.rate}% — Schedule ${e.schedule} S.No. ${e.serial}, codes "${e.spec}": ${e.description}`)
    .join('\n');
}

function compCessCandidateText(entries: CompCessEntry[]): string {
  return entries
    .map((e, i) => `[${i}] cess ${e.rateText} — S.No. ${e.serial}, codes "${e.spec}": ${e.description}`)
    .join('\n');
}

function bcdCandidateText(entries: BcdExemptionEntry[]): string {
  return entries
    .map((e, i) => {
      const conditions = bcdConditionTexts(e)
        .map((text) => text.slice(0, 400))
        .join(' / ');
      return (
        `[${i}] BCD ${e.bcdRateText} — Table ${e.table} S.No. ${e.serial}, codes "${e.spec}": ${e.description.slice(0, 600)}` +
        (conditions ? `\n    condition ${e.condition}: ${conditions}` : '\n    no condition')
      );
    })
    .join('\n');
}

/**
 * Which notification entries apply to one item, when more than one could.
 *
 * Returns nothing at all rather than a guess: an item whose candidates are
 * unambiguous never reaches the model, and a model that finds no entry fitting
 * the goods says so.
 */
export async function chooseNotificationEntries(item: {
  ritc: string;
  description: string;
  /** Trade description / end use, where the documents gave one. */
  context?: string;
}): Promise<NotificationChoice> {
  const igstCandidates = igstScheduleMatches(item.ritc).slice(0, CANDIDATES);
  const bcdCandidates = bcdExemptionMatches(item.ritc).slice(0, CANDIDATES);
  // Only the entries that actually name the code. The residual S.No. 56 covers
  // every CTH and describes no goods, so offering it as a candidate would
  // invite the model to "choose" the answer the lookup already gives for free.
  const cessCandidates = compCessMatches(item.ritc)
    .filter((e) => !e.anyChapter)
    .slice(0, CANDIDATES);
  if (!igstCandidates.length && !bcdCandidates.length && !cessCandidates.length) return {};

  const choice = await structuredTextCall({
    schema: ChoiceSchema,
    schemaName: 'notification_choice',
    system: `You are an Indian customs broker deciding which entries of two standing CBIC notifications apply to one line of an import invoice.

IGST candidates come from notification 9/2025-Integrated Tax (Rate), which sets the IGST rate. Every candidate already covers the item's tariff code; pick the one whose *description* is the goods. Qualifiers are decisive: "pre-packaged and labelled", "other than fresh", "for household use". If none describes these goods, answer null — the residual entry (18%) then applies, and saying so is better than picking a description that does not fit.

BCD candidates come from notification 45/2025-Customs, which gives a concessional basic customs duty to particular goods, almost always subject to a condition (an end-use undertaking, an importer registration, a certificate). Pick one ONLY if the goods plainly are what the entry describes; if the entry names an end use or an importer type that the invoice does not establish, answer null. A wrong concession claimed on a Bill of Entry is a penalty, a missed one is a refund claim — so when in doubt, null.

Compensation cess candidates come from notification 1/2017-Compensation Cess (Rate), which levies a cess on tobacco, coal, aerated waters and motor vehicles on top of IGST. Entries at the same tariff code are separated by their description alone — whether the goods bear a brand name, whether a cigarette has a filter and how long it is, what drives a car and how long it is — so pick the one the invoice establishes and answer null when it does not establish one. Goods that none of these entries describes bear no cess, and the residual entry already says so; null is the right answer for them.

Reasons: one sentence, quoting the words of the entry that decided it.`,
    userText:
      `Item: ${item.description}\nCTH: ${item.ritc}\n${item.context ? `Other details: ${item.context}\n` : ''}` +
      `\nIGST candidates:\n${igstCandidates.length ? igstCandidateText(igstCandidates) : '(none)'}` +
      `\n\nBCD candidates:\n${bcdCandidates.length ? bcdCandidateText(bcdCandidates) : '(none)'}` +
      `\n\nCompensation cess candidates:\n${cessCandidates.length ? compCessCandidateText(cessCandidates) : '(none)'}`,
    model: MODELS.extract,
  });

  const igstEntry = choice.igstIndex == null ? undefined : igstCandidates[choice.igstIndex];
  const bcdEntry = choice.bcdIndex == null ? undefined : bcdCandidates[choice.bcdIndex];
  const cessEntry = choice.compCessIndex == null ? undefined : cessCandidates[choice.compCessIndex];
  return {
    ...(igstEntry && { igst: { entry: igstEntry, reason: choice.igstReason } }),
    ...(bcdEntry && { bcd: { entry: bcdEntry, reason: choice.bcdReason } }),
    ...(cessEntry && { compCess: { entry: cessEntry, reason: choice.compCessReason } }),
  };
}

/**
 * Post-merge enrichment: settle the notification entries the code lookup left
 * open, item by item.
 *
 * Runs the model only where a choice exists — several IGST or compensation cess
 * entries at the same specificity naming different rates, or any BCD concession
 * that could cover the code. Items the masters already priced from a tariff
 * row, and items carrying an FTA claim (whose BCD comes from the trade
 * agreement, not from 45/2025), are left alone.
 */
export async function enrichDraftFromNotifications(draft: ChecklistDraft): Promise<ChecklistDraft> {
  for (const [idx, item] of draft.items.entries()) {
    if (!/^\d{8}$/.test(item.ritc)) continue;

    const igst = igstRateForCth(item.ritc);
    const bcdCandidates = item.bcdExemption ? [] : bcdExemptionMatches(item.ritc);
    const igstOpen = Boolean(igst && !igst.residual && igst.alternatives.length);
    // Same test on the cess side: the merge left the serial blank because two
    // entries name this code, and only the goods description separates them.
    const cess = compCessForCth(item.ritc);
    const cessOpen = Boolean(cess && !cess.residual && cess.alternatives.length);
    if (!igstOpen && !cessOpen && !bcdCandidates.length) continue;

    let choice: NotificationChoice;
    try {
      choice = await chooseNotificationEntries({
        ritc: item.ritc,
        description: item.description,
        ...(item.generalDescription ? { context: item.generalDescription } : {}),
      });
    } catch {
      continue; // no model available — the deterministic flags from the merge stand
    }

    if (igstOpen && choice.igst) {
      const entry = choice.igst.entry;
      item.igstRate = entry.rate;
      item.igstNotification = igst!.notification;
      item.notificationSerials = { ...item.notificationSerials, igst: `${entry.schedule}${entry.serial}` };
      draft.flags.push({
        severity: 'warning',
        path: `items.${idx}.igstRate`,
        message:
          `IGST ${entry.rate}% chosen from notification ${igst!.notification} Schedule ${entry.schedule} ` +
          `S.No. ${entry.serial} (p.${entry.page}): ${choice.igst.reason} — verify against the goods.`,
      });
    }

    if (cessOpen && choice.compCess) {
      const entry = choice.compCess.entry;
      item.compCessNotification = cess!.notification;
      item.notificationSerials = { ...item.notificationSerials, compCess: entry.serial };
      // Only an ad valorem rate can be applied. A specific or compound cess
      // still gets its serial — that part is now settled — but the amount is
      // typed in by hand, because computeItemDuty has no way to express it.
      if (entry.rate != null) item.compCessRate = entry.rate;
      draft.flags.push({
        severity: entry.rate == null ? 'error' : 'warning',
        path: `items.${idx}.compCessRate`,
        message:
          `Compensation cess "${entry.rateText}" chosen from notification ${cess!.notification} ` +
          `S.No. ${entry.serial} (p.${entry.page}): ${choice.compCess.reason}` +
          (entry.rate == null
            ? ' — the rate is specific or compound; enter the cess amount by hand.'
            : ' — verify against the goods.') +
          ` ${cess!.unappliedAmendments.length} notifications amending 1/2017 are not folded into ` +
          'these masters — read them before claiming this rate.',
      });
    }

    if (choice.bcd) {
      const entry = choice.bcd.entry;
      // A stale entry has been overtaken by an amendment we could not apply,
      // so the rate we hold was read from text that is no longer in force.
      // Propose it — it is still the best evidence of what the concession was —
      // but never file it.
      const applied = entry.bcdRate != null && !isStale(entry);
      if (applied) {
        item.bcdRate = entry.bcdRate!;
        item.bcdNotification = bcdExemptionNotification();
        item.notificationSerials = { ...item.notificationSerials, basic: entry.serial };
      }
      draft.flags.push({
        severity: 'warning',
        path: `items.${idx}.bcdRate`,
        message:
          `${applied ? `BCD ${entry.bcdRate}% applied from` : `BCD concession proposed from`} notification ` +
          `${bcdExemptionNotification()} Table ${entry.table} S.No. ${entry.serial} (p.${entry.page}), ` +
          `rate "${entry.bcdRateText}"${entry.condition ? `, condition ${entry.condition}` : ', unconditional'}: ` +
          `${choice.bcd.reason} — confirm the goods meet the description${entry.condition ? ' and the condition' : ''} before filing.` +
          (isStale(entry)
            ? ` NOT APPLIED: ${entry.staleBy!.join(', ')} amend this entry and have not been folded into the masters — read the amendment before claiming it.`
            : ''),
      });
    }
  }
  return draft;
}
