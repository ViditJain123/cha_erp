# SEZ_INFO

**Which SEZ Bill of Entry the goods being sold into the domestic tariff area
originally came in on.** The sheet is ICES `<TABLE>BE_ITEM_SW_CTRL` again — the
same segment as [SW_CONTROL](14-sw-control.md) and
[SEC65_EXBOND_INFO](08-sec65-exbond-info.md) — in its SEZ form
(**BE Message format 2.25, CACHI01 Part 22/24**, p.48–49).

**One row per (line of goods × Z-type BE line it draws from)**, keyed
`InvSrNo` / `ItemSrNo` — note the spelling: **no underscores**, the `InvSrNo`
of ITEMS and INVOICES, not the `Inv_SrNo` of every other Single Window sheet.
`sheet-writer.ts` resolves columns by exact header text and will reject the
wrong one.

**Not implemented, deliberately.** `SEZ_INFO` is in `UNMAPPED_SHEETS`
(`packages/exporter/src/build.ts`). Filing an SEZ Bill of Entry is a different
line of business from the import clearance this system does, and nothing in the
corpus is one. See *Before this sheet can be wired*.

---

## What an SEZ Bill of Entry is

A Special Economic Zone is outside the customs territory. Goods enter it duty
free on a **Z-type** BE (`BE Type` field 18 importer type `Z`), and duty falls
due only when they leave the zone for the domestic tariff area. That exit is
itself a Bill of Entry:

| Type | ICES meaning | Where the goods go |
|---|---|---|
| `Z` | SEZ BE (FTA – SEZ) | into the zone |
| `T` | SEZ (DTA Sales – Trading) | out of the zone, unchanged |
| `M` | SEZ (DTA Sales – Manufacturing) | out of the zone, after manufacture inside it |
| `V` | SEZ Goods Movement (Manufactured Goods) | zone to zone |
| `S` | SEZ (DTA Sales – Stock Clearance) | filed in SEZ Online, cleared through ICES |
| `W` | SEZ to a Customs Bonded Warehouse, or back | added in spec 2.25, 16.02.2026 |

**This sheet exists to link a `T` or `M` filing back to its `Z`.** The duty on
the way out is computed on goods whose entry is already on record, and ICES
wants the pointer line by line.

## The two flavours, and they are not the same rule

The spec gives two recipes on the same page, and they differ in what the keys
mean:

**T type — mandatory, at invoice and item level:**

> Importer needs to **mandatorily** give the declaration of Z Type SEZ BE details
> for each item at BE invoice level and item level.
> `Invoice Serial No : T Type BE invoice Number` ·
> `Item Serial No : T Type BE Item number against inv slno.`

**M type — voluntary, at BE master level:**

> Importer needs to **voluntarily** give the declaration of Z Type SEZ BE details
> (used in manufacturing of goods) at BE master level.
> `Invoice Serial No : 0` · `Item Serial No : 0`

So on a `T` the keys are this BE's own line numbers; on an `M` they are both
`0`, because a manufactured article does not correspond to any one input line.
A mapper that treats the two alike misstates one of them.

## The columns

Ten columns, and every one of them is an ICES field renamed. This is the
mapping — it is the whole specification of the sheet, and the spec's recipe
reads directly onto it:

| # | Column | ICES field | Spec's SEZ recipe | Type |
|---|---|---|---|---|
| 1 | `InvSrNo` | 7. Invoice Serial No, key | `T`: this BE's invoice serial · `M`: `0` | N(5) |
| 2 | `ItemSrNo` | 8. Item Sr. No., key | `T`: this BE's item serial · `M`: `0` | N(4) |
| 3 | `SEZ_Z_InvSrNo` | 14. Control Result Text | Invoice Sr No (Z Type) | C(4000) |
| 4 | `SEZ_Z_ItemSrNo` | 17. Control Slno | Item Sr. No (Z Type) | N(4) |
| 5 | `BE_No` | 13. Control Result Code | Z Type BE No. | C(17), **M** |
| 6 | `BE_Date` | 11. Control Start Date | Z Type BE Date | Date |
| 7 | `BE_Location` | 10. Control Location | Z BE filed/cleared Location code | C(17), **M** |
| 8 | `Code` | 9. Control Type Code | the literal `SEZ` | C(17), **M** |
| 9 | `QTY` | 15. Control MSR | Quantity | N(16,6) |
| 10 | `Unit` | 16. Control UQC | Unit Quantity Code | C(3) |

