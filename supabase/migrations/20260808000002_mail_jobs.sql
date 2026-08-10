-- Mailbox ingestion and jobs.
--
-- Flow: a scrutiny user connects their Outlook mailbox -> the worker polls it
-- every 5 minutes -> each new message with attachments is classified and either
-- attached to an existing job, opens a new one, or is skipped with a reason.
--
-- Every table here is tenant-owned and carries company_id, protected by the
-- same JWT-claim RLS pattern established in the tenancy migration.

-- ---------------------------------------------------------------- enums ----

create type public.mail_provider as enum ('microsoft');

create type public.connection_status as enum (
  'active',
  'needs_reauth',   -- refresh token rejected; the user must reconnect
  'disabled'
);

create type public.job_source as enum ('email', 'manual');

create type public.job_stage as enum (
  'new',
  'documents_received',
  'exported',            -- Logi-Sys spreadsheet downloaded
  'checklist_uploaded',  -- checklist PDF came back from Logi-Sys
  'closed'
);

-- Superset of @checklist/extraction's DocType: adds license, svb_order and the
-- returned checklist. `unknown` replaces that package's `other`.
create type public.document_type as enum (
  'invoice',
  'bill_of_lading',
  'air_waybill',
  'packing_list',
  'certificate_of_origin',
  'certificate_of_analysis',
  'license',
  'svb_order',
  'checklist',
  'unknown'
);

create type public.identifier_kind as enum (
  'bl',
  'awb',
  'invoice',
  'container',
  'po',
  'conversation'     -- the Graph conversationId, for reply threads
);

create type public.mail_outcome as enum (
  'created_job',
  'attached',
  'skipped',
  'error'
);

-- ------------------------------------------------------ mail_connections ----

create table public.mail_connections (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  provider              public.mail_provider not null default 'microsoft',
  -- The Graph /me id, which is immutable. The address can change; this cannot.
  provider_account_id   text not null,
  email_address         citext not null,
  display_name          text,
  scopes                text[] not null default '{}',

  -- AES-256-GCM ciphertext. Microsoft rotates the refresh token on every
  -- exchange, so the refresh column is rewritten on each refresh.
  access_token_enc      text,
  refresh_token_enc     text,
  token_expires_at      timestamptz,

  -- Opaque Graph cursor. Primed with $deltatoken=latest on first connect so we
  -- never enumerate an entire historical mailbox.
  delta_link            text,
  delta_updated_at      timestamptz,

  status                public.connection_status not null default 'active',
  last_polled_at        timestamptz,
  next_poll_at          timestamptz not null default now(),
  consecutive_failures  integer not null default 0,
  last_error            text,

  -- Claim lock: one worker at a time per connection.
  locked_at             timestamptz,
  locked_by             text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (provider, provider_account_id),
  unique (company_id, email_address)
);

-- The worker's scheduling query.
create index mail_connections_due_idx
  on public.mail_connections (next_poll_at)
  where status = 'active';
create index mail_connections_company_idx on public.mail_connections (company_id);

-- ----------------------------------------------------------- oauth_states ----

-- PKCE state, held server-side rather than in a cookie: the Microsoft callback
-- is a cross-site top-level redirect, and a single-use DB row also gives an
-- audit trail. A Lax cookie carrying the same state is checked as well.
create table public.oauth_states (
  state          text primary key,
  company_id     uuid not null references public.companies (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  code_verifier  text not null,
  redirect_to    text,
  expires_at     timestamptz not null default now() + interval '10 minutes',
  created_at     timestamptz not null default now()
);

create index oauth_states_expiry_idx on public.oauth_states (expires_at);

-- ------------------------------------------------------------------ jobs ----

create table public.jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  -- No job-number generation yet; this is free text for now.
  reference      text,
  title          text,
  stage          public.job_stage not null default 'new',
  source         public.job_source not null default 'manual',
  importer_name  text,
  supplier_name  text,
  created_by     uuid references public.profiles (id) on delete set null,
  assigned_to    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index jobs_company_created_idx on public.jobs (company_id, created_at desc);
create index jobs_company_stage_idx on public.jobs (company_id, stage, updated_at desc);

-- ------------------------------------------------------- mail_messages ----

create table public.mail_messages (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  connection_id        uuid not null references public.mail_connections (id) on delete cascade,
  -- The idempotency key: replaying a delta page inserts nothing new.
  provider_message_id  text not null,
  internet_message_id  text,
  conversation_id      text,
  subject              text,
  from_address         citext,
  from_name            text,
  received_at          timestamptz,
  has_attachments      boolean not null default false,
  outcome              public.mail_outcome,
  skip_reason          text,
  job_id               uuid references public.jobs (id) on delete set null,
  match_score          integer,
  attempts             integer not null default 0,
  last_error           text,
  processed_at         timestamptz,
  created_at           timestamptz not null default now(),

  unique (connection_id, provider_message_id)
);

create index mail_messages_unprocessed_idx
  on public.mail_messages (connection_id, created_at)
  where processed_at is null;
create index mail_messages_company_idx on public.mail_messages (company_id, received_at desc);
create index mail_messages_conversation_idx on public.mail_messages (company_id, conversation_id);

-- -------------------------------------------------------- job_identifiers ----

-- This table *is* the matcher's index: "does this email belong to a job we
-- already have?" is a lookup on (company_id, kind, value).
create table public.job_identifiers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  job_id      uuid not null references public.jobs (id) on delete cascade,
  kind        public.identifier_kind not null,
  -- Uppercased, non-alphanumerics stripped. The same normalisation must be
  -- applied on write and on lookup or matching silently stops working.
  value       text not null,
  value_raw   text not null,
  created_at  timestamptz not null default now(),

  -- One identifier belongs to one job within a company. A conflict here is not
  -- an error: it is precisely the signal that the mail belongs to that job.
  unique (company_id, kind, value)
);

