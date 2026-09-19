/**
 * When a Bill of Entry was filed, relative to the vessel — the three GENERAL
 * columns that are functions of two dates and nothing else.
 *
 * None of these dates appear on any document the customer sends. The IGM
 * number, the IGM date and the entry-inwards date come off ICEGATE or the
 * shipping line and are keyed by the operator; the filing date is the day the
 * Bill of Entry is actually presented. So every function here takes "not known"
 * as a real input and answers "I cannot tell" rather than defaulting — the
 * previous code guessed `Prior` for air and `Normal` for sea, which is how a
 * declaration ends up stating a filing posture nobody checked.
 */

/** Days between two ISO dates, or undefined when either is unusable. */
function daysBetween(from: string, to: string): number | undefined {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.round((b - a) / 86_400_000);
}

export interface BoeTimingInput {
  /** IGM number filed against this BL, when one has been found. */
  igmNo?: string;
  /** Date entry inwards was granted to the vessel, ISO `YYYY-MM-DD`. */
  inwardDate?: string;
  /** Date the Bill of Entry is/was presented, ISO `YYYY-MM-DD`. */
  beFilingDate?: string;
  /**
   * Whether anyone has actually looked ICEGATE up for an IGM. Without this,
   * "no IGM number" cannot be told apart from "nobody checked", and those two
   * mean opposite things: the first is an Advance filing, the second is a gap.
   */
  igmChecked?: boolean;
}

/**
 * `AdvancePriorNormal` — `A`, `P` or `N`.
 *
 * | IGM filed | Entry inwards | Code |
 * |---|---|---|
 * | no  | —   | `A` Advance |
 * | yes | no  | `P` Prior |
 * | yes | yes | `N` Normal |
 *
 * Returns undefined when the IGM has not been checked, because all three
 * answers depend on knowing whether one exists.
 */
export function filingStatusFrom(input: BoeTimingInput): 'Advance' | 'Prior' | 'Normal' | undefined {
  const hasIgm = Boolean(input.igmNo?.trim());
  if (!hasIgm) return input.igmChecked ? 'Advance' : undefined;
  return input.inwardDate ? 'Normal' : 'Prior';
}

/**
 * `IsUnderSec46` — was the Bill of Entry presented late?
 *
 * Section 46(3) requires presentation before the end of the day preceding the
 * day the vessel arrives; a later presentation attracts charges for late
 * presentation (₹5,000/day for the first three days of default, ₹10,000/day
 * thereafter) unless the proper officer is satisfied there was sufficient
 * cause.
 *
 * Measured here in calendar days from entry inwards. The statute's clock
 * excludes customs holidays and we hold no holiday calendar, so this can flag a
 * BE filed the working day after a holiday weekend. That is why the operator
 * can clear it with a reason rather than the flag being final — see
 * `docs/boe-mapping/open-questions.md`.
 */
export function isUnderSec46(input: BoeTimingInput): boolean | undefined {
  if (!input.inwardDate || !input.beFilingDate) return undefined;
  const days = daysBetween(input.inwardDate, input.beFilingDate);
  if (days === undefined) return undefined;
  return days > 0;
}

/**
 * `IsUnderSec48` — was the Bill of Entry presented more than thirty days after
 * the goods were unloaded?
 *
 * Section 48 lets the custodian sell goods not cleared within thirty days, so a
 * BE presented past that window is declared as one.
 */
export function isUnderSec48(input: BoeTimingInput): boolean | undefined {
  if (!input.inwardDate || !input.beFilingDate) return undefined;
  const days = daysBetween(input.inwardDate, input.beFilingDate);
  if (days === undefined) return undefined;
  return days > 30;
}

/** How many days late, for the message that explains the flag. */
export function daysLate(input: BoeTimingInput): number | undefined {
  if (!input.inwardDate || !input.beFilingDate) return undefined;
  const days = daysBetween(input.inwardDate, input.beFilingDate);
  return days !== undefined && days > 0 ? days : undefined;
}
