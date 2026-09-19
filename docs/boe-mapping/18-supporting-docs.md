# SUPPORTING_DOCS

**Every document already uploaded to eSanchit, referenced by the number ICEGATE
gave it back.** The sheet is ICES `<TABLE>SUPPORTINGDOCS` (**BE Message format
2.25, CACHI01 Part 24/24**, p.51–52 of the spec in
`data/customs-corpus/icegate-specs/`).

Your dictation on the sheet (`understanding_this_sheet.xlsx`, `SUPPORTING_DOCS!D8`):

> These are all the documents which are already submitted to Icegate and we are
> just referring those documents over here so that they can fetch it eventually.

That sentence is the whole contract. **Nothing on this sheet is a document — it
is a set of pointers to documents ICEGATE already holds.** A row whose `Doc_IRN`
we invented points at nothing.

**One row per (document × line it applies to)**, keyed `Inv_SrNo` /
`Item_SrNo`. The spec makes this table *"mandatory for all Bills of Entry"*.

**Wired**, at `packages/exporter/src/map/supporting-docs.ts` — and **this
document reverses the decision to leave it empty.**

---

## Why it was empty, and why that is no longer right

The mapper returns `[]` unconditionally, on this reasoning: `Doc_IRN` and
`Doc_Upload_DateTime` are issued by eSanchit at upload time and cannot be known
at export time, and `Item_SrNo` is mandatory on a sheet whose rows are
document-level. A three-document job produced **33 of the 43 rejections** on the
first real upload. That was a sound response to the evidence then available.

Seven Logi-Sys-authored exports answer all three questions:

- `Item_SrNo` is **`0`** for a shipment-level document. So is `Inv_SrNo`. There
  is no contradiction between "mandatory" and "document-level"; the sheet uses
  `0`/`0` to mean *the whole Bill of Entry*, exactly as
  [STATEMENT](07-statement.md) does.
- `Doc_IRN` and `Doc_Upload_DateTime` are knowable — they arrive from eSanchit
  before the workbook is built, because the documents are uploaded *first* and
  the BE is filed against them. The gap was never a timing problem; it was that
  nothing in this system captured the number.

So the sheet is fillable, and the refusal survives only for a document whose IRN
we genuinely do not hold.

## The exact eleven columns Logi-Sys makes mandatory

From the real `ErrorList.htm`, which is the authority for what the uploader
will take — not the ICES spec, which marks several of these optional:

```
Item_SrNo · Doc_IRN · Doc_Upload_DateTime · Reference_No. · Doc_Issued_At
Doc_Issued_Date · Doc_Issuing_Party_Name · Doc_Issuing_Party_Add1
Doc_Beneficiary_Party_Name · Doc_Beneficiary_Party_Add1
```

