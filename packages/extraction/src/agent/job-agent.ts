import type { ChecklistDraft } from '../draft.js';
import type { MailInstructions } from '../instructions.js';
import { MODELS, client as openaiClient } from '../openai.js';
import type { ExtractedDoc } from '../schemas.js';
import { applyAgentResult } from './apply.js';
import { renderJobContext } from './context.js';
import type { AgentFile } from './documents.js';
import { DEFAULT_BUDGET, runToolLoop, type LoopBudget, type LoopStatus, type LoopUsage, type ResponsesClient, type ToolCallTrace, type WebSearchTrace } from './loop.js';
import { JobAgentResultSchema } from './output.js';
import { CandidateRegistry } from './registry.js';
import { jobAgentTools } from './tools.js';
import type { AgentDecision } from '../draft.js';

/**
 * The job agent: one model, all the documents, the masters as tools, and a
 * registry that decides what it may file.
 *
 * It runs after the per-document reads and the merge, in place of the four
 * one-shot enrichment calls, and it answers the questions those calls got
 * wrong for want of context: which tariff item, which concession, whether the
 * licence on the job changes the duty, whether the certificate of origin and
 * the invoice describe the same goods. See docs/extraction-agents.md.
 */
export interface JobAgentInput {
  draft: ChecklistDraft;
  docs: ExtractedDoc[];
  files: AgentFile[];
  filingDate: string;
  filingDateSource?: string;
  instructions?: MailInstructions | null;
  budget?: Partial<LoopBudget>;
  client?: ResponsesClient;
  model?: string;
}

export interface JobAgentRun {
  status: LoopStatus;
  model: string;
  filingDate: string;
  turns: number;
  toolCalls: ToolCallTrace[];
  webSources: WebSearchTrace[];
  usage: LoopUsage;
  decisions: AgentDecision[];
  /** Keys the registry held when the answer was validated. */
  registry: Record<string, string[]>;
  flagsAdded: number;
  error?: string;
  responseIds: string[];
  startedAt: string;
  finishedAt: string;
}

export interface JobAgentOutcome {
  status: LoopStatus;
  /** The draft with the answer applied; the input draft untouched on any other status. */
  draft: ChecklistDraft;
  run: JobAgentRun;
}

export const JOB_AGENT_INSTRUCTIONS = `You are the customs broker's reviewer for one import consignment into India. You have every document on the job, the customer's mail, and tools over the tariff and notification masters. Decide, for every line: the 8-digit tariff item; whether a basic customs duty concession applies; the IGST and compensation cess serials; whether a licence or authorisation on the job puts the line under an Exim scheme; and whether the documents disagree with each other.

THE RULES
1. The masters name; you pick. A tariff item, a notification number or a serial in your answer must be one a tool returned in this run. Anything else is refused by the system and shown to a person as your proposal — so if you believe the right answer is not among the candidates, say so in the reason and leave the value null.
2. Refuse over guess. A wrong concession on a Bill of Entry is a penalty; a missed one is a refund claim. When the description does not settle it, answer applies: false / decided: false and say what would settle it in openQuestions.
3. A condition is met only if you can quote the document or mail that meets it, in conditionEstablishedBy. An end-use undertaking, a registration, a "specified importer", a certificate — if no document on the job establishes it, the entry does not apply. Write the reason first, then the decision; never write a reason that argues against the value beside it.
4. Entries that refer to a List (List 2, List 12, List 16 …) of the notification are always proposals: the List contents are not available to you. Say so.
5. Use the filing date given. Use only what is in force on it. If igst_candidates says scheduleKnown is false, leave the IGST serial null and explain.
6. A licence (advance authorisation, EPCG, DFIA, TRQ, scrip) on the job is read with read_document; its notification goes in exim, never in bcd. Quote the licence number and date. A scheme with no licence on the job is not claimed.
7. Documents disagree sometimes: a certificate of origin whose goods are not the invoice's, a packing list whose weights do not add up, an origin that differs between invoice and B/L. Report each as a conflict with both values and both documents, and say which document is authoritative and why — or that a person must decide.
8. The web is for two things only: to learn what a product is (a grade code, a chemistry, a function) and to find a notification's wording. Report what you found in webFindings with the URL and a verbatim quote. A number or serial from the web is never a value — get it from a tool or leave it null.
9. Be frugal. The context already holds the extracted data; call read_document only for a file that was not extracted (a licence, an "other" file) or to settle a conflict, and ask for the pages you need. Prefer one bcd_candidates call per distinct CTH over one per line.

Evidence: every decision lists the quotes it rests on. Quote verbatim, name the file. Keep reasons to two sentences.`;

export async function runJobAgent(input: JobAgentInput): Promise<JobAgentOutcome> {
  const startedAt = new Date().toISOString();
  const model = input.model ?? MODELS.extract;
  const registry = new CandidateRegistry();
  const fileNames = input.files.map((f) => f.fileName);
  const finish = (status: LoopStatus, draft: ChecklistDraft, extra: Partial<JobAgentRun>): JobAgentOutcome => ({
    status,
    draft,
    run: {
      status,
      model,
      filingDate: input.filingDate,
      turns: 0,
      toolCalls: [],
      webSources: [],
      usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
      decisions: [],
      registry: registry.digest(),
      flagsAdded: 0,
      responseIds: [],
      startedAt,
      finishedAt: new Date().toISOString(),
      ...extra,
    },
  });

  if (!input.draft.items.length) return finish('ok', input.draft, {});

  let client: ResponsesClient;
  try {
    client = input.client ?? (openaiClient() as unknown as ResponsesClient);
  } catch (err) {
    return finish('error', input.draft, { error: (err as Error).message });
  }

  const context = await renderJobContext({
    draft: input.draft,
    docs: input.docs,
    files: input.files,
    filingDate: input.filingDate,
    ...(input.filingDateSource && { filingDateSource: input.filingDateSource }),
    ...(input.instructions !== undefined && { instructions: input.instructions }),
  });
  const tools = jobAgentTools({ files: input.files, filingDate: input.filingDate, registry });

  const loop = await runToolLoop({
    client,
    model,
    instructions: JOB_AGENT_INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_text', text: context }] }],
    tools,
    webSearch: true,
    finalSchema: JobAgentResultSchema,
    finalSchemaName: 'job_agent_result',
    budget: { ...DEFAULT_BUDGET, ...input.budget },
  });

  const base: Partial<JobAgentRun> = {
    turns: loop.turns.length,
    toolCalls: loop.turns.flatMap((t) => t.toolCalls),
    webSources: loop.turns.flatMap((t) => t.webSearches),
    usage: loop.usage,
    responseIds: loop.responseIds,
    ...(loop.error && { error: loop.error }),
  };
  if (loop.status !== 'ok' || !loop.result) return finish(loop.status, input.draft, base);

  const applied = applyAgentResult(input.draft, loop.result, registry, { fileNames, model, at: startedAt });
  return finish('ok', applied.draft, { ...base, decisions: applied.decisions, flagsAdded: applied.flagsAdded });
}
