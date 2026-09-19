# SW_CONTROL

**Where the goods were inspected, when, and what the inspection found.** The
sheet is ICES `<TABLE>BE_ITEM_SW_CTRL` (**BE Message format 2.25, CACHI01
Part 22/24**, p.48 of the spec in `data/customs-corpus/icegate-specs/`).

The spec defines the word, and the definition is the whole scope:

> "Control" is the international term used for any inspection, checking,
> examination, testing, scanning, screening or verification by authorities. This
> table is used to record the date, place, and result of control of goods before
> the import shipment arrives.

**One row per (line of goods × control)**, keyed `Inv_SrNo` / `Item_SrNo`.

**Not implemented, deliberately.** `SW_CONTROL` is in `UNMAPPED_SHEETS`
(`packages/exporter/src/build.ts`) and this document is why: no filing in the
corpus carries a pre-arrival control, no vendor export has a row, and nothing
upstream produces one. See *Before this sheet can be wired*.

---

## One ICES segment, three Logi-Sys sheets

This is the fact to hold before reading the column table, because the sheet's
shape makes no sense without it. `BE_ITEM_SW_CTRL` has **seventeen** fields and
three unrelated uses, and Logi-Sys gives each use its own sheet:

| Use of the segment | Logi-Sys sheet | Contract |
|---|---|---|
| Section 65 warehouse clearing a manufactured product under a GST invoice | `SEC65_EXBOND_INFO` | [08-sec65-exbond-info.md](08-sec65-exbond-info.md) |
| SEZ T/M-type BE referencing the original Z-type BE | `SEZ_INFO` | [15-sez-info.md](15-sez-info.md) |
| **An ordinary PGA control — the plain meaning above** | **`SW_CONTROL`** | this document |

That is why this sheet has seven columns and the other two have eight and ten:
the quantity fields (15–17, `Control MSR` / `Control UQC` / `Control Slno`) are
marked `X` — *not permitted* — in every message type **except** the
`X-BE (Sec65)` column, and the SEZ recipe borrows them by declaration rather
than by right. A plain control has nothing to count.

**Nothing may appear on two of the three at once.** ICES error 492,
*Duplicate Control Information at BE Level*, is what filing the same control
twice costs.

## The columns

Logi-Sys exposes seven of the seventeen. Fields 1–6 are message control, which
Logi-Sys supplies itself from GENERAL; 14–17 have no column here at all.

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `Inv_SrNo` | 7, key | N(5) | derived from the line |
| 2 | `Item_SrNo` | 8, key | N(4) | derived from the line |
| 3 | `Control_Type` | 9. Control Type Code | C(17), **M** | `master` — **no directory published** |
| 4 | `Control_Location` | 10. Control Location | C(17), **M** | `document` < `operator` |
| 5 | `Control_Start_Date` | 11. Control Start Date | Date, O | `document` < `operator` |
| 6 | `Control_End_Date` | 12. Control End Date | Date, O | `document` < `operator` |
| 7 | `Control_Result` | 13. Control Result Code | C(17), **M** | `master` — **no directory published** |
| — | *(no column)* | 14. Control Result Text | C(4000), O | not exposed |
| — | *(no column)* | 15–17. MSR / UQC / Slno | — | `X` on a plain control |

The `M` is conditional on the table being sent at all — send no rows and nothing
is mandatory. At message level the segment is `O O O O X O` against *Final,
Amend, Supp., Delete, Ex-bond BE, SEZ*: optional everywhere, **not permitted on
an ex-bond BE** except in its Sec65 form, which is the separate `X-BE (Sec65)`
column and the separate sheet.

## The two columns with no code domain

`Control_Type` and `Control_Result` are both `C(17)` and both mandatory, and
**neither has a published directory**. ICES has a rejection for each — 467
*Invalid Control Code* and 468 *Invalid Control Result Code* — so the domains
exist inside ICES and are simply not in any document we hold. The 260-page
SWIFT Quick Referencer v1.7 does not list them either; it is organised by
`INFO_TYPE` / `INFO_QFR` for SW_ADDL_INFO and never reaches this table.

The two values we **do** know are borrowed from the other two uses of the
segment: `SEC65` and `SEZ`. Both belong on their own sheets. That leaves this
sheet with two mandatory columns and no legal value for either.

