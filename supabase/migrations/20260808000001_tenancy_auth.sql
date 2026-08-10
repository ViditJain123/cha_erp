-- Multi-tenancy foundation: companies, profiles, JWT claim hook, RLS.
--
-- Isolation model
--   One tenant = one company. Every tenant-owned row carries company_id.
--   The access-token hook stamps company_id / role / is_platform_admin /
--   must_change_password onto the JWT; RLS policies read those claims and never
--   touch a table, which is what keeps them non-recursive and index-free.

create extension if not exists citext;

-- ---------------------------------------------------------------- enums ----

create type public.app_role as enum (
  'platform_admin',   -- us; no company, sees everything
  'company_owner',    -- the "master account" for a company
  'company_admin',    -- can invite and manage team members
  'member'            -- ordinary team member
);

create type public.team_kind as enum (
  'scrutiny',         -- connects a mailbox, works jobs
  'do'                -- delivery order desk; scope TBD
);

create type public.user_status as enum ('invited', 'active', 'disabled');

create type public.company_status as enum ('active', 'suspended');

-- ------------------------------------------------------------ companies ----

create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$'),
  status      public.company_status not null default 'active',
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.companies is 'One row per tenant. The "master account" is the company_owner profile pointing here.';

-- ------------------------------------------------------------- profiles ----

-- Deliberately flat: a user belongs to exactly one company, so there is no
-- memberships join table. That is what lets RLS read company_id off the JWT
-- instead of sub-selecting a membership row (which would recurse).
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  company_id            uuid references public.companies (id) on delete cascade,
  email                 citext not null unique,
  full_name             text,
  role                  public.app_role not null default 'member',
  team                  public.team_kind,
  is_platform_admin     boolean not null default false,
  must_change_password  boolean not null default true,
  status                public.user_status not null default 'invited',
  invited_by            uuid references auth.users (id) on delete set null,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Platform admins stand outside every company; everyone else must be in one.
  constraint profiles_company_matches_role check (
    (is_platform_admin and company_id is null and role = 'platform_admin')
    or (not is_platform_admin and company_id is not null and role <> 'platform_admin')
  )
);

create index profiles_company_id_idx on public.profiles (company_id);
create index profiles_company_team_idx on public.profiles (company_id, team);
create index companies_status_idx on public.companies (status);

-- Exactly one owner per company.
create unique index profiles_one_owner_per_company_idx
  on public.profiles (company_id)
  where role = 'company_owner';

-- ------------------------------------------------------ updated_at ---------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_touch_updated_at
  before update on public.companies
  for each row execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- JWT claim helpers ----

-- Both helpers read the JWT only. Never make a policy helper query a table:
-- profiles-selects-from-profiles is the classic infinite-recursion RLS bug.

create or replace function public.auth_company_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'company_id', '')::uuid;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_platform_admin')::boolean, false);
$$;

create or replace function public.auth_role()
returns public.app_role
language sql
stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'user_role', '')::public.app_role;
$$;

/** True when the caller may invite/manage users inside their own company. */
create or replace function public.can_manage_company()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.auth_role() in ('company_owner', 'company_admin');
$$;

-- --------------------------------------------- custom access token hook ----

-- Runs inside GoTrue on every token issue/refresh. security definer because
-- supabase_auth_admin must read public.profiles, which is otherwise locked down.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  p      public.profiles%rowtype;
begin
  select * into p from public.profiles where id = (event ->> 'user_id')::uuid;

  if found then
    claims := claims
      || jsonb_build_object(
           'company_id',           coalesce(p.company_id::text, ''),
           'user_role',            p.role::text,
           'user_team',            coalesce(p.team::text, ''),
           'is_platform_admin',    p.is_platform_admin,
           'must_change_password', p.must_change_password,
           'user_status',          p.status::text
         );
  else
    -- An auth user with no profile row gets no company. RLS then matches
    -- nothing, which is the correct failure direction.
    claims := claims
      || jsonb_build_object(
           'company_id',           '',
           'user_role',            'member',
           'user_team',            '',
           'is_platform_admin',    false,
           'must_change_password', true,
           'user_status',          'invited'
         );
  end if;

  return jsonb_set(event, '{claims}', claims);

exception when others then
  -- Never let this hook fail a login. An unhandled exception here makes every
  -- sign-in return HTTP 500 — including the platform admin's, which leaves no
  -- way to fix it from the app. Degrade to a claimless token instead: RLS then
  -- matches nothing, which is the safe direction.
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

-- supabase_auth_admin reads profiles from inside the hook; give it a policy so
-- it is not blocked by RLS on the table it must read.
alter table public.profiles enable row level security;
create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin
  using (true);

-- ------------------------------------------------------- grants + RLS ----

alter table public.companies enable row level security;

revoke all on public.companies from anon, authenticated;
revoke all on public.profiles from anon, authenticated;

-- Explicit, because Supabase's default privileges do NOT give service_role DML
-- on newly created tables on current versions — a fresh table lands with only
-- REFERENCES/TRIGGER/TRUNCATE. Without this, every service-role write (admin
-- panel, seed script, worker) fails with "permission denied for table".
-- Repeat this for every table added in future migrations.
grant select, insert, update, delete on public.companies to service_role;
grant select, insert, update, delete on public.profiles to service_role;

grant select on public.companies to authenticated;
grant update (name, settings) on public.companies to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- companies: a user sees only their own; platform admins see all.
-- All writes (create company, suspend, delete) go through the service role.
create policy companies_select on public.companies
  for select to authenticated
  using (id = public.auth_company_id() or public.is_platform_admin());

create policy companies_update on public.companies
  for update to authenticated
  using (id = public.auth_company_id() and public.can_manage_company())
  with check (id = public.auth_company_id());

-- profiles: everyone sees their colleagues (the team directory); platform
-- admins see everyone. Self-service updates are limited to full_name by the
-- column grant above.
-- auth.uid() is wrapped in a scalar subquery so Postgres hoists it into an
-- initplan and evaluates it once per statement rather than once per row.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (company_id is not null and company_id = public.auth_company_id())
    or public.is_platform_admin()
  );

-- Row-level self-update alone would let a user set is_platform_admin = true.
-- The `grant update (full_name)` above is what actually stops that: column
-- privileges are checked before RLS.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
