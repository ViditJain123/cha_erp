-- Deleting a job, and the record that it happened.
--
-- Everything hanging off a job cascades: documents, drafts, exports, events,
-- the DO row, the clearance row, CCR requirements, document requests. That is
-- what makes a delete clean, and also what makes it silent — `job_events` is
-- the audit trail and it goes with the job it describes. So the one row that
-- has to outlive the delete lives here instead.
--
-- Hard delete, not a `deleted_at` flag. Two reasons. A soft-deleted job still
-- matches the ingest matcher on its container and B/L numbers, so a shipper's
-- reply would keep landing on a job nobody can see. And the point of deleting
-- one is usually that the documents went in wrong, which means the files have
-- to leave storage too — and a flag cannot do that.

create table public.deleted_jobs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  -- Not a foreign key: the job it names is gone. That is the whole point.
  job_id       uuid not null,
  -- Enough to answer "what was this?" without the row it described. Kept flat
  -- rather than only inside `snapshot` so the list is readable in SQL.
  title        text,
  job_number   text,
  importer_name text,
  stage        text,
  -- Counts of what went with it, and the storage keys that were removed.
  -- Someone asking "where did job X go" is usually really asking "and did its
  -- checklist go too".
  snapshot     jsonb not null default '{}'::jsonb,
  reason       text,
  deleted_by   uuid references public.profiles (id) on delete set null,
  deleted_at   timestamptz not null default now()
);

create index deleted_jobs_company_idx on public.deleted_jobs (company_id, deleted_at desc);
create index deleted_jobs_job_idx on public.deleted_jobs (job_id);

alter table public.deleted_jobs enable row level security;
revoke all on public.deleted_jobs from anon, authenticated;
-- On current Supabase versions a freshly created table gives service_role only
-- REFERENCES/TRIGGER/TRUNCATE, so without this the route's write fails with
-- "permission denied for table".
grant select, insert, update, delete on public.deleted_jobs to service_role;
grant select on public.deleted_jobs to authenticated;

-- Read-only to members: the row is written by the route under the service role
-- after it has checked the caller is an owner or admin. There is deliberately
-- no insert, update or delete policy — a tombstone a user can edit is not one.
create policy deleted_jobs_select on public.deleted_jobs
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_platform_admin());
