-- The four documents the INVOICES charge block is read off.
--
-- Freight and insurance are additions to the assessable value whenever the
-- terms of invoice do not already contain them, and the customer's rule for
-- both columns is "certificate se uthana" — take it off the certificate. Until
-- now neither certificate had a type: both classified as `unknown`, were
-- extracted as null, and the columns had no source at all. `ex_job7`'s bundled
-- scan has carried an insurance certificate past the pipeline since it was
-- added.
--
-- Purchase orders and contracts fill PO_No / PO_Date / Contract.No /
-- Contract_Date, which are "if given" columns: the invoice quotes the buyer's
-- order often enough to be worth reading, and never often enough to warn about.

alter type public.document_type add value if not exists 'freight_certificate';
alter type public.document_type add value if not exists 'insurance_certificate';
alter type public.document_type add value if not exists 'purchase_order';
alter type public.document_type add value if not exists 'contract';
