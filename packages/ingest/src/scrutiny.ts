import { z } from 'zod';
import { MODELS, structuredTextCall } from '@checklist/extraction/openai';

/**
 * The scrutiny analysis.
 *
 * Deliberately one model call, and deliberately text-only. Every document was
 * already read once at ingest and its digest stored on
 * `job_documents.classification`, so nothing is uploaded again here. Producing
 * the missing-document list and the shipper email separately would double the
 * cost for no benefit — the email is just the list, written out.
 */

export const ScrutinySchema = z.object({
  /**
   * One verdict per requirement assessed: an HS code is matched by prefix, so a
   * heading-level requirement reaches goods it may have nothing to say about.
   * This is where the invoice's actual products decide that.
   */
  assessments: z.array(
    z.object({
      ccrCode: z.string(),
      /** False when the goods on the invoice fall outside what it governs. */
      applies: z.boolean(),
      /** One sentence: what it calls for here, or why it does not bite. */
      note: z.string(),
    }),
  ),
  /** What the CCRs require that the job does not already hold. */
  missingDocuments: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
      ccrCode: z.string().nullable(),
    }),
  ),
  /** Prose for the scrutiny user, written into the job's remarks. */
  remarks: z.string(),
  /** Ready to send to the shipper once a human has approved it. */
  draftEmail: z.object({
    subject: z.string(),
    body: z.string(),
  }),
});

export type ScrutinyAnalysis = z.infer<typeof ScrutinySchema>;

export interface ScrutinyDocument {
  fileName: string;
  docType: string;
  summary: string | null;
  goodsDescription: string | null;
}

export interface ScrutinyRequirement {
  code: string;
  title: string;
  requirementText: string;
}

export interface ScrutinyInput {
  jobNumber: string | null;
  importerName: string | null;
  supplierName: string | null;
  hsCodes: string[];
  documents: ScrutinyDocument[];
  requirements: ScrutinyRequirement[];
  /** Who signs the email. */
  senderName: string;
  companyName: string;
}

const SYSTEM = `You work in the scrutiny desk of an Indian customs house agent.

You are given the compliance requirements (CCRs) matched to a shipment's HS codes, and a list of the documents already on file with a short description of each. Decide what each requirement actually calls for given the goods on the invoice, work out which of those documents are NOT already held, then write the email asking the shipper for them.

Rules for assessments:
- Exactly one entry per requirement you were given, keyed by its code.
- Requirements are matched to the shipment by HS code prefix, so one can arrive attached to goods it was never meant for. Read the goods described on the invoice and decide honestly whether it governs them.
- applies: false when the goods fall outside what the requirement covers, or when it is conditional and the condition is not met here. Otherwise true.
- note: one sentence naming the goods it turns on. When applies is true and the goods already hold what it asks for, say so. When applies is false, say what it governs instead.
- A requirement that applies but needs no further document is a normal outcome — say that in the note rather than inventing a document for it.
- Judge only from the goods described. If the documents on file say nothing about what the goods are, set applies true and say the goods could not be identified.

Rules for missingDocuments:
- Never raise a document for a requirement you marked applies:false.
- Only list a document if a requirement genuinely calls for it AND nothing on file already satisfies it. Match on substance, not file name: a "Certificate of Analysis" on file satisfies a requirement for a test report.
- One entry per document. Use the name a shipper would recognise ("FSSAI import licence", "Phytosanitary certificate"), not internal jargon.
- reason: one short sentence saying which requirement drives it.
- ccrCode: the code of the requirement that drives it, or null if it comes from more than one.
- If nothing is missing, return an empty array. Do not invent work.

Rules for remarks:
- A short internal note for the scrutiny user. Say what the requirements amount to for these particular goods, which of them do not bite and why, and what is outstanding. Plain sentences, no headings or bullet characters.

Rules for draftEmail:
- Written to the shipper, from the customs broker handling clearance.
- Professional, direct and short. No filler, no "I hope this email finds you well".
- State the shipment plainly (invoice or B/L number if you have it), list exactly what is needed, and ask them to send it.
- Do not invent deadlines, penalties, charges or regulations that are not in the requirements you were given.
- Do not mention internal process steps, systems, or what happens after the documents arrive.
- Plain text, not HTML or markdown. Sign off with the sender's name and the company.
- If nothing is missing, still write a brief note confirming the documents are complete.`;

