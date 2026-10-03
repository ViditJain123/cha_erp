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
  lookupTariff,
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

// Reason before index, on every line. Structured output is produced in field
// order, so with the index first the model committed to an entry and then
// wrote a reason for it — and three corpus jobs came back with a serial whose
// own reason said the condition was not met. Writing the reason first makes
// the index a conclusion of it rather than the other way round.
const ChoiceSchema = z.object({
  igstReason: z.string(),
  /** Index into the IGST candidate list, or null when none of them describes the goods. */
  igstIndex: z.number().nullable(),
  bcdReason: z.string(),
  /** Index into the BCD candidate list, or null when no concession applies. */
  bcdIndex: z.number().nullable(),
  compCessReason: z.string(),
  /** Index into the compensation cess candidate list, or null when none describes the goods. */
  compCessIndex: z.number().nullable(),
});

export interface NotificationChoice {
  igst?: { entry: IgstScheduleEntry; reason: string };
  bcd?: { entry: BcdExemptionEntry; reason: string };
  compCess?: { entry: CompCessEntry; reason: string };
  /**
   * A BCD entry the model picked and, in the same breath, said does not apply.
   * Kept so the reviewer sees what was considered; never applied.
   */
  bcdRefused?: { entry: BcdExemptionEntry; reason: string };
}

/**
 * Whether a reason for choosing a concession actually argues against it.
 *
 * ex_job21: "limited to goods imported by a 'specified person' … which the
 * invoice does not establish" — filed. ex_job26: "does not identify the
 * hydrogen plant as a List 12 good" — filed. liv_job1: "which the invoice does
 * not establish" — filed. A reason that says the condition is not met is a
 * null answer whatever index sits beside it.
 */
