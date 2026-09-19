# SW_PRODUCTION

**When the goods were made and when they stop being fit to use.** Batch number,
batch quantity, date of manufacture, date of expiry, best-before date — one row
per batch of a line of goods. The sheet is ICES `<TABLE>BE_ITEM_SW_PROD`
(**BE Message format 2.25, CACHI01 Part 21/24**, p.47 of the spec in
`data/customs-corpus/icegate-specs/`).

**One row per (line of goods × batch)**, keyed `Inv_SrNo` / `Item_SrNo` — the
underscore spelling shared with STATEMENT, RE-IMPORT, LICENSE, SW_ADDL_INFO and
SW_CONSTITUENT, not the `InvSrNo` of ITEMS. Both keys are Key fields in the
Final message, so a batch hangs off an *invoice line*, never off the Bill of
Entry as a whole.

**Wired**, at `packages/exporter/src/map/sw-production.ts`, with three defects
this document records and closes.

Evidence, in order of authority:

- `BE Message format 2.25 (16Feb2026).pdf` — the field list, the types, and the
  two sentences that scope the table to FSSAI and the Drug Controller.
- `reference/pga-cth-list-v1.7/SWIFT Quick Referencer Version 1.7 dated
  27.08.2026.pdf` §4 — *"The Production Details shall also be fill up in case of
  Drug Controller"*, which is the only place the CDSCO obligation is written
  down.
- `ErrorList.htm` — the **real Logi-Sys rejection list** for job FUCHS-13841.
  Six of its 43 errors are this sheet, and they are why a row is all-or-nothing.
- `BE_fresh_filing_error_codes_24032026.pdf` for what ICES rejects.
- **Fifteen workbooks on disk carry the sheet and not one has a data row**,
  the eight Logi-Sys-authored `JobData_*.xlsx` included. So the vendor settles
  nothing here: every format question below is answered from the spec, and the
  places where that leaves a real choice are marked.

---

## The columns

Logi-Sys exposes eight of the ICES table's fourteen. Fields 1–6 are message
control, which Logi-Sys supplies itself from GENERAL.

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `Inv_SrNo` | 7, key | N(5) | derived from the line |
| 2 | `Item_SrNo` | 8, key | N(4) | derived from the line |
| 3 | `Prod_Batch_ID` | 9. Production Batch Identifier | C(17), O\* | `document` < `operator` |
| 4 | `Prod_Batch_Quantity` | 10. Production Batch Quantity | N(16,6), O\* | `document` < `operator` |
| 5 | `Prod_Batch_Unit` | 11. Unit Quantity Code | C(3), O\* | derived — the line's UQC |
| 6 | `Prod_Manufacturer_Date` | 12. Date of Manufacturing | Date, **M** | `document` < `operator` |
| 7 | `Prod_Expiry_Date` | 13. Date of Expiry | Date, **M** | `document` < `operator` |
| 8 | `Prod_Best_before_Date` | 14. Best Before | Date, O | `document` < `operator` |

\* **`O` means optional for FSSAI and mandatory for CDRUG.** The spec footnotes
fields 9, 10 and 11 with exactly that: *"optional only for FSSAI but Mandatory
for CDRUG"*. There is no third state — a batch on a drug consignment that
cannot state its number and quantity cannot be declared.

At message level the segment's line in the components matrix is `O O O O X O`
against *Final, Amend, Supp., Delete, Ex-bond BE, SEZ* — optional everywhere
except an **ex-bond Bill of Entry, where it is not permitted at all**. The
shelf life was declared when the goods went into the warehouse.

## Logi-Sys is stricter than ICES, and that is the rule we obey

ICES makes `Best Before` optional. Logi-Sys does not. The real rejection reads:

```
SW_PRODUCTION : Prod_Manufacturer_Date : Invoice No. #1 Product No. #1
This field is mandatory
```

and the same line repeats for `Prod_Expiry_Date` and `Prod_Best_before_Date`.
So a row is **all-or-nothing**: three dates or no row. A certificate of analysis
that gives a batch number and nothing else — which is the common case, and is
how a lubricant consignment produced six rejections — is dropped with a warning
naming the batch, not emitted half-filled. `logisys-validator.test.ts` guards
this against the real `ErrorList`.

## 3. `Prod_Batch_ID`

`C(17)`. The batch or lot number as the manufacturer marks it, off the
certificate of analysis or the invoice line. Written as `text()`, not `code()` —
17 characters is wider than any numeric batch and leading zeros have no meaning
here.

## 4–5. `Prod_Batch_Quantity` and `Prod_Batch_Unit`

`N(16,6)` and `C(3)`. **Quantity of this batch, not of the line.** The two are
the same number only when the line has one batch, which is the case the current
mapper assumes and the case the spec does not.

The unit is the line's UQC, already normalised by `normalizeUqc()` in
`merge.ts`, so it agrees with `ITEMS.Qty_Unit` by construction. Six decimals,
which is `qty()` in `cell.ts`.

**The sum rule is ours, not ICES'.** Nothing published says the batch
quantities must total the line quantity, but a declaration where they do not is
either a missing batch or a wrong number, so the mapper warns when they
disagree rather than adjusting either.

