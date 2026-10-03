-- The job agent: one model loop over all of a job's documents, and its audit.
--
-- Two things the ERP path never kept. The per-document extracts behind a draft
-- (`ExtractedDoc[]`) were dropped by the draft route the moment the merge had
-- read them, so nothing after the merge could look at what any document said;
-- and no model decision was recorded beyond the flag it left on the draft. The
-- agent needs the former as its input and produces the latter as its output,
-- so both land here. Dictated in docs/extraction-agents.md.

alter table public.job_drafts
  -- The `ExtractedDoc[]` the draft was merged from, in the extraction
  -- package's own shape. Schemaless for the same reason `draft` is.
  add column docs jsonb;

comment on column public.job_drafts.docs is
  'ExtractedDoc[] from packages/extraction: the per-document reads behind this draft version.';

create table public.job_agent_runs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  job_id         uuid not null references public.jobs (id) on delete cascade,
  draft_id       uuid references public.job_drafts (id) on delete set null,
  draft_version  integer,

  -- 'shadow' ran and recorded but did not change the draft; 'on' applied.
  mode           text not null check (mode in ('on', 'shadow')),
  -- ok: a validated answer; budget: ran out of turns/tokens/time before one;
  -- invalid: an answer the registry refused wholesale; error: transport.
  status         text not null check (status in ('ok', 'budget', 'invalid', 'error')),
  model          text not null,
  filing_date    date,

  turns          integer not null default 0,
  -- [{turn, name, args, resultDigest, ms}] — every tool call, in order.
  tool_calls     jsonb not null default '[]'::jsonb,
  -- [{query, urls[]}] — every web search the model ran and what it read.
  web_sources    jsonb not null default '[]'::jsonb,
  -- {input, cached, output, reasoning} token counts summed over the run.
  usage          jsonb not null default '{}'::jsonb,
  -- The validated per-item decisions and the rejections, as applied.
  decisions      jsonb not null default '[]'::jsonb,
  flags_added    integer not null default 0,
  error          text,
  response_ids   text[] not null default '{}',

  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  created_at     timestamptz not null default now()
);

create index job_agent_runs_job_idx
  on public.job_agent_runs (company_id, job_id, created_at desc);

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array['job_agent_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (company_id = public.auth_company_id() or public.is_platform_admin())
    $f$, t);
  end loop;
end;
$$;