function documentLine(doc: ScrutinyDocument): string {
  const bits = [`${doc.docType}: ${doc.fileName}`];
  if (doc.summary) bits.push(doc.summary);
  if (doc.goodsDescription) bits.push(`Goods: ${doc.goodsDescription}`);
  return `- ${bits.join(' — ')}`;
}

export async function analyseScrutiny(input: ScrutinyInput): Promise<ScrutinyAnalysis> {
  const userText = [
    `Shipment: ${input.jobNumber ?? 'unnumbered'}`,
    `Importer: ${input.importerName ?? 'unknown'}`,
    `Supplier / shipper: ${input.supplierName ?? 'unknown'}`,
    `HS codes: ${input.hsCodes.length > 0 ? input.hsCodes.join(', ') : 'none recorded'}`,
    '',
    'Compliance requirements that apply:',
    ...(input.requirements.length > 0
      ? input.requirements.map((r) => `- [${r.code}] ${r.title}: ${r.requirementText}`)
      : ['- none selected']),
    '',
    'Documents already on file:',
    ...(input.documents.length > 0 ? input.documents.map(documentLine) : ['- none']),
    '',
    `The email is sent by ${input.senderName} at ${input.companyName}.`,
  ].join('\n');

  return structuredTextCall({
    schema: ScrutinySchema,
    schemaName: 'scrutiny_analysis',
    system: SYSTEM,
    userText,
    // Reasoning over a page of text, not extraction from a document.
    model: MODELS.extract,
  });
}

// --------------------------------------------- naming a typed-in CCR ----

export const RequirementNameSchema = z.object({
  /** What a broker would call this requirement in a list. */
  title: z.string(),
  /** Short uppercase handle, e.g. FSSAI-REG. */
  code: z.string(),
});

export type RequirementName = z.infer<typeof RequirementNameSchema>;

const NAME_SYSTEM = `You are naming a compliance requirement for an Indian customs broker's requirements master.

You are given the requirement as someone typed it. Produce a title and a short code.

- title: what a broker would call it in a list — the instrument or permission itself, not a sentence. "FSSAI import registration", "BIS certificate of conformity", "Phytosanitary certificate". Six words at most. No trailing full stop.
- code: an uppercase handle derived from the title, words joined by hyphens, 16 characters at most. "FSSAI-REG", "BIS-COC", "PHYTO-CERT".
- Name only what the text actually says. Do not infer a regulation that is not mentioned.`;

/**
 * Titles a requirement typed in during scrutiny.
 *
 * The operator pastes the substance and should not also have to invent a name
 * for it — but the title is what every later screen and every prompt shows, so
 * it needs to read like the instrument, not like the first line of a paragraph.
 */
export async function nameRequirement(input: {
  requirementText: string;
  hsCode: string;
}): Promise<RequirementName> {
  return structuredTextCall({
    schema: RequirementNameSchema,
    schemaName: 'requirement_name',
    system: NAME_SYSTEM,
    userText: [`HS code: ${input.hsCode}`, '', 'Requirement as typed:', input.requirementText].join(
      '\n',
    ),
    model: MODELS.classify,
  });
}

// ------------------------------------------------- matching replies back ----

export const RequestMatchSchema = z.object({
  matches: z.array(
    z.object({
      requestName: z.string(),
      fileName: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      reason: z.string(),
    }),
  ),
});

export type RequestMatches = z.infer<typeof RequestMatchSchema>;

