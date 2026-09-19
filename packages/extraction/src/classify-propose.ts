import { z } from 'zod';
import {
  chapterNotes,
  lookupTariff,
  resolveTariffPrefix,
  searchProductIndex,
  tariffEdition,
  type TariffMaster,
} from '@checklist/core';
import { MODELS, structuredTextCall } from './openai.js';
import type { ChecklistDraft } from './draft.js';

/**
 * Which tariff item the goods are, when no document says.
 *
 * The extraction prompts forbid inferring an HS code from a goods description
 * — "a guessed code pulls in the wrong compliance requirements" — and that is
 * still right. This does not lift the ban; it removes the need for it. The
 * printed tariff carries an alphabetical index of ~13,000 product names
 * against the headings they classify under, so a description can be *looked
 * up* rather than guessed, and the model's job is reduced to picking which of
 * several real tariff items the goods are and saying why.
 *
 * The same discipline as notification-choose.ts: the candidate list is built by
 * the masters, the model returns an index into it, and it cannot emit a CTH of
 * its own. What it adds over library-propose.ts is that the candidates are
 * exact rows of the First Schedule rather than retrieved prose, so the rate and
 * the policy that come with the chosen code are the real ones.
 *
 * What it is not: a classification. The index is a finding aid that has not
 * read the Section and Chapter Notes, and under the General Interpretative
 * Rules those notes decide any contested heading. Everything here is a proposal
 * carrying a page citation, for a human to accept.
 */

/** Entries offered to the model. Beyond this the list is noise, not choice. */
const CANDIDATES = 10;

/**
 * Below this the lexical match is a coincidence — one common word shared with
 * a long index entry. Offering those wastes the choice and invites a pick.
 */
const MIN_SCORE = 0.8;

const ClassificationSchema = z.object({
  /**
   * Whether any candidate is these goods at all.
   *
   * Split out from `index` because asking only for an index invites a pick: the
   * model returned candidate 0 for a bulk pharmaceutical API while writing "none
   * of the offered 300490 items fits". Answering the question in its own field
   * makes "no" a thing it has to say rather than a thing it has to withhold.
   */
  fits: z.boolean(),
  /** Index into the candidate list. Ignored unless `fits`. */
  index: z.number().nullable(),
  /** One sentence, naming what in the description decided it. */
  reason: z.string(),
  /**
   * How sure, 0 to 1. Asked for explicitly because the honest answer is often
   * "this is the right heading but I cannot tell which sub-item", and a
   * reviewer needs to see that rather than a bare code.
   */
  confidence: z.number(),
});

export interface ClassificationCandidate {
  cth: string;
  /** The First Schedule description of the tariff item itself. */
  tariffDescription: string;
  unit: string;
  bcdRate: number;
  igstRate: number;
  impPolicy?: string;
  /** The index phrase that surfaced it, where it came from the index. */
  indexTerm?: string;
  citation: { volume: 1 | 3; page: number; edition: string };
}

export interface ClassificationProposal {
  candidate: ClassificationCandidate;
  reason: string;
  confidence: number;
  /** Everything that was offered, so a reviewer sees what was rejected. */
  consideredCth: string[];
}

/**
 * Which children of a heading to offer, when it has more than fit.
 *
 * Two things decide it. The ones whose own description shares a word with the
 * goods lead, because that is the only signal available before the model
 * reads anything. And the *last* child is always offered whatever its score,
 * because the tariff is written so that the final sub-item of a subheading is
 * its residual "Other" — the correct answer precisely when none of the
 * specific ones fits.
 *
 * Leaving the residual out is not a smaller list, it is a list with the right
 * answer removed. Heading 3004.90 has ninety-odd children; offering the first
 * ten in code order sent "Acetazolamide USP" a choice of Ayurvedic, Unani,
 * Siddha, Homoeopathic and four named antiprotozoals, and the model picked one
 * while writing that none of them fitted.
 */
function shortlist(rows: TariffMaster[], description: string): TariffMaster[] {
  if (rows.length <= CANDIDATES) return rows;
  const wanted = new Set(
    description.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4),
  );
  const scored = rows.map((row, i) => {
    const words = row.description.toLowerCase().split(/[^a-z0-9]+/);
    return { row, i, hits: words.filter((w) => wanted.has(w)).length };
  });
  const residual = rows[rows.length - 1]!;
  const picked = scored
    .filter((s) => s.row !== residual)
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .slice(0, CANDIDATES - 1)
    .sort((a, b) => a.i - b.i)
    .map((s) => s.row);
  return [...picked, residual];
}

