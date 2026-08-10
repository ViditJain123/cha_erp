-- Checklist drafts: the structured Bill of Entry data a job's documents were
-- read into, and the only thing the Logi-Sys exporter can be built from.
--
-- Until now the ERP path stored triage-level facts only — which documents
-- arrived, and the identifiers that let us match them to a job. That is enough
-- to open and route a job, and nowhere near enough to file one: no line items,
-- values, weights, ports, incoterms or notifications. `packages/extraction`
-- has always produced exactly that shape (`ChecklistDraft`), but ran only in
-- the legacy filesystem app. This table is where it lands for a real tenant.

create table public.job_drafts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  job_id        uuid not null references public.jobs (id) on delete cascade,

  -- A `ChecklistDraft` from packages/extraction. Deliberately schemaless: the
  -- shape belongs to the extraction package, which changes far more often than
  -- migrations do, and every consumer reads it through that TypeScript type.
  draft         jsonb not null,

  -- Reviewers edit drafts, so each save is a new version rather than an
  -- overwrite. A Bill of Entry filed from version 3 must stay reconstructible
  -- after someone saves version 4.
  version       integer not null default 1,
  status        text not null default 'draft'
                check (status in ('draft', 'review', 'approved')),

  created_by    uuid references public.profiles (id) on delete set null,
  approved_by   uuid references public.profiles (id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (job_id, version)
);

-- The hot query is "the latest draft for this job".
create index job_drafts_current_idx
  on public.job_drafts (company_id, job_id, version desc);

create trigger job_drafts_touch_updated_at
  before update on public.job_drafts
  for each row execute function public.touch_updated_at();

-- Ties an export to the exact draft revision it was generated from, so a
-- filed workbook can always be traced back to what it was built out of.
alter table public.job_exports
  add column draft_version integer;

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
do $$
declare
  t text;
begin
  foreach t in array array['job_drafts'] loop
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
