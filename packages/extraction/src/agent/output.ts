import { z } from 'zod';

/**
 * What the job agent answers with — one strict object, produced only when it
 * has stopped calling tools.
 *
 * Every decision carries the reason before the value and the evidence beside
 * it, and every "yes" has a "why the condition is met" next to it. The shape
 * is what lets apply.ts refuse a value whose own reason argues against it
 * without reading the model's mind: the fields are there to be checked
 * against each other.
 *
 * Structured-output rules: every field required, optionals expressed as
 * nullable, no records, no unions of objects.
 */

/** Where a fact was read. `document` is a job file name, `mail`, `web:<url>` or `tool:<name>`. */
export const EvidenceSchema = z.object({
  document: z.string(),
  quote: z.string(),
});
export type AgentEvidence = z.infer<typeof EvidenceSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const CthDecisionSchema = z.object({
  reason: z.string(),
  /** False when none of the candidates offered is these goods, or the line was already settled. */
  decided: z.boolean(),
  cth: z.string().nullable(),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceSchema),
  /** Every CTH considered, so the reviewer sees what was rejected. */
  considered: z.array(z.string()),
});

export const BcdDecisionSchema = z.object({
  reason: z.string(),
  /** True only when the goods are what the entry describes AND its condition is established. */
  applies: z.boolean(),
  notification: z.string().nullable(),
  serial: z.string().nullable(),
  subEntry: z.string().nullable(),
  /** Whether the entry's description is these goods, independent of any condition. */
  descriptionMatches: z.boolean(),
  /** The document or mail that establishes the condition; null when the entry has none or it is not met. */
  conditionEstablishedBy: EvidenceSchema.nullable(),
  conditionSummary: z.string().nullable(),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceSchema),
});

export const SerialDecisionSchema = z.object({
  reason: z.string(),
  decided: z.boolean(),
  serial: z.string().nullable(),
  rate: z.number().nullable(),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceSchema),
});

export const EximDecisionSchema = z.object({
  reason: z.string(),
  /** True only when a licence or authorisation on the job (or the mail) covers this line. */
  applies: z.boolean(),
  notification: z.string().nullable(),
  serial: z.string().nullable(),
  licenceNo: z.string().nullable(),
  licenceDate: z.string().nullable(),
  /** The job file the licence was read from. */
  licenceFile: z.string().nullable(),
  evidence: z.array(EvidenceSchema),
});

export const ConflictSchema = z.object({
  /** `origin`, `quantity`, `description`, `value`, `fta`, `weight`, `invoice`, … */
  field: z.string(),
  documents: z.array(z.string()),
  values: z.array(z.string()),
  severity: z.enum(['error', 'warning', 'info']),
  /** How the agent reads it — which document is authoritative and why, or that a person must decide. */
  resolution: z.string(),
});

export const AgentItemSchema = z.object({
  invoiceSrNo: z.number(),
  slNo: z.number(),
  cth: CthDecisionSchema,
  bcd: BcdDecisionSchema,
  igst: SerialDecisionSchema,
  compCess: SerialDecisionSchema,
  exim: EximDecisionSchema,
  conflicts: z.array(ConflictSchema),
  openQuestions: z.array(z.string()),
});

export const WebFindingSchema = z.object({
  url: z.string(),
  quote: z.string(),
  aboutItemSlNo: z.number().nullable(),
  claim: z.string(),
});

export const JobAgentResultSchema = z.object({
  items: z.array(AgentItemSchema),
  jobConflicts: z.array(ConflictSchema),
  webFindings: z.array(WebFindingSchema),
});

export type JobAgentResult = z.infer<typeof JobAgentResultSchema>;
export type AgentItemResult = z.infer<typeof AgentItemSchema>;
export type AgentConflict = z.infer<typeof ConflictSchema>;

/**
 * Whether a reason argues against the value beside it.
 *
 * The same test `notification-choose.ts` applies to its one-shot chooser, kept
 * here for the agent's decisions: a reason saying the condition is not
 * established is a "no", whatever `applies` says.
 */
export function reasonRefuses(reason: string): boolean {
  return /\b(does not|doesn't|do not|don't|cannot|can't|not|never|nothing)\s+(\w+\s+){0,3}(establish|confirm|identif|show|state|demonstrat|indicat|support|evidenc|meet|satisf)|no evidence|not evident|unclear|unknown whether|not established|not met|cannot be confirmed|insufficient/i.test(
    reason,
  );
}

/**
 * A document reference that is a job file or the mail — never the web or a
 * tool.
 *
 * The model writes the file the way a person would — "EPCG-831018385.pdf
 * p.5", "CI-GAEL.pdf, page 2", "the mail" — so the file name is looked for
 * inside the reference, not matched against it, and a page suffix is not a
 * different document. A `web:` or `tool:` prefix is never primary.
 */
export function isPrimaryEvidence(document: string, fileNames: Set<string>): boolean {
  const ref = document.trim();
  if (!ref || /^(web|tool):/i.test(ref)) return false;
  if (/^(the )?mail\b/i.test(ref)) return true;
  const lower = ref.toLowerCase();
  for (const name of fileNames) {
    if (lower.includes(name.toLowerCase())) return true;
  }
  return false;
}