function toCandidate(row: TariffMaster, indexTerm?: string): ClassificationCandidate {
  return {
    cth: row.cth,
    tariffDescription: row.description,
    unit: row.unit,
    bcdRate: row.bcdRate,
    igstRate: row.igstRate,
    ...(row.impPolicy && { impPolicy: row.impPolicy }),
    ...(indexTerm && { indexTerm }),
    citation: {
      volume: indexTerm ? 3 : 1,
      page: row.provenance?.page ?? 0,
      edition: row.provenance?.edition ?? tariffEdition(),
    },
  };
}

/**
 * The tariff items the goods could be, from the product index and from any
 * partial code the documents did give.
 *
 * Deterministic and model-free, so the merge can show a reviewer the same list
 * the model was asked to choose from — and so a job with no API key still gets
 * candidates instead of nothing.
 */
export function classificationCandidates(item: {
  description: string;
  /** A partial HS code off the documents, where there was one. */
  hsHint?: string;
}): ClassificationCandidate[] {
  const out = new Map<string, ClassificationCandidate>();

  // A partial code from the documents is the strongest evidence there is: the
  // supplier named a heading even if not a tariff item, so its children lead.
  const digits = (item.hsHint ?? '').replace(/\D/g, '');
  if (digits.length >= 4) {
    for (const row of resolveTariffPrefix(digits).candidates.slice(0, CANDIDATES)) {
      out.set(row.cth, toCandidate(row));
    }
  }

  for (const hit of searchProductIndex(item.description, CANDIDATES)) {
    if (hit.score < MIN_SCORE) continue;
    for (const heading of hit.headings) {
      // The index cites headings and subheadings, and occasionally a full
      // tariff item. Either way what goes to the model is real rows.
      const exact = heading.length === 8 ? lookupTariff(heading) : undefined;
      const rows = exact ? [exact] : shortlist(resolveTariffPrefix(heading).candidates, item.description);
      for (const row of rows) {
        if (!out.has(row.cth)) out.set(row.cth, toCandidate(row, hit.term));
      }
      if (out.size >= CANDIDATES) break;
    }
    if (out.size >= CANDIDATES) break;
  }

  return [...out.values()].slice(0, CANDIDATES);
}

function candidateText(candidates: ClassificationCandidate[]): string {
  return candidates
    .map(
      (c, i) =>
        `[${i}] ${c.cth} — ${c.tariffDescription} ` +
        `(unit ${c.unit || '?'}, BCD ${c.bcdRate}%, IGST ${c.igstRate}%` +
        `${c.impPolicy && c.impPolicy !== 'Free' ? `, DGFT policy ${c.impPolicy}` : ''})` +
        (c.indexTerm ? `\n     index entry: "${c.indexTerm}"` : ''),
    )
    .join('\n');
}

/**
 * The Chapter Notes governing the chapters the candidates sit in.
 *
 * Only the chapters actually in play, and only the first few notes of each:
 * the notes run long, and the ones that decide a heading are near the top
 * ("This Chapter does not cover..."). Sending all 278 would bury the choice.
 */
