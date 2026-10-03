-- The duty masters, mirrored into the database with the dates each row is in
-- force.
--
-- The code stays the source of truth: packages/core builds every row from the
-- same generated files the duty engine reads, and apps/web/scripts/
-- masters-sync.mts loads them here. Nothing in the app reads these tables yet.
-- What they add is a queryable, dated copy — "which entries could apply to
-- this code on this date" in one SQL call, for a picker, a validator or an
-- auditor — without loading the app.
--
-- A sync loads a whole release before anyone can see it. Readers only ever
-- see the release marked current, so a half-finished load is invisible, and
-- switching releases is one row update.
--
-- These are global reference data, not tenant data: no company_id. Every
-- signed-in user can read the current release; only the service role writes.

create extension if not exists btree_gist with schema extensions;

-- ------------------------------------------------------- master_releases ----

create table public.master_releases (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'loading'
                check (status in ('loading', 'current', 'superseded')),
  -- What was built: the tariff edition, the generator, row counts by duty
  -- type, and how many rows took their notification's date (see db-rows.ts).
  source        jsonb not null default '{}'::jsonb,
  counts        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  activated_at  timestamptz
);

-- At most one current release.
create unique index master_releases_one_current
  on public.master_releases ((true)) where status = 'current';

-- ---------------------------------------------------------- tariff_lines ----