create index job_identifiers_job_idx on public.job_identifiers (job_id);

-- --------------------------------------------------------- job_documents ----

create table public.job_documents (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  job_id           uuid not null references public.jobs (id) on delete cascade,
  mail_message_id  uuid references public.mail_messages (id) on delete set null,
  doc_type         public.document_type not null default 'unknown',
  file_name        text not null,
  storage_bucket   text not null default 'job-documents',
  storage_path     text not null,
  mime_type        text,
  size_bytes       bigint,
  -- Dedupes a document resent across several emails.
  sha256           text not null,
  classification   jsonb,
  classified_at    timestamptz,
  source           text not null default 'email' check (source in ('email', 'upload', 'system')),
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),

  unique (company_id, sha256)
);

create index job_documents_job_idx on public.job_documents (company_id, job_id, created_at);

-- ----------------------------------------------------------- job_exports ----

create table public.job_exports (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  job_id            uuid not null references public.jobs (id) on delete cascade,
  kind              text not null default 'logisys_xlsx',
  storage_bucket    text not null default 'job-exports',
  storage_path      text not null,
  -- Which generator produced it, so placeholder exports stay identifiable once
  -- the real Logi-Sys column mapping lands.
  template_version  text not null,
  generated_by      uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index job_exports_job_idx on public.job_exports (company_id, job_id, created_at desc);

-- ------------------------------------------------------------ job_events ----

create table public.job_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  job_id         uuid references public.jobs (id) on delete cascade,
  actor_kind     text not null default 'system' check (actor_kind in ('user', 'worker', 'system')),
  actor_user_id  uuid references public.profiles (id) on delete set null,
  type           text not null,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index job_events_job_idx on public.job_events (company_id, job_id, created_at desc);

-- ------------------------------------------------------------- triggers ----

create trigger mail_connections_touch_updated_at
  before update on public.mail_connections
  for each row execute function public.touch_updated_at();

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: on current Supabase versions a freshly
-- created table gives service_role only REFERENCES/TRIGGER/TRUNCATE, so every
-- worker write would fail with "permission denied for table".
do $$
declare
  t text;
begin
  foreach t in array array[
    'mail_connections', 'mail_messages', 'oauth_states', 'jobs',
    'job_identifiers', 'job_documents', 'job_exports', 'job_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

-- Read access for members of the owning company; platform admins see all.
-- Writes are service-role only for everything the worker owns; the UI writes
-- jobs and documents through server actions that scope company_id themselves.
do $$
declare
  t text;
begin
  foreach t in array array[
    'mail_connections', 'mail_messages', 'jobs',
    'job_identifiers', 'job_documents', 'job_exports', 'job_events'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (company_id = public.auth_company_id() or public.is_platform_admin())
    $f$, t);
  end loop;
end;
$$;

-- oauth_states is never read by the browser: the callback runs server-side.
-- No authenticated policy at all, so even a leaked state is unreadable.

-- Jobs are the one thing users create and edit directly.
grant insert, update on public.jobs to authenticated;

create policy jobs_insert on public.jobs
  for insert to authenticated
  with check (company_id = public.auth_company_id());

-- `with check` as well as `using`: without it a member could re-parent a job
-- into another tenant.
create policy jobs_update on public.jobs
  for update to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

-- ---------------------------------------------------------------- storage ----

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-documents', 'job-documents', false, 26214400,
   array['application/pdf', 'image/jpeg', 'image/png']),
  ('job-exports', 'job-exports', false, 10485760,
   array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Object keys are {company_id}/{job_id}/{uuid}-{filename}, so the first path
-- segment is the tenant key. storage.foldername() is 1-indexed — [0] yields
-- NULL and the policy would silently match nothing.
create policy job_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('job-documents', 'job-exports')
    and (storage.foldername(name))[1] = public.auth_company_id()::text
  );

create policy job_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('job-documents', 'job-exports')
    and (storage.foldername(name))[1] = public.auth_company_id()::text
  );