const MATCH_SYSTEM = `You are reconciling documents that just arrived against the documents a customs broker asked a shipper for.

For each outstanding request, decide whether one of the supplied documents satisfies it. Match on substance, not on the file name: a "Certificate of Analysis" satisfies a request for a batch test report; a scanned licence satisfies a request for that licence.

- Only return a match you actually believe. An unmatched request is a normal outcome.
- confidence: high when the document plainly is the thing asked for; medium when it probably is; low when it merely might be.
- reason: one short sentence.
- Never match the same document to more than one request unless it genuinely covers both.

A human confirms every match before it counts, so it is better to surface a medium-confidence candidate than to stay silent.`;

/**
 * Proposes which arriving documents satisfy which outstanding requests.
 *
 * Runs on the stored digests only, and only when a user asks for it — not
 * automatically on every reply. Nothing here closes a request; it fills in the
 * suggestion a human then accepts or ignores.
 */
export async function suggestRequestMatches(input: {
  requests: { name: string; reason: string | null }[];
  documents: ScrutinyDocument[];
}): Promise<RequestMatches> {
  if (input.requests.length === 0 || input.documents.length === 0) return { matches: [] };

  const userText = [
    'Outstanding requests:',
    ...input.requests.map((r) => `- ${r.name}${r.reason ? ` (${r.reason})` : ''}`),
    '',
    'Documents on the job:',
    ...input.documents.map(documentLine),
  ].join('\n');

  return structuredTextCall({
    schema: RequestMatchSchema,
    schemaName: 'request_matches',
    system: MATCH_SYSTEM,
    userText,
    model: MODELS.classify,
  });
}

// -------------------------------------------------- the closing message ----

export const FinalNoticeSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type FinalNotice = z.infer<typeof FinalNoticeSchema>;

const FINAL_SYSTEM = `You are writing the closing message from an Indian customs house agent to the shipper of a consignment.

The documents are all in and the checklist is final. Tell them so, and that the consignment is proceeding.

- Short and professional. Three or four sentences at most. No filler.
- Identify the shipment plainly (invoice or B/L number if you have it).
- Thank them for the documents they sent, if any were requested.
- Say the checklist is final and is attached, if it is being attached.

Absolutely do not:
- Mention noting, assessment, filing, the bill of entry, customs procedure, or ANY internal step that happens next on our side. "Proceeding" is as specific as you may be. This is the single most important rule here.
- Mention systems, software, reference numbers of ours, or how the work is done.
- Invent dates, charges, duties or commitments.
- Ask for anything further.

Plain text, not HTML or markdown. Sign off with the sender's name and the company.`;

/**
 * The final note to the shipper.
 *
 * The prompt's hard constraint is what it must NOT say: the next internal step
 * is noting, and the shipper is not told that. There is a test asserting the
 * output stays clear of that vocabulary.
 */
export async function draftFinalNotice(input: {
  jobNumber: string | null;
  importerName: string | null;
  supplierName: string | null;
  documentsRequested: string[];
  checklistAttached: boolean;
  senderName: string;
  companyName: string;
}): Promise<FinalNotice> {
  const userText = [
    `Shipment: ${input.jobNumber ?? 'unnumbered'}`,
    `Importer: ${input.importerName ?? 'unknown'}`,
    `Shipper: ${input.supplierName ?? 'unknown'}`,
    input.documentsRequested.length > 0
      ? `Documents they supplied on request: ${input.documentsRequested.join(', ')}`
      : 'No additional documents were requested from them.',
    input.checklistAttached
      ? 'The final checklist is attached to this email.'
      : 'No attachment is being sent.',
    '',
    `Written by ${input.senderName} at ${input.companyName}.`,
  ].join('\n');

  return structuredTextCall({
    schema: FinalNoticeSchema,
    schemaName: 'final_notice',
    system: FINAL_SYSTEM,
    userText,
    model: MODELS.classify,
  });
}
