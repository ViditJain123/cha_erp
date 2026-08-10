-- Scrutiny workflow, part 3: who to ask for the missing documents.
--
-- A thin master for now. The real shipper list is coming from the customer;
-- this exists so the flow works before it arrives, and so an address typed once
-- is not typed again.

create table public.shippers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  -- Other names the same shipper appears under on invoices, so a job's supplier
  -- name can be matched without an exact string hit.
  aliases     text[] not null default '{}',
  email       citext not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (company_id, name)
);

create index shippers_company_idx on public.shippers (company_id) where is_active;

create trigger shippers_touch_updated_at
  before update on public.shippers
  for each row execute function public.touch_updated_at();

-- Which address a job's request actually went to, so a re-send goes to the same
-- place and the audit trail is not just free text in an event payload.
alter table public.jobs
  add column shipper_id     uuid references public.shippers (id) on delete set null,
  add column shipper_email  citext;

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
alter table public.shippers enable row level security;
revoke all on public.shippers from anon, authenticated;
grant select, insert, update, delete on public.shippers to service_role;
grant select on public.shippers to authenticated;

create policy shippers_select on public.shippers
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_platform_admin());
