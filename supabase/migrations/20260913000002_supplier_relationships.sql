-- The related-party block on INVOICES, and the ceiling on the marine policy.
--
-- Both are things the CHA knows about a customer that no shipping document
-- states, and both were being written to the Bill of Entry as constants:
-- `Is_Related` was hardcoded `N` and the whole SVB block was left empty on
-- every job, including `ex_job1`, which Logi-Sys' own checklist prints as
-- "Related Yes / Under SVB Yes".

-- ---------------------------------------------------------------------------
-- 1. The importer-supplier pair
-- ---------------------------------------------------------------------------
-- A Special Valuation Branch order covers one importer buying from one
-- supplier, not a supplier. The same overseas seller can be a related party to
-- one of a CHA's importers and at arm's length from another, so the key is the
-- pair. Putting these columns on the supplier's own row would declare a
-- relationship on every job that supplier appears on.

create table public.supplier_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  importer_org_id uuid not null references public.organizations (id) on delete cascade,
  supplier_org_id uuid not null references public.organizations (id) on delete cascade,

  -- INVOICES.Is_Related / .Relation. `Relation` is the literal word YES beside
  -- a related pair and blank otherwise, so it is derived, not stored.
  is_related boolean not null default false,
  -- INVOICES.Base — how they are related: shareholding, common control, sole
  -- agency. Free text, because the declaration is prose.
  base text,
  -- INVOICES.Condition — a condition the relationship puts on the price.
  "condition" text,

  -- The SVB order itself.
  svb_ref_no text,
  svb_date date,
  -- INVOICES.Custom_House_Code: the custom house that imposed the load. NOT the
  -- station the BE is filed at, which is GENERAL.CustomsHouseCode.
  svb_custom_house text,
  -- INVOICES.SVB_Loading_Basis — 'A' when the load applies to the assessable
  -- value, blank when it does not.
  svb_loading_basis text check (svb_loading_basis in ('A')),
  svb_rate_assessable numeric(10, 5) check (svb_rate_assessable >= 0),
  svb_status_assessable text check (svb_status_assessable in ('F', 'P')),
  svb_rate_duty numeric(10, 5) check (svb_rate_duty >= 0),
  svb_status_duty text check (svb_status_duty in ('F', 'P')),

  -- INVOICES.RD_% — a revenue deposit, on the assessable value. Rare, arrives
  -- by customer instruction rather than off a document, and only ever on a
  -- related-party import (typically 1% or 5%).
  revenue_deposit_percent numeric(8, 5) check (revenue_deposit_percent >= 0),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (importer_org_id, supplier_org_id),
  -- Base, condition and the deposit qualify a relationship. Recording them
  -- against an unrelated pair is a contradiction, not a detail.
  constraint related_party_details_need_a_relationship check (
    is_related
    or (base is null and "condition" is null and revenue_deposit_percent is null)
  )
);

create index supplier_relationships_importer_idx
  on public.supplier_relationships (importer_org_id);
create index supplier_relationships_company_idx
  on public.supplier_relationships (company_id);

-- Same posture as `organizations`: readable by the company that owns it,
-- written only through the service role.
alter table public.supplier_relationships enable row level security;
revoke all on public.supplier_relationships from anon, authenticated;
grant select, insert, update, delete on public.supplier_relationships to service_role;
grant select on public.supplier_relationships to authenticated;

create policy supplier_relationships_select on public.supplier_relationships
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. The policy behind the rate
-- ---------------------------------------------------------------------------
-- `marine_open_policy_rate_percent` already says what the premium costs. It
-- does not say what the policy covers, and the customer's rule for the
-- insurance column is that a consignment must not exceed the sum insured —
-- which cannot be checked against a rate.

alter table public.organizations
  add column marine_policy_no text,
  -- The whole policy, and the most one sending may be worth under it. Both in
  -- rupees: the policy is Indian and so is its limit.
  add column marine_policy_sum_insured_inr numeric(16, 2)
    check (marine_policy_sum_insured_inr > 0),
  add column marine_policy_per_sending_limit_inr numeric(16, 2)
    check (marine_policy_per_sending_limit_inr > 0),
  add column marine_policy_valid_till date;

comment on column public.organizations.marine_policy_per_sending_limit_inr is
  'Maximum insured value of a single consignment. A Bill of Entry declaring more than this is over-shipped against the policy, and the customer has to be told before it is filed.';
