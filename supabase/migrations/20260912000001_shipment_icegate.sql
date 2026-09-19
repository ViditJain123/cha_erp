-- SHIPMENT's operator-keyed columns.
--
-- Six columns of the SHIPMENT sheet state things no document the customer sends
-- contains. Four of them are ICEGATE's, two of them are a person's judgement,
-- and every one of them was shipping blank with no warning until now.
--
-- Dictated in docs/boe-mapping/03-shipment.md.

alter table public.job_boe_header
  -- The consignment's line number on the IGM. Same ICEGATE enquiry as igm_no.
  -- Text, not an integer, for the reason ad_code is text: leading zeros.
  add column line_no              text,

  -- The gateway port's manifest, for a consignment cleared inland.
  --
  -- When goods land at a sea port and move to an ICD under bond, two manifests
  -- exist. The ICD's goes in igm_no; the gateway sea port's goes here. On a
  -- direct-port filing all three stay null and the export says nothing about
  -- them — that is the correct empty, not a missing value.
  add column gateway_igm_no       text,
  add column gateway_igm_date     date,
  add column gateway_inward_date  date,

  -- What kind of package, when no document says.
  --
  -- An air waybill counts pieces and does not name them: job I-13841/26-27 was
  -- filed as 1 PLT and I-30239/26-27 as 20 PKG, and neither waybill printed
  -- either word. The code used to assume PLT for every air job, which is both a
  -- constant in code and wrong half the time.
  add column package_unit_code    text,

  -- The shipping marks, when the BE declares something other than "AS PER BL".
  --
  -- A re-import declares itself in this cell: job I-13592/26-27 reads "RE-IMPORT
  -- OF INDIAN ORIGIN GOODS & RE EXPORTED" and I-14075/26-27 reads "INV
  -- NO-GFLA/RETURN/INVOICE / REJECTED AND RETURNBLE CARGO". Neither is on any
  -- bill of lading; both are written by the person filing.
  add column marks_and_nos        text;

comment on column public.job_boe_header.line_no is
  'IGM line number, keyed from ICEGATE. SHIPMENT.LineNo.';
comment on column public.job_boe_header.gateway_igm_no is
  'Gateway sea port IGM, for an inland (ICD) filing only. SHIPMENT.Gateway_IGM_No.';
comment on column public.job_boe_header.package_unit_code is
  'Operator override for SHIPMENT.PkgUnitCode, for documents that state no package kind.';
comment on column public.job_boe_header.marks_and_nos is
  'Operator override for SHIPMENT.Marks_&_Nos — re-import and FOC declarations.';
