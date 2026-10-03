-- An organization import has to be able to say "I am still running".
--
-- The repository upload is a full snapshot: every row in the file is upserted,
-- then every row the file did not mention is deactivated. That second step was
-- written as "deactivate everything not stamped with this import's id", which
-- is correct for one import and destructive for two.
--
-- It happened. On 24 August 2026 the same file was uploaded three times within
-- ten seconds — a button pressed again because nothing said the first press had
-- landed. Each run's retire sweep ran while the others were still upserting, so
-- each retired the rows the others had just stamped: retired_count 3000, then
-- 1000, then 0. Three thousand of five thousand and ninety-one parties ended up
-- inactive while their own raw payload still said "Is Active": "True", and both
-- resolution paths skip an inactive row. Every unbound importer and supplier in
-- the corpus traces back to this.
--
-- Two changes, here and in the route:
--
--   1. `status`, so a second upload for the same company can be refused while
--      one is in flight instead of racing it.
--   2. The route's sweep now scopes by time rather than by import id — it
--      retires only rows it did not itself touch, which the updated_at trigger
--      already records. That alone makes concurrent runs converge on the file;
--      the status column is what makes the collision visible rather than
--      merely survivable.
--
-- Existing rows are backfilled to 'done'. The three August rows did finish;
-- what they did while finishing is the problem, and that is repaired by
-- re-uploading the file once through the fixed route.

create type public.organization_import_status as enum ('running', 'done', 'failed');

-- Added with a 'done' default so the rows already here are backfilled as the
-- finished imports they are, then the default flips to 'running': an insert
-- that forgets to say should read as in flight, not as complete.
alter table public.organization_imports
  add column status public.organization_import_status not null default 'done',
  -- Why a failed import stopped, in the words the operator saw.
  add column error text;

alter table public.organization_imports
  alter column status set default 'running';

comment on column public.organization_imports.status is
  'running while the upsert and retire sweep are in flight. A second upload for the same company is refused until it is done or failed.';

-- A company may have at most one import in flight. This is the real guard; the
-- route's check is the friendly error in front of it.
create unique index organization_imports_one_running
  on public.organization_imports (company_id)
  where status = 'running';
