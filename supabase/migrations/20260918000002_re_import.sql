-- RE-IMPORT: the shipping bill goods went out under, and the entry claimed.
--
-- Goods that left India and have come back are exempt from most of the duty
-- they would otherwise pay, under one of a family of notifications that turn on
-- *how* they left: 45/2017 for an export whose incentive was integrated-tax
-- based, 46/2017 for the Central Excise side, 94/96 for an export whose section
-- 51 clearance predates 1 July 2017, and 158/95 for Indian goods coming back to
-- be repaired here and re-exported. ICES carries the claim as <TABLE>REIMPORT
-- (BE Message format 2.25, CACHI01 Part 13/24); Logi-Sys carries it on the
-- RE-IMPORT sheet, fifteen columns wide.
--
-- Two additions:
--
--   1. The shipping bill is a document type. It is the only document that
--      states the bill number, date, port of export and the export-side invoice
--      and item serials ICES matches the returning line against, and until now
--      it classified as `unknown` and was discarded — while sitting in the job
--      folder. ex_job3 and ex_job29 both carry one.
--
--   2. The claim itself is per line of goods, keyed exactly as job_items
--      already is. ex_job4 files two lines of one invoice under two different
--      shipping bills and two different entries of 45/2017, so this cannot be a
--      job-level fact.
--
-- The notification entry is never chosen by the pipeline. A shipping bill's
-- scheme flags routinely fit several entries, one row carries one entry, and
-- the entry decides which of the six money columns ICES demands and which it
-- rejects — so it is confirmed by a person, and `re_import_confirmed` is what
-- records that. See docs/boe-mapping/09-re-import.md for the per-column
-- contract and docs/boe-mapping/open-questions.md for what is still open.

-- ------------------------------------------------------- the document ----

alter type public.document_type add value if not exists 'shipping_bill';

-- ------------------------------------------------------- the claim ----

-- jsonb rather than fifteen columns: the block is written and read whole, by
-- one screen and one mapper, and its shape is the ItemReImport type in
-- packages/extraction/src/draft.ts. Splitting it into columns would put the
-- Resolved<T> provenance of every field — which source decided it — somewhere
-- it could drift from the value.
alter table public.job_items
  add column if not exists re_import jsonb,
  -- Mirrors classification_confirmed: the entry was looked at and chosen, which
  -- is what clears the exporter's blocker. False with a populated re_import is
  -- the ordinary state of a freshly ingested re-import — the shipping bill has
  -- been read and nobody has picked the notification yet.
  add column if not exists re_import_confirmed boolean not null default false;

comment on column public.job_items.re_import is
  'RE-IMPORT sheet block for this line: the shipping bill it went out under, the notification entry claimed, and the export-leg amounts. Shape is ItemReImport.';
comment on column public.job_items.re_import_confirmed is
  'A person has chosen the re-import notification entry. The export refuses while this is false and re_import is set.';

-- Finding the re-imported lines of a job is what the job screen and the
-- exporter both start from, and most jobs have none.
create index if not exists job_items_re_import_idx
  on public.job_items (company_id, job_id)
  where re_import is not null;
