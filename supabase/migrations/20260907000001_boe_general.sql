-- The GENERAL sheet's missing sources.
--
-- Thirteen of the twenty-three columns on the Bill of Entry header were
-- constants in code: the custom house was `awb ? 'INBOM4' : 'INNSA1'`, the duty
-- payment status was the literal 'T', the filing posture was a coin flip on
-- transport mode, and the nine yes/no flags were always blank. None of that was
-- a model failing to read a document — the facts those columns state are not on
-- any document, and the system held nowhere to put them.
--
-- This adds the three places they live: what the customer said (the mail body,
-- which was never even fetched), what we hold about the importer (AEO status,
-- their AD codes), and what the operator decided on the job.
--
-- See docs/boe-mapping/01-general.md for the per-column contract.

-- ------------------------------------------------------ mail bodies ----

-- The Graph delta query selected id, subject, from and dates — never a body.
-- So every rule that reads "check the mail" had no data to read: which custom
-- house to file at, whether the goods are warehoused, whether duty is deferred,
-- and the importer's own reference all arrive in prose and were being thrown
-- away at the point of ingest.
alter table public.mail_messages
  add column body_text    text,
  add column body_preview text;

comment on column public.mail_messages.body_text is
  'Plain-text body. The source for job filing instructions; see packages/extraction/src/instructions.ts.';

-- ------------------------------------------- importer master additions ----

create type public.aeo_status as enum ('none', 'T1', 'T2', 'T3');

alter table public.organizations
  -- Deferred duty payment is open only to AEO T2 and T3 importers, so
  -- DutyPaymentStatus_T_D cannot be answered without knowing the tier.
  add column aeo_status public.aeo_status not null default 'none',
  add column aeo_certificate_no text,
  -- An expired certificate does not qualify for deferred payment.
  add column aeo_valid_till date,
  -- Whether this importer wants its own reference carried on the BE at all.
  -- Importer_RefNo was being filled with our internal job number, which is not
  -- the importer's reference and had no business on a customs document.
  add column importer_ref_required boolean not null default false,
  -- ICES site code, used when the instruction mail names no custom house.
  add column default_custom_house text;

-- An importer may bank through more than one AD code, and the AD code is how
-- the bank realises the remittance against the Bill of Entry. The organization
-- row's own ad_code stays the default; these are the alternatives.
create table public.organization_ad_codes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Text, always. 0510226 as a number is 510226.
  ad_code          text not null,
  bank_name        text,
  bank_branch      text,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),

  unique (organization_id, ad_code)
);

create index organization_ad_codes_org_idx
  on public.organization_ad_codes (organization_id);

-- At most one default per importer, so "the default" is never a choice.
create unique index organization_ad_codes_one_default
  on public.organization_ad_codes (organization_id)
  where is_default;

-- ------------------------------------------------ job BE header ----------

create type public.be_type as enum ('home_consumption', 'warehousing', 'ex_bond');
create type public.filing_status as enum ('advance', 'prior', 'normal');
create type public.transport_mode as enum ('sea', 'air', 'land');

-- One row per job: everything on GENERAL that a person decides or keys.
--
-- This is the operator layer of the precedence chain
-- (document < master < mail < operator) and it always wins. A null column here
-- means "nobody has decided", which is different from a value — the resolver
-- falls through to the mail and the masters, and the export warns when nothing
-- answers.
create table public.job_boe_header (
  job_id                uuid primary key references public.jobs (id) on delete cascade,
  company_id            uuid not null references public.companies (id) on delete cascade,

  -- Overrides for the derived header values.
  transport_mode        public.transport_mode,
  customs_house_code    text,
  be_type               public.be_type,
  duty_payment_status   text check (duty_payment_status in ('T', 'D')),
  ad_code               text,
  importer_ref_no       text,

  -- Keyed from ICEGATE or the shipping line: on no document the customer sends.
  igm_no                text,
  igm_date              date,
  inward_date           date,
  -- Whether anyone has looked. Without it, a null igm_no cannot be told apart
  -- from an unchecked one, and those mean opposite things for Advance filing.
  igm_checked           boolean not null default false,
  be_filing_date        date,
  filing_status         public.filing_status,

  -- The nine yes/no columns. Null is "not looked at", false is "no" — the same
  -- blank cell on export, but different things on the job screen.
  is_first_check              boolean,
  is_green_channel            boolean,
  is_kachcha_be               boolean,
  is_hss                      boolean,
  is_bonds_certificates       boolean,
  is_transhipment             boolean,
  itc_lic_details             boolean,
  is_under_provisional_assessment boolean,

  -- Overrides for the two flags derived from the dates above. Sections 46 and
  -- 48 are computed on calendar days because we hold no customs holiday
  -- calendar, so a BE filed the working day after a holiday weekend can be
  -- flagged when the statute would not flag it. Clearing it takes a reason.
  is_under_sec46        boolean,
  is_under_sec48        boolean,
  sec46_override_reason text,

  updated_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- --------------------------------------------- job mail instructions ----

-- What the customer's thread was read to say, with the sentence each value came
-- from. The quotes are the point: an operator confirming a Bill of Entry that
-- says "warehousing" needs to see the line that made it say so.
create table public.job_mail_instructions (
  job_id                uuid primary key references public.jobs (id) on delete cascade,
  company_id            uuid not null references public.companies (id) on delete cascade,

  customs_house         text,
  customs_house_quote   text,
  -- The ICES code the free text above resolved to, or null when it did not.
  customs_house_code    text,
  be_type               public.be_type,
  be_type_quote         text,
  deferred_duty         boolean,
  deferred_duty_quote   text,
  importer_ref_no       text,
  importer_ref_quote    text,
  branch_name           text,
  branch_quote          text,
  other_instructions    text[] not null default '{}',

  -- How many messages were read, so a stale reading is visible when the thread
  -- has grown since.
  message_count         integer not null default 0,
  extracted_at          timestamptz not null default now()
);

-- ------------------------------------------------------- grants and RLS ----

do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_ad_codes',
    'job_boe_header',
    'job_mail_instructions'
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