-- One row per 8-digit tariff item per reading. The printed tariff is a
-- snapshot (BDP's 60th edition: the law as amended on 2 February 2026), so
-- valid_from is the day that reading is known to be the law, and valid_to
-- stays open until a later edition supersedes it.
create table public.tariff_lines (
  release_id          uuid not null references public.master_releases (id) on delete cascade,
  cth                 text not null check (cth ~ '^[0-9]{8}$'),
  description         text not null,
  unit                text,
  -- First Schedule statutory BCD, before any notification.
  basic_bcd_rate      numeric,
  -- BCD after the exemption the printed row cites — the book's reading.
  effective_bcd_rate  numeric,
  pref_bcd_rate       numeric,
  igst_rate           numeric,
  -- Social Welfare Surcharge as a rate on BCD (10, or 0 where exempt).
  sws_rate            numeric,
  -- A rate the book states in words ("20% or Rs.X per piece, whichever is higher").
  rate_text           text,
  -- DGFT ITC(HS): Free, Restricted, Prohibited, STE. Anything but Free needs
  -- an authorisation to file.
  import_policy       text,
  export_policy       text,
  remarks             text,
  notification_refs   jsonb not null default '[]'::jsonb,
  source              text not null check (source in ('book', 'seed', 'learned', 'reviewer')),
  edition             text,
  -- verified / repaired / unverified: whether the row's rates reconcile
  -- against its printed TOTAL. Unverified rows are for proposing, not filing.
  confidence          text,
  page                integer,
  valid_from          date not null,
  valid_to            date,

  primary key (release_id, cth, valid_from),
  check (valid_to is null or valid_to >= valid_from),
  -- A code never has two readings in force on the same day.
  exclude using gist (
    release_id with =,
    cth with =,
    daterange(valid_from, valid_to, '[]') with &&
  )
);

-- -------------------------------------------------- notification_entries ----

-- One row per notification entry per version: an S.No. of 45/2025, a
-- schedule entry of 9/2025-IT(R), an anti-dumping row, a tariff value, a
-- preferential line of a trade agreement. A serial whose rate an amendment
-- substituted appears twice, the old rate ending the day before the new one
-- starts; an omitted serial is kept, ending the day before it went.
create table public.notification_entries (
  release_id        uuid not null references public.master_releases (id) on delete cascade,
  -- Stable within a release: duty|scheme|notification|table|serial|sub|from.
  entry_key         text not null,
  duty_type         text not null check (duty_type in (
                      'BCD', 'AIDC', 'SWS', 'IGST', 'COMP_CESS', 'HEALTH_CESS',
                      'ANTI_DUMPING', 'CVD', 'SAFEGUARD', 'TARIFF_VALUE')),
  -- ICES form: '045/2025', '009/2025'.
  notification      text not null,
  -- The trade agreement a preferential BCD row belongs to ('IN-AE-CEPA').
  scheme            text,
  table_no          text,
  serial            text,
  -- The roman-numeral sub-item of a stacked serial; '' for the serial itself.
  sub_entry         text not null default '',
  description       text not null,
  -- What goods the entry covers, as digit prefixes: '01', '0910', '01012100'.
  -- An entry covers a code when an include prefix opens it and no exclude
  -- prefix does; any_chapter entries cover every code.
  include_codes     text[] not null default '{}',
  exclude_codes     text[] not null default '{}',
  any_chapter       boolean not null default false,
  all_goods         boolean not null default false,
  -- Column (2) verbatim, so a reviewer can check the flattening.
  spec              text,
  origin_countries  text[] not null default '{}',
  export_countries  text[] not null default '{}',
  basis             text not null check (basis in (
                      'AD_VALOREM', 'SPECIFIC', 'LANDED_PERCENT', 'REFERENCE_PRICE',
                      'REDUCTION', 'TARIFF_VALUE', 'TEXT')),
  rate_percent      numeric,
  -- The cell verbatim: "Nil", "7.5%", "15% 35% 70% 70%", "Rs.400 per tonne".
  rate_text         text,
  amount            numeric,
  amount_currency   text,
  amount_unit       text,
  -- Condition numbers the entry cites (see notification_conditions), and
  -- condition prose where the source states it inline instead.
  condition_refs    text[] not null default '{}',
  conditions        text[] not null default '{}',
  valid_from        date not null,
  valid_to          date,
  -- An amendment we could not apply touches this entry from stale_from: its
  -- rate must not be filed for a date on or after that.
  stale_from        date,
  stale_by          text[] not null default '{}',
  amended_by        text[] not null default '{}',
  omitted_by        text,
  page              integer,
  extra             jsonb not null default '{}'::jsonb,

  primary key (release_id, entry_key),
  check (valid_to is null or valid_to >= valid_from)
);

create index notification_entries_lookup_idx
  on public.notification_entries (release_id, duty_type, notification, serial);
create index notification_entries_include_idx
  on public.notification_entries using gin (include_codes);

-- ------------------------------------------------ notification_conditions ----

create table public.notification_conditions (
  release_id    uuid not null references public.master_releases (id) on delete cascade,
  notification  text not null,
  table_no      text not null,
  condition_no  text not null,
  -- What it demands: igcr, certificate, end-use-declaration, ...
  kinds         text[] not null default '{}',
  text          text not null,
  -- Amendments that rewrite the condition and are not applied to the text.
  stale_by      text[] not null default '{}',

  primary key (release_id, notification, table_no, condition_no)
);

-- ---------------------------------------------------------- the lookup ----

-- Every entry that could apply to a code on a date: in force that day, an
-- include prefix opening the code (or any_chapter), and no exclude prefix.
-- Most specific first, then by duty. Residual "all other goods" entries come
-- back too, at rank 0 — a picker must offer them, not hide them.
create function public.notification_candidates(p_cth text, p_on date)
returns table (
  rank integer,
  entry_key text,
  duty_type text,
  notification text,
  scheme text,
  table_no text,
  serial text,
  sub_entry text,
  description text,
  basis text,
  rate_percent numeric,
  rate_text text,
  amount numeric,
  amount_currency text,
  amount_unit text,
  origin_countries text[],
  condition_refs text[],
  valid_from date,
  valid_to date,
  stale boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with code as (
    select regexp_replace(p_cth, '\D', '', 'g') as digits
  ),
  prefixes as (
    select array_agg(left(code.digits, n)) as list
    from code, generate_series(2, least(8, length(code.digits))) as n
  )
  select
    coalesce((select max(length(p)) from unnest(e.include_codes) p
              where (select digits from code) like p || '%'), 0) as rank,
    e.entry_key, e.duty_type, e.notification, e.scheme, e.table_no, e.serial,
    e.sub_entry, e.description, e.basis, e.rate_percent, e.rate_text, e.amount,
    e.amount_currency, e.amount_unit, e.origin_countries, e.condition_refs,
    e.valid_from, e.valid_to,
    (e.stale_from is not null and p_on >= e.stale_from) as stale
  from public.notification_entries e
  join public.master_releases r on r.id = e.release_id and r.status = 'current'
  where e.valid_from <= p_on
    and (e.valid_to is null or e.valid_to >= p_on)
    and (e.any_chapter or e.include_codes && (select list from prefixes))
    and not exists (
      select 1 from unnest(e.exclude_codes) x
      where x <> '' and (select digits from code) like x || '%'
    )
  order by rank desc, e.duty_type, e.notification, e.serial;
$$;

-- -------------------------------------------------------- release switch ----

-- Make a fully loaded release the current one, in one transaction. The rows of
-- the release it replaces are pruned afterwards by prune_master_release, in
-- batches, so no single statement deletes a hundred thousand rows.
create function public.activate_master_release(p_release uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from master_releases where id = p_release and status = 'loading') then
    raise exception 'release % is not a loading release', p_release;
  end if;
  update master_releases set status = 'superseded' where status = 'current';
  update master_releases set status = 'current', activated_at = now() where id = p_release;
end;
$$;

-- Delete up to p_limit rows of a superseded release; the release row itself
-- goes once it is empty. Returns how many rows were deleted, so the caller
-- loops until it reads 0.
create function public.prune_master_release(p_release uuid, p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  m integer;
begin
  if exists (select 1 from master_releases where id = p_release and status = 'current') then
    raise exception 'release % is current and cannot be pruned', p_release;
  end if;
  delete from notification_entries
    where (release_id, entry_key) in (
      select release_id, entry_key from notification_entries where release_id = p_release limit p_limit);
  get diagnostics m = row_count; n := n + m;
  if n < p_limit then
    delete from tariff_lines
      where (release_id, cth, valid_from) in (
        select release_id, cth, valid_from from tariff_lines where release_id = p_release limit p_limit - n);
    get diagnostics m = row_count; n := n + m;
  end if;
  if n = 0 then
    delete from master_releases where id = p_release;  -- cascades the conditions
  end if;
  return n;
end;
$$;

-- ------------------------------------------------------- grants and RLS ----

-- service_role grants must be explicit: a freshly created table gives it only
-- REFERENCES/TRIGGER/TRUNCATE on current Supabase versions.
alter table public.master_releases enable row level security;
revoke all on public.master_releases from anon, authenticated;
grant select, insert, update, delete on public.master_releases to service_role;
grant select on public.master_releases to authenticated;
create policy master_releases_select on public.master_releases
  for select to authenticated
  using (true);

do $$
declare
  t text;
begin
  foreach t in array array['tariff_lines', 'notification_entries', 'notification_conditions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    -- Only the current release: a release still loading is invisible.
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (exists (
          select 1 from public.master_releases r
          where r.id = release_id and r.status = 'current'
        ))
    $f$, t);
  end loop;
end;
$$;

revoke all on function public.activate_master_release(uuid) from public, anon, authenticated;
revoke all on function public.prune_master_release(uuid, integer) from public, anon, authenticated;
grant execute on function public.activate_master_release(uuid) to service_role;
grant execute on function public.prune_master_release(uuid, integer) to service_role;
grant execute on function public.notification_candidates(text, date) to authenticated, service_role;
