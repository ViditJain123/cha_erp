-- Delivery Order workflow, part 1: the masters the DO desk reads from.
--
-- Two things a delivery order turns on, and neither is derivable from the
-- shipment documents: which shipping line's terms apply, and whether the
-- importer already holds security with that line. Both are typed once here
-- rather than on every job.

create type public.do_delivery_mode as enum (
  'loaded',     -- the full container leaves the port for the importer's premises
  'destuffed'   -- cargo comes out at the CFS and the box is handed straight back
);

-- --------------------------------------------------------- shipping_lines ----

create table public.shipping_lines (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  name               text not null check (length(btrim(name)) > 0),
  -- The carrier is printed on the B/L however the carrier feels like printing
  -- it — 'INTERASIA LINES', 'EMIRATES SHIPPING LINE FZE'. Same idea as
  -- shippers.aliases: match without demanding an exact string hit.
  aliases            text[] not null default '{}',
  -- The line's Indian agent, who is usually who you actually correspond with.
  agent_name         text,
  do_email           citext,
  -- Lines that issue on ODeX do not send the DO by mail, so the UI offers a
  -- "record what you did there" form instead of a compose panel. There is no
  -- ODeX integration.
  issues_do_via      text not null default 'email'
                       check (issues_do_via in ('email', 'odex')),
  -- Seeds a job's detention free period when the B/L does not state one.
  default_free_days  integer check (default_free_days >= 0),
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (company_id, name)
);

create index shipping_lines_company_idx on public.shipping_lines (company_id)
  where is_active;

create trigger shipping_lines_touch_updated_at
  before update on public.shipping_lines
  for each row execute function public.touch_updated_at();

-- --------------------------------------------- shipping_line_deposit_rates ----

-- The container deposit is a two-dimensional matrix — mode by container size —
-- so it is rows rather than a jsonb blob on the line: it has to be editable in
-- a form, and the app has no form library to edit jsonb with.
create table public.shipping_line_deposit_rates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  shipping_line_id  uuid not null references public.shipping_lines (id) on delete cascade,
  delivery_mode     public.do_delivery_mode not null,
  -- '20', '40', '40HC', or '*' for a rate that applies whatever the size.
  container_size    text not null check (length(btrim(container_size)) > 0),
  amount            numeric(14, 2) not null check (amount >= 0),
  currency          text not null default 'INR',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (shipping_line_id, delivery_mode, container_size)
);

create index shipping_line_deposit_rates_line_idx
  on public.shipping_line_deposit_rates (company_id, shipping_line_id);

create trigger shipping_line_deposit_rates_touch_updated_at
  before update on public.shipping_line_deposit_rates
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------ importer_line_securities ----

-- A yearly bond or standing deposit lodged with one line by one importer. Held
-- importer-specific because that is how the lines hold them.
--
-- There is no importer master yet — jobs.importer_name is free text off the
-- documents — so this keys on the name plus aliases, exactly as shippers does.
-- When an importer master lands this table gains an importer_id and the name
-- becomes the fallback.
create table public.importer_line_securities (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  shipping_line_id   uuid not null references public.shipping_lines (id) on delete cascade,
  importer_name      text not null check (length(btrim(importer_name)) > 0),
  importer_aliases   text[] not null default '{}',
  kind               text not null check (kind in ('yearly_bond', 'standing_deposit')),
  reference          text,
  amount             numeric(14, 2),
  valid_from         date,
  valid_to           date,
  -- Whether holding this removes the per-container deposit for each mode. Not
  -- every bond covers a container leaving the port loaded.
  covers_loaded      boolean not null default true,
  covers_destuffed   boolean not null default true,
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (company_id, shipping_line_id, importer_name, kind)
);

create index importer_line_securities_lookup_idx
  on public.importer_line_securities (company_id, shipping_line_id)
  where is_active;

create trigger importer_line_securities_touch_updated_at
  before update on public.importer_line_securities
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
do $$
declare
  t text;
begin
  foreach t in array array[
    'shipping_lines',
    'shipping_line_deposit_rates',
    'importer_line_securities'
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
