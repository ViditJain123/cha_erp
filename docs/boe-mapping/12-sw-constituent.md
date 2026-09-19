# SW_CONSTITUENT

What a line of goods is **made of** — each constituent, its share, and whether
it is the active one. The sheet is ICES `<TABLE>BE_ITEM_SW_CONST` (**BE Message
format 2.25, CACHI01 Part 20/24**, p.46 of the spec in
`data/customs-corpus/icegate-specs/`), printed as **section K** of the assessed
Bill of Entry.

**One row per (line of goods × constituent)**, keyed `Inv_SrNo` / `Item_SrNo` —
the underscore spelling this sheet shares with STATEMENT, RE-IMPORT, LICENSE and
SW_ADDL_INFO, not the `InvSrNo` of ITEMS. Both keys are Key fields in every
message type, so a constituent hangs off an *invoice line*, never off the Bill
of Entry as a whole.

**Not implemented, deliberately.** `SW_CONSTITUENT` is in `UNMAPPED_SHEETS`
(`packages/exporter/src/build.ts`) and this document is why. The short version:
the spec restricts the table to Bills of Entry referred to the Drug Controller,
and the corpus contains a Drug Controller filing that leaves it empty and was
accepted anyway.

Evidence, in order of authority:

- **Eight processed Bills of Entry** — what ICES actually took. Section K is
  empty on every one, `ex_job17` included, which is the one that matters (see
  below). Seven of the eight were free to carry a row; the eighth is an ex-bond
  BE, where the segment is not permitted.
- **Eight populated vendor exports** — Logi-Sys' own workbooks, the format
  authority for every other sheet. All eight carry `SW_CONSTITUENT` as
  `A1:G1`, header only, `liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx`
  among them.
- `BE Message format 2.25 (16Feb2026).pdf` — the field list, the types and the
  one sentence that scopes the whole table, with
  `BE_Messageformat_2.9(02Sep2021).pdf` beside it as the control.
- `Agency_wise_Filing_guidelines_29_March_2016.pdf` — the only document that
  says what a constituent *is*, agency by agency, and the one that settles which
  table the chemical identity belongs in.
- `reference/pga-cth-list-v1.7/SWIFT Quick Referencer Version 1.7 dated
  27.08.2026.pdf` — ICEGATE's current PGA field list, 260 pages, and the
  strongest negative: it never mentions this table.
- `data/customs-corpus/circulars/15_2023__1003162.pdf` (Annexure-1) and
  Circular 23/2023 — the chemical declaration, which says this sheet and which
  every filing contradicts.
- `BE_fresh_filing_error_codes_24032026.pdf` for what ICES rejects.

## Why this sheet needed dictating

Because the comment standing in for it was wrong, and wrong in the direction
that costs money. `build.ts` said `// chemical constituents, when a PGA asks`,
which reads as *"some PGA will ask one day, and then we will fill it"*. Both
halves are off: no PGA asks for it in the current referencer, and the one agency
the spec names does not ask for it on the jobs this tenant files.

The live cost of leaving it undictated was not the empty sheet — that is
correct — but the argument it left open. `11-sw-addl-info.md` carried twenty
lines of hedging about whether the CAS number and IUPAC name belong here
instead, and `open-questions.md` carried the question. The 2016 guidelines
answer it outright, in the Drug Controller's own field list, and nobody had
read them.

---

## The rows this sheet is measured against

There are none. That is the finding, so it is stated as evidence rather than as
an absence:

```
job       BE No     BE date     type  section K
ex_job12  3373718   26.08.2026   H     empty
ex_job13  3144105   14.08.2026   H     empty
ex_job14  3139318   14.08.2026   H     empty
ex_job15  3486235   01.09.2026   H     empty    ch 29, CPCBB, CAS 1623-05-8
ex_job16  2997720   07.08.2026   H     empty
ex_job17  3108519   13.08.2026   W     empty    ch 29, CPCPR, CAS 75-05-8, DRC = MSC
ex_job23  3610195   07.09.2026   X     empty    ch 29, CPCPR — see below
ex_job31  3705271   11.09.2026   H     empty
```

**Read the BE type column before counting these.** `ex_job23` is an `X`, an
ex-bond clearance, and the components matrix puts this segment at `X` for an
ex-bond BE — the table is *not permitted* there at all. Its empty section K is
the spec being obeyed, not a choice, and it is not evidence of anything else.
Seven of the eight could have carried a constituent row. None did.

