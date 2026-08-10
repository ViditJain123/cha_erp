-- Scrutiny workflow, part 2: compliance requirements per HS code, the CCRs a
-- job has been assessed against, and the documents that turned out to be
-- missing as a result.

create type public.document_request_status as enum (
  'pending',    -- asked for, not yet received
  'received',   -- a document arrived and a human confirmed it satisfies this
  'waived'      -- decided it is not needed after all
);

-- ------------------------------------------------------------- ccr_master ----

create table public.ccr_master (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  -- A prefix, bare digits: '3304' matches 33049990. Requirements attach at
  -- chapter or heading level far more often than at full 8-digit level.
  hs_code           text not null check (hs_code ~ '^[0-9]{2,8}$'),
  code              text not null,
  title             text not null,
  requirement_text  text not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (company_id, hs_code, code)
);

-- The lookup is "which requirements apply to these HS codes", done by
-- generating the prefixes of each code and matching exactly — far cheaper than
-- a LIKE scan, and it uses this index.
create index ccr_master_lookup_idx on public.ccr_master (company_id, hs_code)
  where is_active;

create trigger ccr_master_touch_updated_at
  before update on public.ccr_master
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------- job_ccrs ----

create table public.job_ccrs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  job_id      uuid not null references public.jobs (id) on delete cascade,
  ccr_id      uuid references public.ccr_master (id) on delete set null,
  -- Denormalised so the assessment survives the master being edited later.
  code        text not null,
  title       text not null,
  applied_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (job_id, code)
);

create index job_ccrs_job_idx on public.job_ccrs (company_id, job_id);

-- ------------------------------------------------- job_document_requests ----

create table public.job_document_requests (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  job_id                uuid not null references public.jobs (id) on delete cascade,
  name                  text not null,
  reason                text,
  ccr_code              text,
  status                public.document_request_status not null default 'pending',
  -- Set when a human confirms an arriving document satisfies this request.
  received_document_id  uuid references public.job_documents (id) on delete set null,
  resolved_by           uuid references public.profiles (id) on delete set null,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),

  unique (job_id, name)
);

create index job_document_requests_job_idx
  on public.job_document_requests (company_id, job_id, status);

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
do $$
declare
  t text;
begin
  foreach t in array array['ccr_master', 'job_ccrs', 'job_document_requests'] loop
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
