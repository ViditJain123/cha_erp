-- Scrutiny workflow, part 1: the stage machine, the branch master, and the job
-- details captured when the checklist comes back from Logi-Sys.
--
-- The process has two branches. Documents ends when the checklist PDF is
-- uploaded together with the branch, job number and ETA; scrutiny begins at the
-- same moment. Everything after that lives in later migrations.

-- ---------------------------------------------------------------- stages ----

-- Postgres will not drop an enum value that rows may reference, so the enum is
-- rebuilt rather than altered. 'checklist_uploaded' folds into 'scrutiny':
-- uploading the checklist *is* what starts scrutiny.
alter type public.job_stage rename to job_stage_old;

create type public.job_stage as enum (
  'new',
  'documents_received',
  'exported',             -- Logi-Sys spreadsheet downloaded
  'scrutiny',             -- checklist is back; CCRs and missing documents
  'awaiting_shipper',     -- asked the shipper for what is missing
  'checklist_revision',   -- documents branch is updating the checklist
  'noting',               -- scrutiny done; noting has no system yet
  'closed'
);

alter table public.jobs
  alter column stage drop default,
  alter column stage type public.job_stage
    using (
      case stage::text
        when 'checklist_uploaded' then 'scrutiny'
        else stage::text
      end
    )::public.job_stage,
  alter column stage set default 'new';

drop type public.job_stage_old;

-- --------------------------------------------------------------- branches ----

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  code        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (company_id, name)
);

create index branches_company_idx on public.branches (company_id) where is_active;

create trigger branches_touch_updated_at
  before update on public.branches
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ job details ----

alter table public.jobs
  add column branch_id  uuid references public.branches (id) on delete set null,
  -- Free text: the number is issued by Logi-Sys, not by us.
  add column job_number text,
  add column eta        date,
  add column remarks    text,
  -- Bare digits, no dots or spaces — the convention used throughout
  -- packages/core/src/masters. Drives CCR lookup; user-editable because the
  -- classifier is not always right.
  add column hs_codes   text[] not null default '{}';

create index jobs_company_job_number_idx on public.jobs (company_id, job_number)
  where job_number is not null;

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: on current Supabase versions a freshly
-- created table gives service_role only REFERENCES/TRIGGER/TRUNCATE.
alter table public.branches enable row level security;
revoke all on public.branches from anon, authenticated;
grant select, insert, update, delete on public.branches to service_role;
grant select on public.branches to authenticated;

create policy branches_select on public.branches
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_platform_admin());