## 6–7. `Prod_Manufacturer_Date`, `Prod_Expiry_Date`

Both mandatory for FSSAI and CDSCO alike. The spec builds three derived figures
on them, and they are the reason the dates matter beyond the sheet:

```
Total shelf life (in days)    = Date of Expiry − Date of Manufacturing
Residual shelf life (in days) = Date of Expiry − Inward Date
Residual shelf life (in %)    = Residual / Total × 100
```

`single-window.ts` already computes `item.residualShelfLifePercent` from these,
which is what FSSAI's 60 % residual-shelf-life rule is checked against. A row
dropped for want of a date silently drops that check too — which is the second
reason the drop is warned about rather than swallowed.

## 8. `Prod_Best_before_Date` — the defect to fix

**The mapper writes the expiry date into this column, and that is wrong.** The
comment admits it (*"the draft models no separate best-before date"*), and for
the goods that reach this sheet the two dates are routinely different: a
best-before is a quality date and an expiry is a safety date, and food packs
carry both. Writing one into the other declares a fact about the goods that no
document supports.

`CoaProductSchema` (`packages/extraction/src/schemas.ts:432`) has no
`bestBeforeDate` field at all. Adding one, and dropping the row when it is
unknown, is the honest behaviour and the one this sheet's own all-or-nothing
rule already implies.

---

## When a row is required

| Trigger | Source | Strength |
|---|---|---|
| The BE is referred to the **Drug Controller** | spec p.47, *"This table is mainly applicable for drugs"*; SWIFT referencer v1.7 §4 | mandatory, and fields 9–11 mandatory with it |
| The line is an **FSSAI** commodity | spec p.47, *"This table is applicable/Mandatory for FSSAI also"* | mandatory; fields 9–11 optional |
| Anything else | — | **no row**. The sheet stays header-only, as it does on the `ex_job6` golden: polypropylene is not a PGA commodity and has no shelf life |

## The three defects, named

1. **`DraftItem.batch` is singular.** `draft.ts:357` models one batch per line;
   the spec is per batch and says so — *"Production batch nos are provided along
   with the consignments"*, plural. `CoaExtractSchema` already parses
   `products: CoaProduct[]`, and `merge.ts:1442` then `find()`s **one** of them
   and throws the rest away. A consignment of six lots of the same drug declares
   one lot today.
2. **Best-before is the expiry date.** Above.
3. **The PGA trigger is the wrong test.** `sw-production.ts`'s comment says the
   draft populates `batch` for chapters 2–22 via `SINGLE_WINDOW_RULES` — it does
   not. `merge.ts:1446` sets `batch` from **any** certificate of analysis,
   ungated by chapter, so a lubricant CoA produces batch rows (which is exactly
   what the FUCHS rejections were) while a chapter 30 drug with no CoA produces
   none. The chapter test that does exist covers FSSAI's 2–22 and 35 and
   **misses CDSCO entirely**, where this table is most mandatory. The trigger
   belongs on the PGA-CTH mapping in `reference/pga-cth-list-v1.7/`, not on a
   chapter range.

---

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `ITEMS` | every `(Inv_SrNo, Item_SrNo)` here must exist there | ICES rejects a batch on a line that is not declared |
| `ITEMS.Qty_Unit` | `Prod_Batch_Unit` must be the same UQC | one line cannot be quantified in two units |
| `INBOND_EXBOND` | an ex-bond (`X`) BE may carry **no** rows here | components matrix, `X` under *Ex-bond BE* |
| `SW_ADDL_INFO` | a `CTG`/`DRC` row makes the BE an ADC case, which makes this sheet mandatory | SWIFT referencer v1.7, Drug Controller page |
| `SW_CONSTITUENT` | mandatory alongside on an ADC case — *"The Production Details shall also be fill up"* | same page; see [12-sw-constituent.md](12-sw-constituent.md) |
| `SUPPORTING_DOCS` | the certificate of analysis these dates are read off is itself an eSanchit document | doc type `001000` |

## What ICES rejects

| Code | Rejection | Bearing on this sheet |
|---|---|---|
| **500** | *Mandatory Product details are missing for …* | the row that should have been here and is not — the direct cost of dropping a batch for want of a date |
| **465 / 466** | *Inv. No. / Item No. cannot be null or negative or zero* | the two keys |
| **472** | *SW Info type Table Details are not available for …* | a production row on a line with no Single Window declaration behind it |
| **488** | *Info Measurement / UQC is null or Invalid UQC* | `Prod_Batch_Unit` outside the ICES UQC directory |

## Before the defects can be closed

Two gaps upstream, in this order:

1. **`CoaProductSchema` keeps one date pair and no best-before.** Add
   `bestBeforeDate`, and keep every product row rather than `find()`ing one.
2. **There is no PGA-by-CTH lookup.** `singleWindowRuleForChapter()`
   (`masters/index.ts:656`) is a chapter range. The SWIFT referencer's CTH-PGA
   mapping — 160 pages of it, in the repo — is what says whether FSSAI or CDSCO
   applies to a line, and nothing parses it yet. It is the same master
   [14-sw-control.md](14-sw-control.md) needs.
