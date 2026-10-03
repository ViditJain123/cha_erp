import 'server-only';
import type { JobAgentRun } from '@checklist/extraction';
import type { Json } from '@checklist/db';
import { serviceClient } from './supabase/admin';
import { jobAgentMode } from './draft-pipeline';

/**
 * File a job agent run against the draft version it produced (or shadowed).
 *
 * Everything the run did is kept — every tool call and what it returned, every
 * web search and what it read, the tokens, the decisions and the refusals —
 * because a model decision that cannot be audited is one that cannot be
 * corrected. Failures to record never fail the draft.
 */
export async function recordAgentRun(input: {
  companyId: string;
  jobId: string;
  draftId: string | null;
  draftVersion: number;
  run: JobAgentRun;
}): Promise<void> {
  const db = serviceClient();
  const mode = jobAgentMode();
  await db.from('job_agent_runs').insert({
    company_id: input.companyId,
    job_id: input.jobId,
    draft_id: input.draftId,
    draft_version: input.draftVersion,
    mode: mode === 'on' ? 'on' : 'shadow',
    status: input.run.status,
    model: input.run.model,
    filing_date: input.run.filingDate,
    turns: input.run.turns,
    tool_calls: input.run.toolCalls as unknown as Json,
    web_sources: input.run.webSources as unknown as Json,
    usage: input.run.usage as unknown as Json,
    decisions: { decisions: input.run.decisions, registry: input.run.registry } as unknown as Json,
    flags_added: input.run.flagsAdded,
    error: input.run.error ?? null,
    response_ids: input.run.responseIds,
    started_at: input.run.startedAt,
    finished_at: input.run.finishedAt,
  });
}
