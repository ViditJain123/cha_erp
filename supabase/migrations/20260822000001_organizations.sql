-- The organization repository: the party master, exported from Logi-Sys.
--
-- Logi-Sys resolves a party from its own repository, keyed by name + branch +
-- AD code. The GENERAL sheet has no IEC or GSTIN column to fall back on, so a
-- name we invent from the shipping documents either fails the import or binds
-- to the wrong party. "M/S. ELITE POLYPLUS" off a bill of lading is
-- "ELITE POLYPLUS" in the repository; "ASIA SHIGEN INTERNATIONAL" is
-- "ASIA SHIGEN INTERNATIONAL CO., LTD".
--
-- So the CHA exports Organization Repository -> XLSX out of Logi-Sys and
-- uploads it here, and every party value the workbook carries is read back out
-- of this table rather than typed.
--
-- This is the importer master that 20260811000001_do_masters.sql said was
-- missing.

-- Fuzzy party-name search for the picker and for resolving a document name
-- that is close but not equal to a repository name.
create extension if not exists pg_trgm;

-- ------------------------------------------------- organization_imports ----

-- One row per uploaded file. The file itself is not kept: this plus the state
-- of public.organizations is the record of what was loaded and what it did.
create table public.organization_imports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  file_name      text not null,
  sha256         text not null,
  row_count      integer not null default 0,
  inserted_count integer not null default 0,
  updated_count  integer not null default 0,
  -- Rows that were in the previous snapshot and are not in this file. They are
  -- deactivated, never deleted, so an old job still resolves its parties.
  retired_count  integer not null default 0,
  -- Country spellings with no ISO code, and anything else the parser noticed.
  warnings       text[] not null default '{}',
  imported_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index organization_imports_company_idx
  on public.organization_imports (company_id, created_at desc);

-- -------------------------------------------------------- organizations ----

create table public.organizations (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,

  -- Exactly as Logi-Sys spells it. This is the string the workbook carries, so
  -- it is stored verbatim and never normalised in place.
  name           text not null check (length(btrim(name)) > 0),
  -- Uppercased, punctuation-stripped, legal-suffix-free form of the name, for
  -- matching a document name against it. Computed in TypeScript by
  -- partyNameKey() and stored, so the rule has one implementation rather than
  -- a SQL copy that drifts from the TS one.
  name_key       text not null,
  alias          text,
  -- A name alone is not unique: SIEMENS LIMITED is 52 rows, one per branch.
  -- Name + branch name + branch serial is unique across all 5,094 rows of the
  -- sample export, and is the key Logi-Sys itself uses.
  branch_name    text not null default '',
  branch_sr_no   text not null default '',

  address1       text,
  address2       text,
  address3       text,
  city           text,
  state          text,
  postal_code    text,
  country        text,
  -- ISO alpha-2, resolved at import from the country name. The workbook wants
  -- the code ("JP"); the repository stores the name ("Japan").
  country_code   text,

  email          citext,
  telephone      text,
  web_url        text,

  ad_code        text,
  gstin          text,
  gst_state_code text,
  iec            text,
  pan            text,
  cin            text,
  bin            text,
  lut_number     text,
  st_reg_no      text,

  -- Which party slots this organization may fill. One row is often several:
  -- 4,327 of the sample are shippers and 4,011 consignees.
  is_shipper          boolean not null default false,
  is_consignee        boolean not null default false,
  is_agent            boolean not null default false,
  is_transporter      boolean not null default false,
  is_service_provider boolean not null default false,

  is_active         boolean not null default true,
  source_created_on text,
  source_created_by text,
  -- The whole spreadsheet row. 30 of the 73 columns are empty on every row
  -- today, but the vendor may start filling them, so nothing is discarded.
  raw               jsonb not null default '{}'::jsonb,

  last_import_id uuid references public.organization_imports (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (company_id, name, branch_name, branch_sr_no)
);

create index organizations_name_key_idx on public.organizations (company_id, name_key)
  where is_active;

create index organizations_name_trgm_idx on public.organizations
  using gin (name gin_trgm_ops);

create index organizations_company_idx on public.organizations (company_id)
  where is_active;

create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------- search ----

-- PostgREST cannot order by similarity(), and the picker needs "closest first"
-- over five thousand rows, so the ranking lives here.
create function public.search_organizations(
  p_company uuid,
  p_query   text,
  p_role    text default null,
  p_limit   int  default 20
) returns setof public.organizations
language sql
stable
set search_path = public
as $$
  select *
    from public.organizations
   where company_id = p_company
     and is_active
     and (
       p_role is null
       or (p_role = 'consignee'   and is_consignee)
       or (p_role = 'shipper'     and is_shipper)
       or (p_role = 'agent'       and is_agent)
       or (p_role = 'transporter' and is_transporter)
     )
     and (
       btrim(coalesce(p_query, '')) = ''
       or name % p_query
       or name ilike '%' || p_query || '%'
       or name_key like '%' || upper(btrim(p_query)) || '%'
     )
   order by similarity(name, coalesce(p_query, '')) desc, name, branch_name
   limit greatest(1, least(coalesce(p_limit, 20), 200));
$$;

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations',
    'organization_imports'
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

revoke all on function public.search_organizations(uuid, text, text, int) from public;
grant execute on function public.search_organizations(uuid, text, text, int) to service_role;
