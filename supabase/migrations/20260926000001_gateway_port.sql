-- SHIPMENT.Port_of_Reporting: the gateway port, keyed.
--
-- The column names the sea port the vessel reported at before the goods moved
-- inland by road or rail to the ICD the Bill of Entry is filed at. It exists
-- only on an inland filing — on a direct-port filing there is no intermediary
-- port and the cell is empty — and it used to mirror CustomsHouseCode on every
-- job, which wrote a port of reporting onto filings that have none.
--
-- The value is usually readable off the bill of lading's port of discharge,
-- and apps/web/lib/general.ts resolves it from there. This column is the
-- operator's override for the B/L that names the port in a way the station
-- master cannot resolve. Dictated in docs/boe-mapping/03-shipment.md §20.

alter table public.job_boe_header
  add column gateway_port text;

comment on column public.job_boe_header.gateway_port is
  'ICES code of the gateway sea port, for an inland (ICD) filing only. SHIPMENT.Port_of_Reporting.';