**`ex_job17` is the one that settles it.** It is a `W`, a warehousing entry,
which is a fresh filing and carries the segment at `O` — permitted. Its section
J declares `CTG` / `DRC` = `MSC`, an item category from the Drug Controller's
own list: *Misc. Pharma Items not covered in the categories above*. That is a
Bill of Entry referred to the ADC, which is the exact and only condition the
spec gives for this table. Section K is empty. ICES assessed and cleared it.

Everything else agrees. Fifteen workbooks on disk carry the sheet and not one
has a data row; the eight that are Logi-Sys' own output are the ones that count.

**A warning about reading these PDFs.** `pdftotext -layout` interleaves sections
J, K and L, because the assessed BE prints them as stacked bands and the left
margin label runs sideways. A grep for the K heading followed by the next few
lines returns section J's CAS number and its standard quantity, which reads
exactly like a populated section K. The check has to be positional: section K's
rows are whatever sits between its own column-header line and the section L
heading, and on all eight that gap is 16pt with a row height of about 11 — room
for the one row that is not there.

---

## The columns

Logi-Sys exposes seven of the ICES table's fourteen. Fields 1–6 are message
control, which Logi-Sys supplies itself from GENERAL. Field 9 has no column at
all.

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `Inv_SrNo` | 7, key | N(5) | derived from the line |
| 2 | `Item_SrNo` | 8, key | N(4) | derived from the line |
| — | *(no column)* | 9. Constituent Sr. No. | N(3), **M** | derived — **row order is the serial** |
| 3 | `Cons_Name` | 10. Constituent Element Name | C(256), **M** | `document` < `master` < `operator` |
| 4 | `Cons_Code` | 11. Constituent Element code | C(17), **M** | `document` < `master` < `operator` |
| 5 | `Cons_Percentage` | 12. Constituent Percentage | N(6,3), **M** | `document` < `operator` |
| 6 | `Cons_Yield%` | 13. Constituent Yield Percentage | N(6,3), **M** | **none — see open questions** |
| 7 | `Cons_Active` | 14. Active Ingredient (Y/N) | C(1), **M** | `operator` |

The `M` is conditional on the table being sent at all. Send no rows and nothing
is mandatory; send one row and every field in it is. At message level the
segment's line in the components matrix is `O O O O X O`, against columns
*Final, Amend, Supp., Delete, Ex-bond BE, SEZ* — so it is optional everywhere
except an **ex-bond Bill of Entry, where it is not permitted at all**. That
follows: the composition was declared when the goods went into the warehouse,
and the ex-bond clearance does not restate it.

The fourteen fields are byte-identical in `BE_Messageformat_2.9(02Sep2021).pdf`,
also in the corpus — the segment has not changed in five years. The one
difference is that column: `X` under *Ex-bond BE* in 2021, and in 2026 an
added *SEZ* column at `O`.

## 1–2. `Inv_SrNo`, `Item_SrNo`

Derived from the line, as on every other per-item sheet. ICES rejects a null,
negative or zero invoice or item number, and rejects a row whose line does not
exist in `<TABLE>ITEMS`.

## The serial with no column

ICES field 9, `Constituent Sr. No.`, is `N(3)` and mandatory, and the vendor
sheet has nowhere to put it. Logi-Sys must be numbering the rows by their order
within the `(Inv_SrNo, Item_SrNo)` group on upload.

That is an inference, not an observation — no populated vendor export exists to
confirm it. It is recorded here because it is the first thing a mapper would get
wrong: **the row order within an item is load-bearing**, and a mapper that
emits constituents in, say, descending percentage is silently renumbering a
mandatory ICES field. Whatever order the source gives them in is the order they
must be written in.

## 3. `Cons_Name` — the constituent element name

`C(256)`, free text. Two documents define it and they do not agree on the same
scale:

- The 2016 guidelines call it the **constituent of a finished formulation or
  cosmetic** — an ingredient of a mixture.
- Circular 15/2023's Annexure-1 calls it the **IUPAC name of the chemical** —
  the identity of the substance itself.

They are reconcilable: for a single-substance import the formulation has one
constituent and its name is the substance's. The distinction matters anyway,
because it decides how many rows a line gets, and ICES has an error code for
getting that wrong (875, below).

**Source:** `document` — a certificate of analysis or safety data sheet, where
one is on the job — < `master`, a previous confirmed declaration for the same
`productDescriptionKey` and importer — < `operator`. There is no source today;
see *Before this sheet can be wired*.

