-- The CONTAINERS sheet's missing source: the operator.
--
-- Every job we hold came out of the export with one container row, whatever the
-- bill of lading said — `liv_job1` moves four boxes and `ex_job6` moves six.
-- Reading them properly is the other half of this change; this is the half that
-- covers the documents that cannot be read at all. `ex_job4`'s B/L is a scan
-- with no text layer, and until now there was nowhere on the job to put a
-- container number a person can see and the model cannot.
--
-- The same operator layer as job_boe_header: when rows exist here they are the
-- container list, and when there are none the reading stands. That is what lets
-- "read the documents again" leave a corrected list alone — the draft is
-- rebuilt from the documents, and this table is applied over it afterwards.
--
-- Deliberately not job_do_containers. That table is the delivery-order desk's:
-- its rows carry detention terms, gate-out dates and deposits, it is seeded
-- when the DO is opened rather than when the BE is filed, and a box can be
-- dropped from it once returned. The Bill of Entry declares what was on the
-- B/L. Same numbers, different question, different lifetime.

create table public.job_containers (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  job_id         uuid not null references public.jobs (id) on delete cascade,

  -- The order they are declared in. IGM Sr.No is filled positionally from this
  -- on export, because no document we read carries the IGM line number.
  sr_no          integer not null,

  -- Text, always, and never normalised on the way in: the B/L's spelling is
  -- what the operator checked against.
  container_no   text not null check (length(btrim(container_no)) > 0),
  seal_no        text,
  -- Verbatim, as printed: "40SD96", "20GP", "45G1", "1 X HIGH CUBE 40".
  -- ContainerSize and ContainerTypeCode are derived from it by
  -- packages/core/src/masters/codes.ts, so no code is stored here.
  size_type      text,

  updated_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (job_id, container_no)
);

create index job_containers_job_idx
  on public.job_containers (company_id, job_id, sr_no);

create trigger job_containers_touch_updated_at
  before update on public.job_containers
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array[
    'job_containers'
  ] loop
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