function notesText(candidates: ClassificationCandidate[]): string {
  const chapters = [...new Set(candidates.map((c) => c.cth.slice(0, 2)))].slice(0, 3);
  const blocks: string[] = [];
  for (const chapter of chapters) {
    const notes = chapterNotes(chapter);
    if (!notes?.notes.length) continue;
    blocks.push(
      `Chapter ${notes.chapter}${notes.title ? ` — ${notes.title}` : ''}:\n` +
        notes.notes.slice(0, 4).map((n) => `  ${n.slice(0, 400)}`).join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/** Which of the candidate tariff items the goods are, or none of them. */
export async function proposeClassification(item: {
  description: string;
  hsHint?: string;
  /** Trade description / end use, where the documents gave one. */
  context?: string;
}): Promise<ClassificationProposal | null> {
  const candidates = classificationCandidates(item);
  if (!candidates.length) return null;
  const notes = notesText(candidates);

  const choice = await structuredTextCall({
    schema: ClassificationSchema,
    schemaName: 'tariff_classification',
    system: `You are an Indian customs broker deciding which tariff item one line of an import invoice falls under.

Every candidate is a real 8-digit tariff item of the Indian Customs Tariff First Schedule. Some were reached from a partial HS code the supplier printed; others from the tariff's own alphabetical index of product names, and those show the index phrase that found them. Choose the candidate the goods actually are, or answer null.

The index is a finding aid, not a classification: it maps a trade name to a heading without reading anything. If the description is too vague to separate two candidates that carry different duty, or the Notes below do not settle a chapter that is in doubt, answer null. A wrong CTH on a Bill of Entry pulls in the wrong duty and the wrong licensing regime; leaving it for a human costs an hour.

Where the Chapter Notes are given, they are the first thing to apply, not background: the General Interpretative Rules classify "according to the terms of the headings and any relative Section or Chapter Notes" before anything else. A note that excludes these goods from a chapter settles the question however well the description otherwise fits. The notes are transcribed from a scan and may be imperfect — if one appears to decide the case but reads as though a word is missing or garbled, answer null and say so.

Be especially careful where candidates differ in DGFT policy: choosing a Free code over a Restricted one that the goods actually are is not a classification error, it is filing without a licence.

Answer "fits: false" whenever none of the candidates is these goods — including when the right tariff item plainly exists but was not offered. Never set fits: true and then explain in the reason that the candidate does not fit; a reader downstream sees the code, not the sentence, and will file it.

Note that the last candidate of a subheading is usually its residual "Other", and that is the correct answer when the goods belong to the subheading but match none of its named items.

confidence: 1.0 means the description names the goods unambiguously. Around 0.5 means the heading is right but the sub-item is a judgement. Below 0.3, prefer null.

reason: one sentence, naming what in the goods description decided it.`,
    userText:
      `Goods: ${item.description}\n` +
      `${item.hsHint ? `Partial HS code on the documents: ${item.hsHint}\n` : 'No HS code on any document.\n'}` +
      `${item.context ? `Other details: ${item.context}\n` : ''}` +
      `\nCandidate tariff items:\n${candidateText(candidates)}` +
      (notes ? `\n\nChapter Notes that govern these candidates:\n${notes}` : ''),
    model: MODELS.extract,
  });

  // `fits: false` is the answer, whatever index came with it.
  const candidate = !choice.fits || choice.index == null ? undefined : candidates[choice.index];
  if (!candidate) return null;
  return {
    candidate,
    reason: choice.reason,
    confidence: choice.confidence,
    consideredCth: candidates.map((c) => c.cth),
  };
}

/**
 * Post-merge enrichment: classify every item the HS cascade could not resolve.
 *
 * Finds its work the way enrichDraftFromLibrary does — a blocking error on the
 * item's `ritc` path — and swaps it for a citation-carrying warning. It runs
 * before the library proposer because a printed index entry against a real
 * tariff row beats a passage retrieved out of a PDF.
 */
export async function enrichDraftClassification(draft: ChecklistDraft): Promise<ChecklistDraft> {
  // Which lines need classifying, decided before any model call so the calls
  // can go out together. An invoice of twenty unclassified lines is twenty
  // independent questions, and asking them one after another spends the
  // route's whole budget on waiting.
  const pending = [...draft.items.entries()].filter(([idx, item]) => {
    const blocking = draft.flags.find(
      (f) => f.severity === 'error' && f.path === `items.${idx}.ritc`,
    );
    if (!blocking) return false;
    // An 8-digit code that already resolved needs no classifying; a blocking
    // flag on such a line is about something else.
    return !(/^\d{8}$/.test(item.ritc) && lookupTariff(item.ritc));
  });

  const proposals = await Promise.all(
    pending.map(([, item]) =>
      proposeClassification({
        description: item.description,
        ...(item.ritc && { hsHint: item.ritc }),
      }).catch(() => null), // no model / no tariff book — keep the error flag
    ),
  );

  // Applied in order, because both the item and the flag list are mutated.
  for (const [i, [idx, item]] of pending.entries()) {
    const proposal = proposals[i];
    if (!proposal) continue;
    const path = `items.${idx}.ritc`;
    const blocking = draft.flags.find((f) => f.severity === 'error' && f.path === path);
    if (!blocking) continue;

    const { candidate, confidence } = proposal;
    // Below a coin flip the proposal is worth showing and not worth applying:
    // prefilling the RITC is what makes a reviewer stop reading it.
    const apply = confidence >= 0.5;
    if (apply) {
      item.ritc = candidate.cth;
      if (item.bcdRate === 0) item.bcdRate = candidate.bcdRate;
    }

    draft.flags = draft.flags.filter((f) => f !== blocking);
    draft.flags.push({
      severity: apply ? 'warning' : 'error',
      path,
      message:
        `${apply ? 'Classified' : 'Suggested'} as CTH ${candidate.cth} "${candidate.tariffDescription.slice(0, 60)}" ` +
        `(BCD ${candidate.bcdRate}%, IGST ${candidate.igstRate}%) — ${proposal.reason} ` +
        `Confidence ${confidence.toFixed(2)}; ${candidate.indexTerm ? `alphabetical index "${candidate.indexTerm}", ` : ''}` +
        `${candidate.citation.edition} tariff Vol ${candidate.citation.volume} p.${candidate.citation.page}. ` +
        `Considered ${proposal.consideredCth.join(', ')}. ` +
        `Verify against the Section and Chapter Notes before filing.`,
    });
  }
  return draft;
}
