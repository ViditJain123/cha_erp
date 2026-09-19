-- The SEC65_EXBOND_INFO sheet's sources, and the clearance kind that gates it.
--
-- Section 65 of the Customs Act lets the owner of warehoused goods manufacture
-- in the warehouse (MOOWR 2019). When the resultant product is sold into the
-- domestic tariff area it moves under a GST invoice, and the import duty on the
-- inputs contained in it falls due — so an ex-bond Bill of Entry is filed whose
-- items are the imported inputs while the declaration is about the finished
-- product. ICES carries that declaration as BE_ITEM_SW_CTRL rows with Control
-- Type Code SEC65 (BE Message format 2.25, CACHI01 Part 22/24); Logi-Sys
-- carries it on the SEC65_EXBOND_INFO sheet, eight columns wide.
--
-- Three additions:
--
--   1. Section 65 is a fact about the *warehouse* — it holds the permission —
--      so it belongs on bonded_warehouses, not on every job that touches it.
--
--   2. What a given ex-bond BE clears is a fact about the *job*, and it is not
--      always a resultant product. Circular 48/2020 para 8.1: "In case the
--      licensee is unable to carry out any manufacturing or other operations on
--      warehoused goods, then the goods may be cleared as such ... after the
--      payment of applicable import duties along with the interest accrued."
--      Capital goods leave the same way. Only a resultant-product clearance
--      carries SEC65 rows; filing them on any other is ICES error 868.
--
--   3. The finished goods themselves. An item can feed several GST invoices
--      (ICES Control Slno: "An Item can have Multiple GST Invoice") and one GST
--      invoice can consume several items, so this is a child table of the job
--      rather than columns on job_boe_header.
--
-- See docs/boe-mapping/08-sec65-exbond-info.md for the per-column contract.

-- ------------------------------------------------ the warehouse's licence ----

-- Tri-state like the job flags: null is "not looked at", false is "an ordinary
-- bonded warehouse". Filing SEC65 rows against a warehouse ICES does not hold
-- as a Section 65 unit is rejected (error 868), and the mapping ICES checks is
-- IEC-to-warehouse, maintained by an ACB-role officer — we cannot see it, so
-- this is what the operator read off the MOOWR permission.
alter table public.bonded_warehouses
  add column is_sec65 boolean,
  add column sec65_permission_no text,
  add column sec65_permission_date date;

-- --------------------------------------------------- what this BE clears ----

create type public.exbond_clearance_kind as enum (
  -- Manufactured in the warehouse and sold under a GST invoice. SEC65 rows.
  'resultant_product',
  -- No manufacture happened; the warehoused goods leave as they came, with
  -- section 61 interest. No SEC65 rows.
  'as_such',
  -- A capital asset removed from the premises. The duty event is the removal,
  -- not a sale of output. No SEC65 rows.
  'capital_goods',
  -- Imported inputs consumed during job work, duty paid when the job-worked
  -- goods go back to the principal. The return moves on a delivery challan, not
  -- a GST invoice, so whether ICES wants SEC65 rows here is an open question
  -- (docs/boe-mapping/open-questions.md).
  'job_work_return'
);

alter table public.job_boe_header
  add column exbond_clearance_kind public.exbond_clearance_kind;

-- ------------------------------------------------------- finished goods ----

-- One row per (GST invoice x finished product) this Bill of Entry clears.
create table public.job_sec65_finished_goods (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  job_id            uuid not null references public.jobs (id) on delete cascade,

  -- Declaration order. Logi-Sys has no Control Slno column, so it numbers the
  -- rows it receives positionally — which makes this ordering the thing that
  -- keeps two GST invoices against one item distinct (ICES error 733).
  seq               integer not null,

  -- ICES caps Control Result Code at 16 characters, which is also the ceiling
  -- CGST Rule 46 puts on an invoice serial. Longer is ICES error 728.
  gst_invoice_no    text not null
    check (length(btrim(gst_invoice_no)) between 1 and 16),
  gst_invoice_date  date not null,

  -- The finished product's own tariff heading and description, NOT the input's.
  -- Logi-Sys joins the two into Control Result Text with a delimiter.
  finished_cth      text not null check (finished_cth ~ '^[0-9]{8}$'),
  finished_desc     text not null check (length(btrim(finished_desc)) > 0),

  -- Control MSR is N(16,6) and must be positive (ICES error 731). This is the
  -- quantity of finished product cleared, in the finished product's own unit —
  -- unrelated to the input quantity on ITEMS.
  finished_qty      numeric(16, 6) not null check (finished_qty > 0),
  finished_uqc      text not null,

  -- Which item serials this entry is declared against. null means every item on
  -- the BE, which is the ordinary case: all the imported inputs went into the
  -- one resultant product.
  applies_to_items  integer[],

  -- 'document' once a GST tax invoice PDF proposes these; 'operator' when keyed.
  source            text not null default 'operator'
    check (source in ('document', 'mail', 'operator')),

  updated_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (job_id, seq)
);

create index job_sec65_finished_goods_job_idx
  on public.job_sec65_finished_goods (company_id, job_id, seq);

create trigger job_sec65_finished_goods_touch_updated_at
  before update on public.job_sec65_finished_goods
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array[
    'job_sec65_finished_goods'
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

-- ------------------------------------------------------- document type ----

-- The MOOWR unit's own outward GST tax invoice for the finished product. It is
-- not a shipping document and nothing else in the pipeline reads one: it is
-- attached so that the GST invoice number, date, HSN, description, quantity and
-- unit can propose the finished-goods entries above instead of being typed.
alter type public.document_type add value if not exists 'gst_tax_invoice';
