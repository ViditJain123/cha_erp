-- Office documents against compliance requests.
--
-- The bucket was created for what the mail path produces: PDFs and phone
-- photographs. Documents handed over by hand — a licence copy the shipper sent
-- on WhatsApp, a test report the lab mailed as a spreadsheet — arrive as Word
-- and Excel too, and storage refuses those *after* the bytes have been
-- transferred, so the ceiling has to move here rather than in the route.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  -- docx / xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  -- the pre-2007 forms, still routine in Indian trade correspondence
  'application/msword',
  'application/vnd.ms-excel'
]
where id = 'job-documents';