## 4. `Cons_Code` — the constituent element code

`C(17)`. **There is no ICES code directory for this field.** The only definition
in any primary source is Circular 15/2023's, which makes it the **CAS registry
number**; the 2016 guidelines give the field no code list either. `C(17)` is
wider than any CAS number needs — the longest is twelve characters — and
nothing published says what the extra width is for.

A column with no code domain cannot be validated before filing, so it is
`document` < `master` < `operator` and never a proposal: a CAS number nobody
confirmed is a chemical identity asserted to Customs.

## 5. `Cons_Percentage` — the constituent percentage

`N(6,3)`, so three decimals and a maximum of `999.999`. Written at 3dp, which
is `weight()` precision in `cell.ts`, not `money()`.

**No sum-to-100 rule is published.** Neither the spec, nor the 2016 guidelines,
nor either circular says the percentages must total anything, and Annexure-1's
cap of *Constituent 1..4* points the other way: four rows cannot describe every
formulation, so a partial composition must be acceptable. Recorded as
unverified. A mapper must not normalise, scale or complete the percentages to
reach 100 — that would be inventing a declaration.

**Source:** `document` — a certificate of analysis that carries an assay table —
< `operator`.

## 6. `Cons_Yield%` — the constituent yield percentage

`N(6,3)`, mandatory once a row is sent, and **no document in the corpus or on
ICEGATE defines what it means**. It is absent from the 2016 guidelines, from
both circulars, and from the SWIFT referencer; the spec lists it and says
nothing further.

