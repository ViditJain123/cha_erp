-- Two per-importer defaults that are ours, not Logi-Sys's.
--
-- The retired code-level importer master carried a marine open-policy rate and
-- a default end-use code alongside the identity fields. Neither is in the
-- Organization Repository export — they are the CHA's standing arrangement
-- with the importer, not something Logi-Sys holds — so they live here as
-- columns the import never writes, and survive a re-upload untouched.

alter table public.organizations
  -- Percent of C&F value, applied as the insurance figure when the invoice is
  -- FOB or C&F and states no actual premium.
  add column marine_open_policy_rate_percent numeric(8, 5)
    check (marine_open_policy_rate_percent >= 0),
  -- GNX100 trading, GNX200 manufacture / actual use.
  add column default_end_use_code text;
