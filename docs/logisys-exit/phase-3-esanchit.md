# Phase 3 — eSANCHIT

**The single largest gap.** SUPPORTING_DOCS scores **0.0%**, 549 blank cells,
and accounts for roughly 18 of the 20 worst columns in the entire scorecard.

No amount of better extraction touches it. The data does not exist in our
system because the documents have never been uploaded to ICEGATE by us.

---

## How it works

eSANCHIT is the government's document repository. You upload a signed PDF, and
ICEGATE returns an **IRN** — an Image Reference Number. The Bill of Entry does
not carry the document; it carries the IRN, a pointer to the copy ICEGATE
already holds.

So `SUPPORTING_DOCS` is a table of pointers. Without the upload there is no
pointer, and a row we invent points at nothing.

## Where we are

`job_document_esanchit` exists. `esanchit-reference.tsx` lets an operator paste
an IRN and its upload timestamp per document. `supporting-docs.ts` files a row
for every document that has one and warns by name for the rest.

In practice nobody pastes them, so every job files zero rows.

## The format, already settled

Seven Logi-Sys exports answer what was once thought unknowable. These were
reversed out on 2026-09-18 and are not open questions:

- **`Inv_SrNo` / `Item_SrNo` are `0` / `0`** for a shipment-level document, as
  STATEMENT uses them; `n` / `0` for an invoice-level one.
- **`Doc_IRN` is `YYYYMMDD` + an eight-digit serial** (`2026082400084879`). The
  date inside it must agree with `Doc_Upload_DateTime`.
- **`Doc_Upload_DateTime` is `DD-MM-YYYY HH:MM:SS`** — the only column in the
  whole workbook that is not `DD-MMM-YYYY`, and the only place day and month are
  ambiguous. Get this wrong and it fails silently for eleven days a month.
- Both `_Party_Code` columns are blank everywhere; ICES says "not validated".
- The same IRN on several invoices is expected. The same IRN **twice on one
  invoice** is ICES error 832.
- Document type codes are in `ESANCHIT_DOC_CODES`, plus a set observed in vendor
  exports but not yet typed (`ESANCHIT_DOC_CODES_OBSERVED`).

## The work

1. **Decide the route.** Either integrate the eSANCHIT upload API, or — if that
   is gated behind the same registration as filing — build the operator flow
   properly: upload in the portal, then capture the IRN against the document in
   one screen rather than one paste at a time. Settle this before building; it
   is the only real fork in this phase.
2. **Capture at document level, file at row level.** The mapping already works
   this way. What is missing is that nothing makes the capture *happen*.
   A job cannot reach filing with documents that have no IRN — that should be a
   visible, countable state on the job, not a warning in an export nobody reads.
3. **Fill the eleven columns Logi-Sys' uploader demands** beyond the IRN:
   `Reference_No.`, `Doc_Issued_At`, `Doc_Issued_Date`, the two issuing-party
   columns and the two beneficiary-party ones.
4. **Type the observed codes.** Move `ESANCHIT_DOC_CODES_OBSERVED` entries into
   real document types as they are confirmed. A document we cannot type is
   deliberately **not referenced at all** — a wrong six-digit code tells Customs
   the document is something it is not.

## Two traps worth stating before you start

**Logi-Sys' own exports would fail Logi-Sys' own validator.** `Reference_No.` is
mandatory to the uploader, optional to ICES, and blank on most rows of the
vendor's exports — `ex_job31` fills it on 4 of 14. So copying vendor output
row-for-row is not sufficient.

**Format authority is not content authority.** `ex_job31` names the supplier
(Piper Aircraft) as the issuer of the bill of lading *and* of the DGCA NOC,
stamps `Doc_Issued_At` as "United States" on an Indian NOC, and sets
`Doc_Issued_Date` to the upload date. The vendor's file settles what the columns
*are*. It does not settle what belongs in them.

## Done when

- Every document that should carry an IRN carries one, without anyone pasting.
- SUPPORTING_DOCS is materially off 0% on every corpus job that has documents.
- A job with an un-uploaded document says so plainly, before filing.
- The 33 SUPPORTING_DOCS rejections from the original `ErrorList.htm` upload
  would no longer fire.
