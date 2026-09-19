-- ITEMS: the importer's product master, the operator's edits to items, and the
-- two item instructions a mail thread can carry.
--
-- Contract: docs/boe-mapping/06-items.md.

-- ---------------------------------------------------------------------------
-- 1. The product master
-- ---------------------------------------------------------------------------
-- The customer's rule for the CTH column: a description this importer has never
-- filed is shown to the operator once; what they confirm is saved and used from
-- then on without asking again.
--
-- It replaces "job memory", a JSON file on the web server's disk that only the
-- retired /legacy approve button wrote, so a classification made on the ERP job
-- screen was never remembered.
--
-- Keyed importer + normalised description, not description alone: the same
-- words classify differently by what the importer does with the goods (pulp
-- for paper against pulp for diapers), and one importer's end use or brand
-- carried onto another's Bill of Entry is a false declaration.

create table public.product_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  importer_org_id uuid not null references public.organizations (id) on delete cascade,

  -- productDescriptionKey() in @checklist/core: upper-cased, punctuation and
  -- runs of space collapsed. The description as first seen is kept beside it.
  description_key text not null check (length(btrim(description_key)) > 0),
  description text not null,

  cth text not null check (cth ~ '^[0-9]{8}$'),
  general_description text,
  brand text,
  model text,
  end_use_code text check (end_use_code ~ '^[A-Z]{3}[0-9]{3}$'),
  exim_scheme_code text check (exim_scheme_code ~ '^[0-9]{2}$'),

  -- The notification choices a person made for these goods that the masters
  -- cannot make alone: which 45/2025 serial or sub-entry, which contested cess
  -- serial, a trade-remedy producer row. Shape: { basic?: {notification,
  -- serial}, compCess?: {...}, igstExemption?: {...}, ... }.
  notifications jsonb not null default '{}'::jsonb,

  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  source_job_id uuid references public.jobs (id) on delete set null,
  times_used integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (importer_org_id, description_key)
);

create index product_master_company_idx
  on public.product_master (company_id, importer_org_id);

create trigger product_master_touch_updated_at
  before update on public.product_master
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The operator's edits to items
-- ---------------------------------------------------------------------------
-- The same operator layer as job_containers: the draft is rebuilt from the
-- documents on every re-read, and these rows are applied over it afterwards,
-- so a person's decision on a line is never undone by reading the PDF again.
--
-- One row per line, addressed the way the Bill of Entry addresses it: invoice
-- serial and item serial. `fields` holds only what the operator changed, as a
-- partial DraftItem.

create table public.job_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,

  invoice_sr_no integer not null check (invoice_sr_no > 0),
  item_sr_no integer not null check (item_sr_no > 0),

  fields jsonb not null default '{}'::jsonb,
  -- The classification was looked at and confirmed — clears the
  -- "confirm classification" blocker even when nothing was changed.
  classification_confirmed boolean not null default false,

  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (job_id, invoice_sr_no, item_sr_no)
);

create index job_items_job_idx on public.job_items (company_id, job_id);

create trigger job_items_touch_updated_at
  before update on public.job_items
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array['product_master', 'job_items'] loop
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

-- ---------------------------------------------------------------------------
-- 3. Item instructions in the mail thread
-- ---------------------------------------------------------------------------
-- End use is "as per instruction from the importer", and a missed preferential
-- rate is settled by asking the importer whether to take the benefit. Both
-- answers arrive in the thread; each is kept with the sentence it came from.

alter table public.job_mail_instructions
  add column end_use text,
  add column end_use_quote text,
  add column claim_fta_benefit boolean,
  add column claim_fta_benefit_quote text;