This is the single fact that stops the sheet being wired, and it is not an
upstream gap that more extraction would close — it is a directory only Customs
can hand over. See [open-questions.md](open-questions.md#sw-control-domains).

## 4. `Control_Location`

`C(17)`. Where the control happened, which for a pre-shipment control is abroad.
Seventeen characters is the width of an ICES location code, not of a city name,
so this is very likely coded rather than free text — but with no directory for
the type code either, that is an inference and is recorded as one.

## 5–6. `Control_Start_Date`, `Control_End_Date`

Both `O`. An inspection that happened on one day sets both to that day; a
fumigation with a dwell period sets a range. Neither may be after the Bill of
Entry date — the spec says the control is *before the shipment arrives*.

---

## What would trigger a row, if anything does

No primary source lists the controls ICES expects here. These are the candidates
the import trade actually files, each with the document that would be its
source — recorded as candidates, not as rules:

| Candidate control | The document | Who requires it |
|---|---|---|
| **Pre-Shipment Inspection Certificate (PSIC)** on metallic waste and scrap | PSIC from a DGFT-recognised agency | DGFT, and Customs at the gate — the likeliest real trigger for this tenant |
| **Fumigation / phytosanitary treatment** before shipment | fumigation certificate, phytosanitary certificate | Plant Quarantine |
| **Pre-shipment veterinary inspection** | health certificate, export health certificate | Animal Quarantine (AQCS) |
| **Radiation / container scanning** at the load port | scanning certificate | the load-port authority |
| **Third-party quality inspection** the importer commissioned | inspection report | nobody — a commercial control, and almost certainly *not* what ICES means by "by authorities" |

The last row matters as much as the others: the spec says *by authorities*, so a
commercial pre-shipment inspection an importer paid for privately is not a
control and does not belong here even though it looks exactly like one.

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `SEC65_EXBOND_INFO` | a control filed there may not be repeated here | ICES 492, duplicate control at BE level |
| `SEZ_INFO` | same | same |
| `ITEMS` | every `(Inv_SrNo, Item_SrNo)` here must exist there | ICES 734, *item details not present for this ctrl details* |
| `SW_ADDL_INFO` | a control belongs to a PGA, and the PGA is declared there | ICES 472 |
| `SUPPORTING_DOCS` | the certificate the control is read off is itself an eSanchit document | a control with no uploaded certificate is an assertion |
| `INBOND_EXBOND` | an ex-bond (`X`) BE may carry **no** rows here | components matrix; the Sec65 case is the other sheet |

## What ICES rejects

| Code | Rejection | Bearing on this sheet |
|---|---|---|
| **467** | *Invalid Control Code* | `Control_Type` outside the unpublished directory |
| **468** | *Invalid Control Result Code* | `Control_Result` outside the unpublished directory |
| **490** | *Mandatory Control Information Missing* | the control that should have been declared and was not |
| **491** | *Wrong Control Information* | — |
| **492** | *Duplicate Control Information at BE Level* | the same control on two of the three sheets |
| **470 / 471** | *Inv. No. / Item No. cannot be null or negative or zero* | the two keys |
| **734** | *Item details not present for this ctrl details* | a control on a line that ITEMS does not declare |

## What is deliberately not built

No mapper, no `DraftItem.controls`, no operator screen. The sheet stays
header-only, which is what all fifteen workbooks on disk do.

Wiring it would mean choosing values for two mandatory coded columns out of
nothing, which is the exact failure `docs/boe-mapping/README.md` exists to
prevent. A guessed `Control_Type` is not a blank cell — it is a statement to
Customs that an inspection of a named kind took place.

## Before this sheet can be wired

Three things, and the first is not ours to produce:

1. **The `Control_Type` and `Control_Result` code directories.** Ask Customs,
   or read them off one accepted filing that carries a control row. Either
   settles it; nothing else can. See
   [open-questions.md](open-questions.md#sw-control-domains).
2. **A real trigger from this tenant's book.** Does Kuberr file metal scrap
   under PSIC, or plant or animal products under quarantine control? The corpus
   says no — 21 checklists, 31 job folders, zero control rows — but the corpus
   is a sample. See [open-questions.md](open-questions.md#sw-control-trigger).
3. **A PGA-by-CTH lookup.** Same master [13-sw-production.md](13-sw-production.md)
   needs: the SWIFT referencer's 160-page CTH-PGA mapping, unparsed today.