This column has no source and cannot get one until somebody who files these says
what goes in it. See [open-questions.md](open-questions.md#sw-const-yield).

Note the literal header spelling — `Cons_Yield%`, with the `%` — because
`sheet-writer.ts` resolves columns by exact header text and would reject
`Cons_Yield`.

## 7. `Cons_Active` — active ingredient

`C(1)`, `Y` or `N`. The 2016 guidelines list it as FSSAI's serial 33, *"Whether
Active ingredient"*.

**Source:** `operator`. No shipping document states which constituent of a
formulation is the active one; it is a statement about what the goods are, like
the `CPC` chemical category on SW_ADDL_INFO.

---

## When a row is required

| Trigger | Source | Strength |
|---|---|---|
| The BE is referred to the **Drug Controller**, and the ADC wants the composition of a finished formulation or cosmetic | BE Message format 2.25 p.46; 2016 guidelines, ADC field 4 | the only explicit scoping in the spec |
| **FSSAI** asks for the composition of an item — its serials 31–33 | 2016 guidelines, FSSAI instruction 15 | permissive: *"for some items, the Agency may require"* |
| **Animal Quarantine** asks for the composition of an item | 2016 guidelines, AQ *Additional Requirement* | permissive, same wording |
| **Plant Quarantine**, **Wildlife Crime Control Bureau** | 2016 guidelines | **never** — both have their own section and neither maps a field here, nor carries the *Additional Requirement* paragraph |
| Every PGA, today | SWIFT Quick Referencer v1.7, 27.08.2026 | **none**: 260 pages, zero occurrences of "constituent", "composition" or `SW_CONST` |

The spec's own sentence, under the field table:

> The details in the above tag or table need to be provided only in the case of
> those BEs where NOC is to be obtained from Drug Controller

So the honest rule is narrow: **a finished formulation or cosmetic going to the
ADC, where the ADC asks.** A drum of acetonitrile referred to the ADC as *Misc.
Pharma Items* is not a formulation and has no composition to declare, which is
why `ex_job17` filed none.

---

## The chemical declaration does not belong here

This is the question [11-sw-addl-info.md](11-sw-addl-info.md) left open, and the
2016 guidelines close it. The Drug Controller's own field list routes the two
kinds of fact to two different tables, and names them by part number:

```
3   CAS No. / IUPAC name where available          (Table 19)
4   Composition of Finished Formulation/cosmetics (Table 20)
```

Table 19 is `BE_ITEM_SW_INFO_TYPE` — SW_ADDL_INFO. Table 20 is
`BE_ITEM_SW_CONST` — this sheet. The instructions then spell the first one out
step by step: `IDT` / `CAS` for the registry number, `PNM` / `IUP` for the IUPAC
name, both in `<Table>BE_Item_SW_Info_Type`.

**That is exactly what the eight filings do.** The split is not a local
convention the CHA drifted into; it is the published mapping, and ICES has
honoured it for ten years.

Circular 15/2023's Annexure-1 then reused *this* table for chemical identity —
`Constituent 1..4`, element name = IUPAC, element code = CAS, for all CTHs of
chapters 28, 29, 32, 38 and 39 — and in practice ICES kept taking the 2016
split. Where a circular and ten years of accepted filings disagree, the filings
decide, as they do on [RE-IMPORT](09-re-import.md) and INVOICES.

**The one cost, recorded so an operator is told rather than discovering it:**
Circular 23/2023 para 4.3 says the constituents declared in a Bill of Entry
*"will be printed as **Masked fields**"*. Masking applies to section K. Filed in
section J, the CAS number and IUPAC name print in clear on the assessed BE —
`ex_job15`'s `1623-05-8` and `ex_job17`'s `75-05-8` are legible in the PDFs in
this repo. No importer on this book has objected, so the split stands; one
importer calling its formulation confidential reopens it, and the answer would
change for that importer alone. See
[open-questions.md](open-questions.md#sw-constituent-vs-info-type).

---

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `ITEMS` | every `(Inv_SrNo, Item_SrNo)` here must exist there | ICES rejects a constituent on a line that is not declared |
| `INBOND_EXBOND` | an ex-bond (`X`) Bill of Entry may carry **no** rows here at all | the components matrix, `X` under *Ex-bond BE*; `ex_job23` is the corpus example |
| `SW_ADDL_INFO` | holds the CAS number and IUPAC name, not this sheet | the 2016 split, above |
| `SW_ADDL_INFO` | a `CTG`/`DRC` row is what makes a BE an ADC case, and so what could make this sheet apply | 2016 guidelines, ADC field 9 |
| `SW_PRODUCTION` | mandatory alongside, on an ADC case — *"The Production Details shall also be fill up in case of Drug Controller"* | SWIFT referencer v1.7, Drug Controller page |
| `STATEMENT.PC002` | the undertaking that ingredient data was withheld by the supplier. It is about the same facts as this sheet and is filed on SW_ADDL_INFO's scope | Circular 23/2023 para 4.2 |

## What ICES rejects

| Code | Rejection | Bearing on this sheet |
|---|---|---|
| **874** | *Constituent details are required for Mandatory additional qfr for Cth but missing* | The one code that argues for filling it. It names the chapter-28/29/32/3808/39 scope, and every filing in the corpus that carries a `CPC` row on that scope was accepted with section K empty. Either it is dormant or section J satisfies it; the corpus cannot tell. See [open-questions.md](open-questions.md#sw-const-874). |
| **875** | *Not more than 1 constituent details can be declared for Mandatory additional qfr cth* | **Caps the chemical case at one row**, which contradicts Annexure-1's `Constituent 1..4` on its face. If this sheet is ever wired for chemicals, more than one row is a rejection. |
| **876** | *IUPAC name or CAS Number is mandatory* | Already guarded on SW_ADDL_INFO, where those two facts are filed. |

## What is deliberately not built

No mapper, no `DraftItem.constituents`, no operator screen. The sheet stays
header-only, which is what all eight vendor exports do and what ICES has
accepted on every filing in the corpus.

Wiring it now would build a sink with nothing upstream of it and two of seven
columns that nobody can define. The day it is worth building is the day the ADC
asks this tenant for the composition of a finished formulation — and then it
starts from a real request with real values in it, not from a guess at what
`Cons_Yield%` means.

## Before this sheet can be wired

Two gaps upstream, neither of them on this sheet, both of which have to close
first. They are named here so the next person does not start at the exporter:

1. **`DraftItem.chemical` has no producer.** Nothing in `packages/extraction/`
   ever sets `category`, `casNumber` or `iupacName` — the field is read by
   `single-window.ts` and written only by tests. So CAS and IUPAC reach neither
   this sheet nor SW_ADDL_INFO today; all that fires is the warning.
2. **The certificate of analysis is read for batches, not composition.**
   `CoaProductSchema` (`packages/extraction/src/schemas.ts`) keeps
   `productCode`, `description`, `batchNo`, `manufactureDate` and `expiryDate`,
   and discards the assay table. `ex_job15/14313 COA.pdf` carries a real
   constituent breakdown — PMVE 99.983%, PEVE / HFP / HFPO / CO2 not detected,
   other impurities 0.017% — which is the shape of `Cons_Name` and
   `Cons_Percentage`, thrown away today. There is no `safety_data_sheet` doc
   type at all.
