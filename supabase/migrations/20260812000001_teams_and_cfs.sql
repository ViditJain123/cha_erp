-- Customs clearance, part 1: the people who work it, and where the goods sit.
--
-- Three desks join scrutiny and DO: the customs desk that gets a Bill of Entry
-- noted, passed and out of charge; the CFS people who say whether a delivery
-- can happen on a given day; and customer support, who tell the customer when
-- it cannot.

-- ------------------------------------------------------------- team_kind ----

-- Rebuilt rather than extended. `alter type ... add value` cannot be used in
-- the same transaction that adds it, and the Supabase CLI runs each migration
-- inside one — so the new values would be unusable until the next migration.
-- Same rename-recreate-using-drop shape as job_stage in ...0004.
alter type public.team_kind rename to team_kind_old;

create type public.team_kind as enum (
  'scrutiny',         -- connects a mailbox, works jobs
  'do',               -- delivery order desk
  'customs',          -- noting, passing, duty, out of charge
  'cfs',              -- approves delivery days for one container freight station
  'customer_support'  -- told when a delivery does not happen
);

alter table public.profiles
  alter column team type public.team_kind using team::text::public.team_kind;

drop type public.team_kind_old;

-- ------------------------------------------------------------ cfs_master ----

-- Where the cargo is de-stuffed and delivered from. Modelled on shipping_lines:
-- company-scoped, retired rather than deleted, unique by name.
create table public.cfs_master (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  name           text not null check (length(btrim(name)) > 0),
  code           text,
  -- The customs station it serves. Free text for now — there is no port master,
  -- and the legacy PORTS list in packages/core is not tenant data.
  port           text,
  -- Where the delivery-plan nudge goes when no user is assigned to this CFS.
  contact_email  citext,
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (company_id, name)
);

create index cfs_master_company_idx on public.cfs_master (company_id) where is_active;

create trigger cfs_master_touch_updated_at
  before update on public.cfs_master
  for each row execute function public.touch_updated_at();

-- Which CFS a 'cfs' team member works. Null means they see no queue at all,
-- which is the safe default: better an empty list than another CFS's work.
alter table public.profiles
  add column cfs_id uuid references public.cfs_master (id) on delete set null;

create index profiles_cfs_idx on public.profiles (cfs_id) where cfs_id is not null;

-- ------------------------------------------------------- checklist duty ----

-- The duty printed on the Logi-Sys checklist the documents desk uploaded.
--
-- It lives here rather than on the clearance row because it is captured at the
-- same moment as job_number, branch_id and eta — long before anyone opens the
-- clearance tab — and because there must be exactly one of it: passing compares
-- against this figure, and a revised checklist has to move the comparison with
-- it.
alter table public.jobs
  add column checklist_duty numeric(14, 2) check (checklist_duty >= 0);

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
alter table public.cfs_master enable row level security;
revoke all on public.cfs_master from anon, authenticated;
grant select, insert, update, delete on public.cfs_master to service_role;
grant select on public.cfs_master to authenticated;

create policy cfs_master_select on public.cfs_master
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_platform_admin());
