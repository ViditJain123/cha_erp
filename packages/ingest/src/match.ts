import type { Identifier, IdentifierKind } from './normalise.js';

/**
 * How much each kind of identifier is worth when deciding whether an email
 * belongs to a job we already have.
 *
 * Container and transport-document numbers are globally unique per shipment, so
 * one of them alone clears the bar. A conversation thread deliberately does
 * not: reply-all chains drift onto unrelated shipments and forwarded chains
 * carry the same conversationId across jobs, which makes it a strong
 * tiebreaker but a weak sole signal.
 */
export const IDENTIFIER_WEIGHTS: Record<IdentifierKind, number> = {
  container: 5,
  bl: 5,
  awb: 5,
  invoice: 4,
  conversation: 3,
  po: 2,
};

export const MATCH_THRESHOLD = 4;

/** Identifiers that name a specific shipment rather than a conversation. */
const STRONG_KINDS: readonly IdentifierKind[] = ['bl', 'awb', 'invoice', 'container', 'po'];

export interface CandidateIdentifier {
  job_id: string;
  kind: IdentifierKind;
  value: string;
}

export interface MatchOutcome {
  /** 'attach' when exactly one job clears the threshold. */
  decision: 'attach' | 'ambiguous' | 'none';
  jobId?: string;
  score?: number;
  /** All jobs at the top score, when the result is ambiguous. */
  tiedJobIds?: string[];
  matched?: { kind: IdentifierKind; value: string }[];
  /** True when the match rests on the email thread alone. */
  weak?: boolean;
}

/**
 * Scores candidate jobs against the identifiers found on an email.
 *
 * A tie above the threshold is reported as ambiguous rather than guessed:
 * attaching to the wrong job merges two shipments' documents, which is
 * effectively unrecoverable. A human decides those.
 */
export function scoreMatches(
  identifiers: Identifier[],
  candidates: CandidateIdentifier[],
): MatchOutcome {
  const wanted = new Set(identifiers.map((i) => `${i.kind}:${i.value}`));

  const perJob = new Map<string, { score: number; matched: Map<string, IdentifierKind> }>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.value}`;
    if (!wanted.has(key)) continue;

    const entry = perJob.get(candidate.job_id) ?? { score: 0, matched: new Map() };
    // Count each distinct (kind, value) once: a job holding the same B/L twice
    // must not outscore one that genuinely matches on two identifiers.
    if (!entry.matched.has(key)) {
      entry.matched.set(key, candidate.kind);
      entry.score += IDENTIFIER_WEIGHTS[candidate.kind];
    }
    perJob.set(candidate.job_id, entry);
  }

  if (perJob.size === 0) return { decision: 'none' };

  const best = Math.max(...[...perJob.values()].map((e) => e.score));

  if (best < MATCH_THRESHOLD) {
    // Thread-only fallback. A reply whose attachments yielded no shipment
    // identifier at all — a scanned certificate, a photographed document — has
    // nothing else to go on, and opening a duplicate job for it is worse than
    // trusting the thread. Only applies when the email names no shipment of its
    // own: if it does carry a strong identifier and that identifier points
    // elsewhere, the identifier wins and this does not fire.
    const emailNamesAShipment = identifiers.some((i) => STRONG_KINDS.includes(i.kind));
    const threadMatches = [...perJob.entries()].filter(([, e]) =>
      [...e.matched.values()].every((kind) => kind === 'conversation'),
    );

    if (!emailNamesAShipment && threadMatches.length === 1) {
      const [jobId, entry] = threadMatches[0] as [
        string,
        { score: number; matched: Map<string, IdentifierKind> },
      ];
      return {
        decision: 'attach',
        jobId,
        score: entry.score,
        weak: true,
        matched: [{ kind: 'conversation', value: [...entry.matched.keys()][0]?.slice(13) ?? '' }],
      };
    }
    return { decision: 'none' };
  }

  const top = [...perJob.entries()].filter(([, e]) => e.score === best);
  if (top.length > 1) {
    return { decision: 'ambiguous', score: best, tiedJobIds: top.map(([jobId]) => jobId) };
  }

  const [jobId, entry] = top[0] as [string, { score: number; matched: Map<string, IdentifierKind> }];
  return {
    decision: 'attach',
    jobId,
    score: entry.score,
    matched: [...entry.matched.entries()].map(([key, kind]) => ({
      kind,
      value: key.slice(kind.length + 1),
    })),
  };
}
