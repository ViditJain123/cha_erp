-- Delivery Order workflow, part 2: the DO track itself.
--
-- DO runs *beside* scrutiny, not after it, so it cannot live on jobs.stage —
-- that enum is a single linear path. It gets its own row per job with its own
-- status, the way job_ccrs and job_document_requests already hang off jobs.
--
-- Deadlines are deliberately not stored. Last free day, the invoice call and
-- the deposit refund window are all derived at read time in apps/web/lib/do.ts,
-- because a corrected ETA or a changed free-day count would otherwise leave a
-- stale date behind — and that stale date is the one that costs money.

create type public.do_status as enum (
  'open',         -- created with the job; the B/L checks are outstanding
  'documents',    -- B/L checked and mode decided; assembling the line's papers
  'invoice',      -- the line's proforma invoice is in and being scrutinised
  'payment',      -- scrutinised; paying and telling accounts
  'awaiting_do',  -- paid and proof sent; waiting on the line or ODeX
  'do_received',  -- DO in hand, operations can take delivery
  'delivered',    -- delivery taken; the deposit clock is running
  'closed'        -- final invoice settled and every deposit resolved
);

create type public.do_invoice_kind as enum ('proforma', 'final');

create type public.do_deposit_status as enum (
  'not_applicable',  -- a bond or standing deposit covers this box
  'pending',
  'paid',
  'claimed',         -- refund applied for
  'refunded',
  'forfeited'        -- written off, usually against detention
);

-- ------------------------------------------------------------- job_do ----

create table public.job_do (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  job_id                 uuid not null references public.jobs (id) on delete cascade,
  status                 public.do_status not null default 'open',

  -- Step 1: the bill of lading. Null is "nobody has looked yet", which is not
  -- the same as "not surrendered" — the whole point of the check.
  bl_surrendered         boolean,
  bl_surrender_mode      text check (bl_surrender_mode in ('telex', 'express', 'original')),
  bl_collected           boolean not null default false,   -- the original picked up
  bl_checked_at          timestamptz,
  bl_checked_by          uuid references public.profiles (id) on delete set null,

  -- Step 2: detention free time. free_time_from is seeded from jobs.eta and
  -- stays editable, because free time is often counted from actual discharge.
  free_days              integer check (free_days >= 0),
  free_days_source       text check (free_days_source in
                           ('bill_of_lading', 'shipping_line', 'manual')),
  free_time_from         date,

  -- Step 3: how the cargo moves, and what secures the box.
  delivery_mode          public.do_delivery_mode,
  shipping_line_id       uuid references public.shipping_lines (id) on delete set null,
  security_id            uuid references public.importer_line_securities (id) on delete set null,
  -- The resolved answer for this job, kept separately from security_id so that
  -- "we checked and no bond covers this" is distinguishable from "not checked".
  security_covers        boolean,
  deposit_expected       numeric(14, 2),

  -- High sea sales: swaps in a different document set and puts those papers to
  -- the shipping line.
  is_high_sea_sale       boolean not null default false,
  hss_flagged_at         timestamptz,
  hss_docs_sent_at       timestamptz,

  -- The delivery order itself, and the delivery it authorises.
  do_number              text,
  do_channel             text check (do_channel in ('email', 'odex')),
  do_received_at         date,
  do_valid_until         date,
  operations_notified_at timestamptz,
  delivered_at           date,   -- starts the 15-day deposit recovery window

  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (job_id)
);

create index job_do_company_status_idx on public.job_do (company_id, status);

create trigger job_do_touch_updated_at
  before update on public.job_do
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------- job_do_containers ----

-- Detention and deposits run per container, so one row each. Seeded from the
-- job_identifiers rows of kind 'container' that ingest already captures.
-- The nullable free_* columns inherit from job_do when unset, so the common
-- case — every box on the same terms — needs no typing at all.
create table public.job_do_containers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  job_do_id            uuid not null references public.job_do (id) on delete cascade,
  job_id               uuid not null references public.jobs (id) on delete cascade,
  container_no         text not null check (length(btrim(container_no)) > 0),
  size_type            text,

  free_days            integer check (free_days >= 0),
  free_time_from       date,
  gated_out_on         date,
  returned_on          date,   -- empty return; what makes the deposit claimable

  deposit_amount       numeric(14, 2),
  deposit_status       public.do_deposit_status not null default 'not_applicable',
  deposit_paid_on      date,
  deposit_claimed_on   date,
  deposit_refunded_on  date,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (job_do_id, container_no)
);

create index job_do_containers_job_idx
  on public.job_do_containers (company_id, job_id);

create trigger job_do_containers_touch_updated_at
  before update on public.job_do_containers
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------- job_do_documents ----

-- What the line wants before it will release. There is no master of these yet,
-- so the set is typed per job; required_for lets the high-sea-sales toggle swap
-- one set for another without destroying rows already settled.
--
-- Reuses document_request_status rather than inventing a second identical enum.
create table public.job_do_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  job_do_id    uuid not null references public.job_do (id) on delete cascade,
  job_id       uuid not null references public.jobs (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  required_for text not null default 'do' check (required_for in ('do', 'hss')),
  status       public.document_request_status not null default 'pending',
  document_id  uuid references public.job_documents (id) on delete set null,
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),

  unique (job_do_id, name)
);

create index job_do_documents_job_idx
  on public.job_do_documents (company_id, job_id, status);

-- --------------------------------------------------- job_do_invoices ----

-- Two rounds, one row each: the proforma raised before arrival, and the final
-- invoice once detention and ground rent are known.
create table public.job_do_invoices (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  job_do_id            uuid not null references public.job_do (id) on delete cascade,
  job_id               uuid not null references public.jobs (id) on delete cascade,
  kind                 public.do_invoice_kind not null,

  invoice_number       text,
  invoice_date         date,
  amount               numeric(14, 2),
  currency             text not null default 'INR',
  document_id          uuid references public.job_documents (id) on delete set null,

  scrutinised_at       timestamptz,
  scrutinised_by       uuid references public.profiles (id) on delete set null,
  scrutiny_note        text,
  -- A stamp and a timeline entry, nothing more, until there is an accounts
  -- module to hand off to.
  accounts_notified_at timestamptz,

  paid_on              date,
  payment_amount       numeric(14, 2),
  payment_reference    text,
  proof_document_id    uuid references public.job_documents (id) on delete set null,
  proof_sent_at        timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (job_do_id, kind)
);

create index job_do_invoices_job_idx
  on public.job_do_invoices (company_id, job_id);

create trigger job_do_invoices_touch_updated_at
  before update on public.job_do_invoices
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array[
    'job_do',
    'job_do_containers',
    'job_do_documents',
    'job_do_invoices'
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