export function bcdReasonRefuses(reason: string): boolean {
  return /\b(does not|doesn't|do not|don't|cannot|can't|not|never|nothing)\s+(\w+\s+){0,3}(establish|confirm|identif|show|state|demonstrat|indicat|support|evidenc|meet|satisf)|no evidence|not evident|unclear|unknown whether|not established|not met|cannot be confirmed|insufficient/i.test(
    reason,
  );
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
export async function chooseNotificationEntries(
  item: {
    ritc: string;
    description: string;
    /** Trade description / end use, where the documents gave one. */
    context?: string;
  },
  opts?: { filingDate?: string },
): Promise<NotificationChoice> {
  const igstCandidates = igstScheduleMatches(item.ritc).slice(0, CANDIDATES);
  // Only what is in force on the day the Bill of Entry is presented. Undated,
  // the table is offered whole — but a lapsed proviso is not a choice.
  const bcdCandidates = bcdExemptionMatches(item.ritc, {
    ...(opts?.filingDate && { onIsoDate: opts.filingDate }),
  }).slice(0, CANDIDATES);

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
  const bcdPicked = choice.bcdIndex == null ? undefined : bcdCandidates[choice.bcdIndex];
  const bcdRefused = bcdPicked && bcdReasonRefuses(choice.bcdReason);
  const bcdEntry = bcdRefused ? undefined : bcdPicked;
  const cessEntry = choice.compCessIndex == null ? undefined : cessCandidates[choice.compCessIndex];
  return {
    ...(igstEntry && { igst: { entry: igstEntry, reason: choice.igstReason } }),
    ...(bcdEntry && { bcd: { entry: bcdEntry, reason: choice.bcdReason } }),
    ...(bcdRefused && bcdPicked && { bcdRefused: { entry: bcdPicked, reason: choice.bcdReason } }),
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
export async function enrichDraftFromNotifications(
  draft: ChecklistDraft,
  opts?: { filingDate?: string },
): Promise<ChecklistDraft> {
  // The day the Bill of Entry is presented decides which notifications are in
  // force. The header's date when a person has set one, else the caller's
  // (the mail thread's date on the corpus), else today.
  const filingDate =
    draft.shipment.beFilingDate ?? opts?.filingDate ?? new Date().toISOString().slice(0, 10);

  for (const [idx, item] of draft.items.entries()) {
    if (!/^\d{8}$/.test(item.ritc)) continue;

    const igst = igstRateForCth(item.ritc, { onIsoDate: filingDate });
    // A filing dated before 9/2025 took effect is assessed under 1/2017-IT(R),
    // whose schedule is not parsed. The number is corrected here; the serial
    // cannot be, and the line says so rather than carrying the new schedule's.
    if (igst && !igst.scheduleKnown) {
      item.igstNotification = igst.notification;
      if (item.notificationSerials?.igst) {
        const { igst: _serial, ...rest } = item.notificationSerials;
        item.notificationSerials = rest;
      }
      draft.flags.push({
        severity: 'error',
        path: `items.${idx}.igstRate`,
        message:
          `This Bill of Entry is dated ${filingDate}, before 9/2025-IT(R) took effect, so IGST is under ` +
          `${igst.notification} — whose schedule the masters do not hold. Read the serial off 1/2017-IT(R) ` +
          `and confirm the rate (${igst.rate}% is the current schedule's answer for CTH ${item.ritc}).`,
      });
    }

    // A re-import claims its relief on the RE-IMPORT sheet and nowhere else:
    // 45/2017 exempts the duty on goods coming home, and a 45/2025 concession
    // filed beside it claims the same relief twice. The exporter refuses that
    // pairing, which is right — but the pairing should never be proposed, and
    // it was: ex_job3 came back with a re-import row and a basic-duty
    // notification, and the job could not be filed at all.
    const bcdCandidates =
      item.bcdExemption || item.reImport ? [] : bcdExemptionMatches(item.ritc, { onIsoDate: filingDate });
    const igstOpen = Boolean(igst && igst.scheduleKnown && !igst.residual && igst.alternatives.length);

    // Same test on the cess side: the merge left the serial blank because two
    // entries name this code, and only the goods description separates them.
    const cess = compCessForCth(item.ritc);
    const cessOpen = Boolean(cess && !cess.residual && cess.alternatives.length);
    if (!igstOpen && !cessOpen && !bcdCandidates.length) continue;

    let choice: NotificationChoice;
    try {
      choice = await chooseNotificationEntries(
        {
          ritc: item.ritc,
          description: item.description,
          ...(item.generalDescription ? { context: item.generalDescription } : {}),
        },
        { filingDate },
      );
    } catch {
      continue; // no model available — the deterministic flags from the merge stand
    }

    if (choice.bcdRefused) {
      const entry = choice.bcdRefused.entry;
      draft.flags.push({
        severity: 'info',
        path: `items.${idx}.bcdRate`,
        message:
          `BCD concession ${bcdExemptionNotification()} Table ${entry.table} S.No. ${entry.serial} was considered and ` +
          `NOT applied — the reasoning says the goods do not meet it: ${choice.bcdRefused.reason}`,
      });
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
      // The printed tariff names the concession it expects against this code —
      // "Ntfn 45/2025-Cus. - Sl No.24" in the REMARKS column. Where it does,
      // the model's choice has an independent second opinion, and saying which
      // way it went turns "verify against the goods" from a standing
      // instruction into a specific one. The book is never allowed to pick:
      // its serial is corroboration or a discrepancy, never the answer.
      const printed = lookupTariff(item.ritc)?.notificationRefs?.find(
        (r) => r.notification === bcdExemptionNotification() && r.serial,
      );
      const corroboration = !printed
        ? ''
        : printed.serial === entry.serial
          ? ` The printed tariff cites the same entry (S.No. ${printed.serial}), which is independent agreement.`
          : ` The printed tariff cites S.No. ${printed.serial} for this code instead — one of the two is wrong about these goods.`;
      // A stale entry has been overtaken by an amendment we could not apply,
      // so the rate we hold was read from text that is no longer in force.
      // Propose it — it is still the best evidence of what the concession was —
      // but never file it.
      const applied = entry.bcdRate != null && !isStale(entry, filingDate);
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
          corroboration +
          (isStale(entry, filingDate)
            ? ` NOT APPLIED: ${entry.staleBy!.join(', ')} amend this entry and have not been folded into the masters — read the amendment before claiming it.`
            : ''),
      });
    }
  }
  return draft;
}