**`Reference_No.` is the trap.** ICES marks it optional, Logi-Sys' uploader
makes it mandatory, and **Logi-Sys' own exports leave it blank on most rows** —
`ex_job31` fills it on four rows out of fourteen. The vendor's own workbook
would not pass the vendor's own validator. Copying the vendor output row for row
is therefore not enough; the validator is the stricter of the two and is what we
must satisfy. See [open-questions.md](open-questions.md#supporting-docs-refno).

## The columns

Twenty-five columns against ICES' thirty-one fields. Fields 1–6 are message
control; `CHA License Number` and `IEC` (10–11) have no column, and neither does
`File Type`'s sibling ordering.

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `Inv_SrNo` | 8. Invoice Serial Number | N(5), **M** | derived — `0` for shipment-level |
| 2 | `Item_SrNo` | 9. Item Sr. no. | N(4), **M** | derived — `0` for invoice- or shipment-level |
| 3 | `Doc_ICEGATE_ID` | 12. ICEGATE user ID | C(15), **M** | `master` — the tenant's ICEGATE login |
| 4 | `Doc_IRN` | 13. Image reference no | C(16), **M** | `operator` / eSanchit — **never derivable** |
| 5 | `Doc_Upload_DateTime` | — | — | `operator` / eSanchit |
| 6 | `Doc_Type` | 14. Document Type Code | C(6), **M** | `master` — `ESANCHIT_DOC_CODES` |
| 7 | `File_Type` | 31. File Type | C(5), **M** | derived — the uploaded file's extension |
| 8 | `Icegate_File_Name` | — | — | derived — the file as uploaded |
| 9 | `Document_Name` | — | — | derived |
| 10 | `Reference_No.` | 21. Document reference number | C(17) | `document` < `operator` |
| 11 | `Doc_Issued_At` | 22. Place of Issue | C(35), **M** | `document` < `operator` |
| 12 | `Doc_Issued_Date` | 23. Document Issue Date | Date, **M** | `document` < `operator` |
| 13 | `Doc_Expiry_Date` | 24. Document Expiry Date | Date, O | `document` |
| 14 | `Doc_Issuing_Party_Name` | 16. | C(70), **M** | `document` < `master` |
| 15 | `Doc_Issuing_Party_Code` | 15. | C(35), O | — **not validated by ICES** |
| 16–19 | `Doc_Issuing_Party_Add1/2/City/Pin_Code` | 17–20. | C(70/70/35/10), O | `document` < `master` |
| 20 | `Doc_Beneficiary_Party_Name` | 26. | C(70), **M** | `master` — the importer |
| 21 | `Doc_Beneficiary_Party_Code` | 25. | C(35), O | — **not validated by ICES** |
| 22–25 | `Doc_Beneficiary_Party_Add1/2/City/Pin_Code` | 27–30. | C(70/70/35/10), O | `master` |

**A warning about the spec's own numbering.** The notes under the field table
are off by one against it from *Sr. No. 20* onward — the note headed "Sr. No. 20
Document reference number" describes field **21**, and "Sr. No. 22 Document
Issue Date" describes field **23**. Read the table, not the notes' numbers.

### 1–2. The two serials, and what `0` means

| Scope | `Inv_SrNo` | `Item_SrNo` | Example from `ex_job31` |
|---|---|---|---|
| the whole Bill of Entry | `0` | `0` | the bill of lading, the DGCA NOCs |
| one invoice | `n` | `0` | — |
| one line | `n` | `m` | the FTO certificate of approval at `2`/`1` |

Written with `code()`, not `int()`: `'0'` is a string on the sheet and every
vendor row writes it as one.

**The same document may be referenced on several lines.** `ex_job31` files IRN
`2026081400161913` against invoices 1, 2, 3 and 4. ICES error **832** is
*Duplicate IRN found for **same** Invoice Number* — across invoices it is
expected, within one it is a rejection.

### 4. `Doc_IRN` — the one column nothing can derive

`C(16)`. The spec:

> The CHA/Importer receives this unique number when he digitally signs a digital
> copy of a document in pdf format … and submits the supporting document to
> ICEGATE. This will be auto-generated when ICEGATE completes the upload process.

Sixteen digits, and the shape is legible: `2026081400154694` is
`YYYYMMDD` + an eight-digit sequence, so the date inside it agrees with
`Doc_Upload_DateTime` by construction. That agreement is worth asserting — an
IRN whose date does not match its timestamp was pasted against the wrong row.

**A row without an IRN is not filed.** It warns, naming the file, and the
operator uploads it to eSanchit and pastes the number back. That is the only
part of the original refusal that survives, and it is now per document rather
than for the whole sheet.

### 5. `Doc_Upload_DateTime`

`DD-MM-YYYY HH:MM:SS` in every vendor row — **not** the `DD-Mon-YYYY` of every
date column on every other sheet in the workbook. It is the one place in the
workbook where the day and month are ambiguous, and it must be written exactly
this way.

### 6. `Doc_Type`

`C(6)`, from ICEGATE's document-type directory. `ESANCHIT_DOC_CODES`
(`packages/core/src/masters/data.ts:1534`) already holds it. Codes seen in the
vendor exports:

`380000` commercial invoice · `705000` bill of lading · `271000` packing list ·
`001000` certificate of analysis · `004000` test report · `861000` / `861013`
certificate of origin (the second preferential) · `165000` bond ·
`911000` / `911FT0` / `911CI3` / `911DA3` licence or approval ·
`022CO1` NOC / permit.

Written with `code()` — `004000` loses its meaning as an integer.

### 10. `Reference_No.`

`C(17)`, and the width bites: `ex_job31` holds `'20236 FTO-Certifi'`, a document
name **truncated at exactly 17 characters**. The spec says what belongs here:

> If the supporting document is an invoice, indicating the same invoice number
> quoted in `<TABLE>INVOICE` of the Bill of Entry.

So for an invoice it is the invoice number, and for a licence or certificate it
is that document's own number — the one already on
[LICENSE](10-license.md) or [BONDS_CERTIFICATES](17-bonds-certificates.md).
ICES **820**, *Supporting Document reference no wrong or …*, is what a mismatch
costs.

### 11–12. `Doc_Issued_At`, `Doc_Issued_Date`

Place and date of issue, off the document. ICES requires no validation on the
date (spec note, Sr. No. 22).

**The vendor's values here are not a rule to copy.** `ex_job31` stamps
`Doc_Issued_At = 'United States'` on every row including the DGCA NOC, which was
issued in India, and sets `Doc_Issued_Date` to the **upload** date rather than
the document's. Logi-Sys is defaulting both from the supplier and the upload.
Our extraction already reads a real issue date and place off most of these
documents, and filing the real one is better, not worse — this sheet's own
purpose is to describe a document Customs will open and read.

### 14–25. The two parties

`Doc_Issuing_Party_*` is who issued the document; `Doc_Beneficiary_Party_*` is
who it was issued **to**, which for an import is the importer. The spec:

> If the document type is a registration, license, certificate or a permit,
> indicate the IE Code of the party which is shown as the beneficiary.

Both `_Code` columns are the IE Code, and both are explicitly *"not validated"*
by ICES. Every vendor row leaves them blank; so do we.

**Here too the vendor's content is wrong and the format is right.** `ex_job31`
names PIPER AIRCRAFT as the issuing party of the bill of lading and of the
packing list — Logi-Sys stamps the supplier on every row. The issuer of a bill
of lading is the carrier, of a certificate of origin the chamber of commerce, of
a DGCA NOC the DGCA. `applyPartyResolution` already knows the carrier and the
supplier; the issuer is the document's own, and `document < master < operator`
decides it.

`Doc_Issuing_Party_City` reads `'.'` in every vendor row — a placeholder for a
field Logi-Sys wants non-empty. We write the real city where we have it and
leave it blank where we do not; the column is optional to ICES and the
uploader does not list it among the eleven.

---

## When a row is required

| Trigger | Result |
|---|---|
| every Bill of Entry | the spec: *"This table is mandatory for all Bills of Entry"* |
| a CTH whose PGA requires a document | ICES **797**, *Mandatory Supporting Document is not …*, and **827**, *Mandatory e-Sanchit document missing* |
| a preferential origin claim | ICES **791**, *COO Supporting document not available for …* |
| a mandatory doc code that genuinely does not apply to the line | **no row — a `STATEMENT` row instead.** Spec p.50: `REM`, statement code = the doc code, text = why it does not apply. See [07-statement.md](07-statement.md) |
| a document with no IRN yet | **no row**, and a warning naming the file |

That fourth row is the rule worth carrying: the way to declare a mandatory
document you do not have is not an empty cell, it is a remark on another sheet.

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `INVOICES` | an invoice document's `Reference_No.` is that invoice's number | spec, field 21; ICES 820 |
| `ITEMS` | a row at `(n, m)` must name a line that exists | — |
| `STATEMENT` | a missing mandatory doc code is declared there as `REM` | spec p.50 |
| `LICENSE` | every licence on that sheet should have its `911*` document here | ICES 825 / 831 |
| `BONDS_CERTIFICATES` | a bond should have its `165000` document here | — |
| `ITEMS` preferential claim | needs the `861013` certificate of origin here | ICES 791 |
| `SW_PRODUCTION` | the certificate of analysis the batch dates come from is `001000` here | — |

## What ICES rejects

| Code | Rejection |
|---|---|
| **791** | *COO Supporting document not available for …* |
| **797** | *Mandatory Supporting Document is not …* |
| **820** | *Supporting Document reference no wrong or …* |
| **822** | *E-Sanchit/Supporting Documents Details not …* |
| **827** | *Mandatory e-Sanchit document missing* |
| **832** | *Duplicate IRN found for same Invoice Number* |
| **825 / 831** | *Project Imports / Restricted Imports Licence details not provided* |

## Failure modes

| Condition | Severity | Why |
|---|---|---|
| a document with no IRN | **warn**, naming the file | it cannot be filed, and the operator must upload it. This is the original refusal, narrowed to one row |
| **no** document on the job has an IRN | **warn** once, listing them all | the current behaviour, preserved — the `ex_job6` golden is this case and stays header-only |
| the tenant's ICEGATE user ID unknown | **blocker** | `Doc_ICEGATE_ID` is mandatory on every row and is one value for the whole sheet; the literal `KUBERR007` is the tenant's, never a constant in code |
| `Doc_Type` has no code for the document's type | **warn** | the row is dropped; a wrong six-digit code tells Customs the document is something it is not |
| a preferential claim with no `861013` row | **blocker** | ICES 791, and the claim is what the duty was computed on |
| the IRN's embedded date disagrees with `Doc_Upload_DateTime` | **warn** | pasted against the wrong row |
| `Reference_No.` unknown | **warn** | the uploader rejects the row; the operator can key it |

## Upstream

`draft.supportingDocs` is `{ fileName, docType }[]`
(`extraction/src/draft.ts:892`) — enough to warn and not enough to file. It
grows `irn`, `uploadedAt`, `referenceNo`, `issuedAt`, `issueDate`, `expiryDate`,
`issuingParty` and the scope `(invoiceSrNo, itemSrNo)`.

Of those, all but two come from work already done: the issuing party from
`applyPartyResolution`, the issue date and place from the document's own
extraction, the reference number from the invoice or licence it already
matches, the scope from which line the document was attached to.

**The IRN and the upload timestamp are the only genuinely new inputs**, and they
come from outside this system. Where they reach the operator — an ICEGATE
acknowledgement mail, a Logi-Sys screen, or the eSanchit portal — decides
whether the capture is a paste field on `document-requests.tsx` or a parse. That
is [open-questions.md](open-questions.md#esanchit-irn-source), and it is the one
answer this sheet is waiting on.
