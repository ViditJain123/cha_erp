-- Which repository row a name off the documents means.
--
-- `resolveParty` matches an extracted party name against the organization
-- repository on a normalised key. When exactly one row answers, that is the
-- answer. When several do, they are branches of one company and the choice is
-- not ours: SIEMENS LIMITED is 52 rows and RAJSHREE POLYPACK is 14, and picking
-- one would be a coin toss printed on a customs document.
--
-- So the operator picks — and until now picked again on the very next job,
-- because the choice lived only on that job's draft. 479 of the repository's
-- 3,790 distinct name keys have more than one branch, and the branch names are
-- frequently '0', '1' … '13', which no shipping document will ever state. The
-- discriminator a person actually uses is the city.
--
-- This is where that decision is kept. Asked once per party, per company.
--
-- Keyed on `name_key`, never on a similarity score. The key already collapses
-- the spellings that mean the same company — SIGMA CHEMTRADE PVT. LTD and
-- SIGMA CHEMTRADE PRIVATE LIMITED are one key — while SIGMA CHEMTRADE
-- INTERNATIONAL is a different key and gets asked. That exactness is the whole
-- guard against a remembered decision quietly capturing a new near-miss name,
-- so nothing may ever look this table up by trigram.
--
-- It is ours rather than Logi-Sys', like organizations.default_end_use_code, so
-- a repository re-upload leaves it alone: the import writes `organizations` and
-- never this. A row the vendor genuinely deletes cascades the binding away with
-- it, which is right — the decision was about a row that no longer exists.

create table public.party_bindings (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- The same four slots resolveParty knows. Text and checked rather than an
  -- enum: PartyRole lives in TypeScript and a fifth slot should not need a
  -- migration to try out.
  role       text not null check (role in ('consignee', 'shipper', 'agent', 'transporter')),
  -- partyNameKey() of the name as the documents printed it.
  name_key   text not null check (length(btrim(name_key)) > 0),
  -- The exact string that produced the key. Not used for matching — it is how
  -- a person reading the list recognises what they decided about.
  source_name     text not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz not null default now(),
  -- The job the decision was made on, for the same reason.
  source_job_id   uuid references public.jobs (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (company_id, role, name_key)
);

create index party_bindings_org_idx on public.party_bindings (organization_id);

create trigger party_bindings_touch_updated_at
  before update on public.party_bindings
  for each row execute function public.touch_updated_at();

comment on table public.party_bindings is
  'Operator decisions about which repository branch a document name means. Asked once per party per company; never matched fuzzily.';

alter table public.party_bindings enable row level security;
revoke all on public.party_bindings from anon, authenticated;
grant select, insert, update, delete on public.party_bindings to service_role;
grant select on public.party_bindings to authenticated;

create policy party_bindings_select on public.party_bindings
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_platform_admin());
