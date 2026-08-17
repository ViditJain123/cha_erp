-- The verdict the scrutiny analysis reaches on each requirement.
--
-- A CCR is matched to a job by HS code *prefix*, so a heading-level requirement
-- reaches goods it may have nothing to say about. Until now the only record of
-- that judgement was prose in jobs.remarks; this keeps it against the
-- requirement it was made about, so the panel can show which of the applied
-- CCRs actually bite on this invoice.

alter table public.job_ccrs
  -- null = applied but not yet assessed. Distinct from false, which is the
  -- analysis having looked at the goods and said this one does not govern them.
  add column applies         boolean,
  add column assessment_note text,
  add column assessed_at     timestamptz;
