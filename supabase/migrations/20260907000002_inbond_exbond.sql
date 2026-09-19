-- The INBOND_EXBOND sheet's sources.
--
-- A warehousing (W) or ex-bond (EX) Bill of Entry cannot be filed without the
-- bonded warehouse it concerns, and an ex-bond filing cannot be made without
-- naming the into-bond BE it draws against. Neither appears on any shipping
-- document, and neither existed anywhere in this system: the GENERAL work made
-- W and EX expressible as BE types and then had to warn that the workbook
-- carried no bond details at all.
--
-- Three additions: a cache of bonded warehouses (public data, but the portal
-- that serves it must not sit in the path of a workbook download), operator
-- columns for the bond and the release quantity, and a link from an ex-bond job
-- back to the into-bond job it draws against.
--
-- See docs/boe-mapping/02-inbond-exbond.md for the per-column contract.

-- --------------------------------------------------- bonded warehouses ----

create type public.warehouse_type as enum ('public', 'private', 'special');
create type public.warehouse_source as enum ('icegate', 'operator', 'document');

-- One row per bonded warehouse this CHA files against.
--
-- The eight-character code decodes on its own — MAA1U001 is a public warehouse
-- (U, s.57) under Chennai Sea (MAA1 -> INMAA1), serial 001 — so the station and
-- the licence type are derivable offline and are stored here only as a cache of
-- that parse. The name and address are NOT encoded in the code: they come from
-- ICEGATE's public warehouse enquiry, or from the operator when it cannot be
-- reached, and once known they are kept rather than re-fetched.
create table public.bonded_warehouses (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,

  -- Always stored upper-case; the shape is validated in TypeScript against the
  -- custom-house master, which a CHECK constraint here could not do.
  code               text not null,
  name               text,
  address1           text,
  address2           text,
  city               text,
  pin                text,
  -- A warehouse licensed under the Customs Act is in India by definition.
  country            text not null default 'IN',

  -- Derived from the code's first four characters, cached for querying.
  station_code       text,
  warehouse_type     public.warehouse_type,

  licensee_name      text,
  license_no         text,
  license_valid_till date,

  source             public.warehouse_source not null default 'operator',
  fetched_at         timestamptz,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (company_id, code)
);

create index bonded_warehouses_company_idx
  on public.bonded_warehouses (company_id, code);

-- ------------------------------------------------ job BE header (bond) ----

alter table public.job_boe_header
  -- The warehouse this BE deposits into or releases from.
  add column warehouse_code text,
  -- The into-bond BE an ex-bond clearance is filed against.
  add column inbond_be_no text,
  add column inbond_be_date date,
  -- The warehousing bond executed with Customs.
  add column bond_no text,
  add column bond_date date,
  add column bond_expiry_date date,
  -- Tri-state, like the GENERAL flags: null is "not looked at", false is "no",
  -- and both write a blank cell.
  add column is_warehouse_sale boolean,
  add column is_sec65_manufacturing_wh boolean,
  -- How much of the warehoused consignment this BE releases. ICES wants the
  -- package count, the package code, the gross weight of those packages and its
  -- unit (BE Message format 2.25, header fields 35-38, all mandatory on an
  -- ex-bond BE). They have no column on INBOND_EXBOND — they reach the workbook
  -- through SHIPMENT and ITEMS.
  add column released_packages integer check (released_packages is null or released_packages > 0),
  add column released_package_code text,
  add column released_gross_weight_kg numeric(14, 3)
    check (released_gross_weight_kg is null or released_gross_weight_kg > 0),
  add column released_uom text;

-- ---------------------------------------- mail instructions (bond block) ----

alter table public.job_mail_instructions
  add column warehouse text,
  add column warehouse_quote text,
  -- The code the free text above resolved to, or null when it did not.
  add column warehouse_code text,
  add column inbond_be_no text,
  add column inbond_be_quote text,
  add column bond_no text,
  add column bond_quote text;

-- --------------------------------------------------- into-bond job link ----

-- An ex-bond BE draws against an earlier into-bond BE, and until now nothing in
-- this system could express that two jobs are the same consignment. The link is
-- what lets an ex-bond job inherit the into-bond BE number, the warehouse and
-- the per-item serials that ITEMS.Inbond_InvSrNo / Inbond_ItemSrNo need — those
-- are hard-zeroed today for want of anywhere to read them from.
alter table public.jobs
  add column into_bond_job_id uuid references public.jobs (id) on delete set null;

create index jobs_into_bond_idx
  on public.jobs (into_bond_job_id)
  where into_bond_job_id is not null;

-- A job cannot draw against itself.
alter table public.jobs
  add constraint jobs_into_bond_not_self check (into_bond_job_id is null or into_bond_job_id <> id);

-- ------------------------------------------------------ document type ----

-- An attached into-bond BE (or its checklist print) is a distinct document with
-- distinct contents: a BE number, a warehouse code, and per-item serials an
-- ex-bond clearance points back at.
alter type public.document_type add value if not exists 'into_bond_be';

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array['bonded_warehouses'] loop
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