Two things worth naming, because they are what a reader gets wrong:

- **`Code` is the only column on any of the seven sheets whose value is fixed by
  the spec.** It is the literal `SEZ`, and it is the discriminator that tells
  ICES to read the rest of the row by the SEZ recipe rather than as a plain
  control. It is a constant with its evidence named, which
  `docs/boe-mapping/README.md` permits; it is not a constant in the sense the
  rule forbids.
- **`SEZ_Z_InvSrNo` is ICES' `Control Result Text`, a `C(4000)` free-text
  field.** It holds a serial number because the SEZ recipe says to put one
  there. It is text, not a number, and must be written with `code()` so a
  leading zero survives.

`Control_End_Date` (field 12) has no column: the SEZ recipe assigns it nothing.

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `GENERAL` | the BE type must be `T` or `M` for this sheet to have rows | the recipe is scoped to those two |
| `SW_CONTROL` | a row here may not be repeated there | ICES 492, duplicate control at BE level |
| `SEC65_EXBOND_INFO` | same segment, mutually exclusive | same |
| `ITEMS` | on a `T`, every `(InvSrNo, ItemSrNo)` must exist there | ICES 734 |
| `ITEMS` | on an `M`, both are `0` and match no line | the spec's own recipe |
| `EXCHANGE_RATE` | on an `M` type the currency may only be `INR` | spec p.17 |
| `GENERAL` | on an `M` type, country of origin and of consignment are both `IN` | spec p.16 |
| `SHIPMENT` | `<TABLE>IGMS` is required for `Z` and not for `T`, `M`, `V`, `S` | spec p.13 |

## What ICES rejects

| Code | Rejection | Bearing on this sheet |
|---|---|---|
| **467** | *Invalid Control Code* | `Code` anything but `SEZ` |
| **468** | *Invalid Control Result Code* | `BE_No` not a Z-type BE ICES holds |
| **490** | *Mandatory Control Information Missing* | a `T`-type line with no Z-type pointer — mandatory, not optional |
| **492** | *Duplicate Control Information at BE Level* | the same pointer filed twice |
| **836** | *SEZ BE and SEZ Warehouse code wrong, or Warehouse does not belong to IEC* | — |
| **837** | *SEZ and GSTIN declared at Warehouse and GSTIN at BE are not matching* | — |
| **840** | *SEZ BE GATEWAY IGM Port of Reporting is …* | — |

## What is deliberately not built

No mapper, no draft field, no operator screen. The sheet stays header-only,
which is what all fifteen workbooks on disk do.

This is not a gap in the pipeline — it is a business the tenant is not in. An
SEZ DTA-sale filing starts from an SEZ Online record and a Z-type BE the CHA
did not file, neither of which reaches this system. Building a mapper for it
would be building for a job type that has never arrived.

## Before this sheet can be wired

1. **Confirm the tenant files `T` or `M` type Bills of Entry at all.** The
   corpus says no; the corpus is a sample. See
   [open-questions.md](open-questions.md#sez-info-trigger). If the answer is
   never, this document is the whole deliverable and the sheet stays unwired
   permanently.
2. If the answer is yes: the Z-type BE number, date, location code and line
   serials are **operator input**, because they come off a document the CHA did
   not produce. That means a `job_sez_links` table on the pattern of
   `job_sec65_finished_goods` — and the `T`/`M` distinction has to be modelled
   before the first row is written, not after.
