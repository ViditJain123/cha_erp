-- Customs clearance, part 2: what happens to a job after scrutiny hands it on.
--
-- Entry Inwards → noting → RMS routes the Bill of Entry → passing (appraiser,
-- then AC) → the assessed duty is compared against the checklist → duty paid →
-- goods registered at the shed → examined → any NOC → out of charge → a
-- delivery day agreed with the CFS → delivered.
--
-- Like the delivery order, this is a side table with its own status rather than
-- more values on jobs.stage: the two tracks run at once, and one linear enum
-- cannot say "in passing" and "waiting on a container deposit" at the same time.
--
-- The control this exists for is the duty comparison. If customs assessed a
-- different figure from the one on the checklist we showed the client, someone
-- got a classification or a value wrong — so the job goes back to scrutiny
-- rather than quietly being paid.

create type public.clearance_status as enum (
  'noting',              -- the BE has to be filed and noted against the IGM
  'passing',             -- with the appraiser, then the AC
  'duty_variance',       -- assessed duty differs from the checklist; back with scrutiny
  'duty_payment',        -- passed; the challan has to be paid
  'goods_registration',  -- duty paid; registering the goods at the shed
  'examination',         -- registered; being examined
  'out_of_charge',       -- examined; awaiting out of charge and any NOC
  'delivery_planning',   -- cleared; agreeing a delivery day with the CFS
  'delivered'
);

-- How the Risk Management System routed the BE. 'facilitated' means it skipped
-- assessment entirely, so passing has no work in it.
create type public.rms_route as enum ('facilitated', 'assessment', 'examination');

create type public.clearance_query_status as enum ('open', 'replied', 'closed');

create type public.noc_status as enum ('not_required', 'pending', 'received');

-- -------------------------------------------------------- job_clearance ----

create table public.job_clearance (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  job_id                uuid not null references public.jobs (id) on delete cascade,
  status                public.clearance_status not null default 'noting',

  -- Noting is a token by design: a number, a date, and it is done. There is no
  -- workflow inside it.
  be_number             text,
  be_date               date,
  noted_at              timestamptz,
  noted_by              uuid references public.profiles (id) on delete set null,

  rms_route             public.rms_route,

  -- Passing. The entry inwards date is the one date that matters here: it fixes
  -- the rate of exchange and the duty applicable to the consignment.
  entry_inwards_date    date,
  appraiser_passed_at   timestamptz,
  ac_passed_at          timestamptz,

  -- The duty control. The figure being compared against lives on
  -- jobs.checklist_duty, deliberately not copied here — one source of truth, so
  -- a revised checklist moves the comparison with it.
  assessed_duty         numeric(14, 2) check (assessed_duty >= 0),
  duty_checked_at       timestamptz,
  duty_checked_by       uuid references public.profiles (id) on delete set null,
  variance_raised_at    timestamptz,
  variance_resolved_at  timestamptz,
  variance_note         text,

  duty_challan_no       text,
  duty_paid_on          date,
  duty_amount           numeric(14, 2) check (duty_amount >= 0),

  goods_registered_on   date,
  examined_on           date,
  out_of_charge_on      date,
  ooc_reference         text,

  delivered_on          date,

  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (job_id)
);

create index job_clearance_company_status_idx
  on public.job_clearance (company_id, status);

create trigger job_clearance_touch_updated_at
  before update on public.job_clearance
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------ job_clearance_queries ----

-- Customs raises queries during assessment and again at the shed. There can be
-- several, they are answered by email, and none of them may be outstanding when
-- the BE is passed.
create table public.job_clearance_queries (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  job_clearance_id    uuid not null references public.job_clearance (id) on delete cascade,
  job_id              uuid not null references public.jobs (id) on delete cascade,
  raised_on           date not null,
  source              text not null default 'appraiser'
                        check (source in ('appraiser', 'ac', 'shed', 'pga')),
  query_text          text not null check (length(btrim(query_text)) > 0),
  status              public.clearance_query_status not null default 'open',
  replied_on          date,
  reply_note          text,
  reply_document_id   uuid references public.job_documents (id) on delete set null,
  resolved_by         uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index job_clearance_queries_job_idx
  on public.job_clearance_queries (company_id, job_id, status);

create trigger job_clearance_queries_touch_updated_at
  before update on public.job_clearance_queries
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- job_clearance_nocs ----

-- A Pollution Control Board NOC and anything shaped like it — FSSAI, Plant
-- Quarantine, the Drug Controller. Kept generic so a new authority costs a row
-- rather than a migration. Nothing gets out of charge while one is pending.
create table public.job_clearance_nocs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  job_clearance_id  uuid not null references public.job_clearance (id) on delete cascade,
  job_id            uuid not null references public.jobs (id) on delete cascade,
  authority         text not null check (length(btrim(authority)) > 0),
  reference         text,
  status            public.noc_status not null default 'pending',
  applied_on        date,
  received_on       date,
  document_id       uuid references public.job_documents (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (job_clearance_id, authority)
);

create index job_clearance_nocs_job_idx
  on public.job_clearance_nocs (company_id, job_id, status);

create trigger job_clearance_nocs_touch_updated_at
  before update on public.job_clearance_nocs
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- job_delivery_plans ----

-- A day proposed to the CFS, and their answer.
--
-- Rows rather than columns on job_clearance because a refused day is re-planned
-- for another one, and both attempts have to survive — "why was this not
-- delivered on Tuesday" is the question this table exists to answer.
--
-- Reuses document_request_status rather than twinning it, as job_do_documents
-- already does: 'received' reads as approved, 'waived' as refused.
create table public.job_delivery_plans (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  job_clearance_id    uuid not null references public.job_clearance (id) on delete cascade,
  job_id              uuid not null references public.jobs (id) on delete cascade,
  planned_for         date not null,
  cfs_id              uuid references public.cfs_master (id) on delete set null,
  status              public.document_request_status not null default 'pending',
  decided_at          timestamptz,
  decided_by          uuid references public.profiles (id) on delete set null,
  decision_note       text,
  -- Support is told when a day is refused. A stamp and a timeline row, like
  -- job_do_invoices.accounts_notified_at.
  support_notified_at timestamptz,
  requested_by        uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (job_clearance_id, planned_for)
);

-- The CFS person's queue: their station's pending days, soonest first.
create index job_delivery_plans_queue_idx
  on public.job_delivery_plans (company_id, cfs_id, planned_for)
  where status = 'pending';

create trigger job_delivery_plans_touch_updated_at
  before update on public.job_delivery_plans
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array[
    'job_clearance',
    'job_clearance_queries',
    'job_clearance_nocs',
    'job_delivery_plans'
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
