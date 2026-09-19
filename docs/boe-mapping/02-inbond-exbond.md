# INBOND_EXBOND

One row, and only for a bonded Bill of Entry. A home-consumption BE emits **no
rows at all**, which leaves the sheet byte-identical to the vendor's template —
`sheet-writer.ts` skips an empty row array.

Implemented by `packages/exporter/src/map/inbond-exbond.ts`, fed by
`apps/web/lib/inbond.ts` (`applyInbondExbondResolution`), which runs after
`applyGeneralResolution` in `apps/web/lib/draft-pipeline.ts` — everything here
is conditional on the BE type that resolver settles.

## Why this sheet is strict

Two facts from primary sources in `data/customs-corpus/icegate-specs/`:

- **`advisory - changes in ex-bonding_0.pdf`** — from 1 September 2025,
  ex-bonding requires the warehouse code to be declared, and is allowed only
  for quantity **ICES's own ledger** holds against that into-bond BE, the
  ex-bonder's IEC *and* that warehouse. ICES debits the ledger itself. A wrong
  warehouse code is a refused release, not a correction on a checklist.
- **`BE Message format 2.25 (16Feb2026).pdf`**, header fields 31–38, every one
  marked `M` in the Ex-Bond column:

  | # | Field | Type | Len | Where it goes |
  |---|---|---|---|---|
  | 31 | Warehouse Code | C | 8 | `WH_Code` |
  | 32 | Warehouse Customs Site ID | N | 6 | not on this template |
  | 33 | Ware house BE No | C | 7 | `InBond_BENo` |
  | 34 | Ware house BE Date | Date | | `InBond_BEDate` |
  | 35 | No of packages released | N | 8 | **SHIPMENT** `No_of_Pkg` |
  | 36 | Package Code | C | 3 | **SHIPMENT** `PkgUnitCode` |
  | 37 | Gross Weight | N | 12,3 | **SHIPMENT** `GrWt` |
  | 38 | Unit of Measurement | C | 3 | **SHIPMENT** `GrWtUnitCode` |

  Note the last four: the release quantity is mandatory on an ex-bond BE and
  **has no column on this sheet**. See [The released portion](#the-released-portion).

ICES's own BE-type letter for ex-bond is `X`; the Logi-Sys template wants `EX`
(`BE_TYPE_CODE` in `packages/core/src/masters/codes.ts`).

---

## 1–7. The warehouse block

**Source:** the code from mail / document / parent job / operator; the name and
address from ICEGATE or the operator.

### `WH_Code`

An eight-character code that **decodes offline**:

```
  M A A 1   U   0 0 1
  └──┬──┘   │   └─┬─┘
     │      │     └── running serial, three digits
     │      └──────── U public (s.57) · R private (s.58) · P special (s.58A)
     └─────────────── EDI port of registration: MAA1 -> INMAA1, Chennai Sea
```

The port prefix is an ICES site code with `IN` stripped, so it validates against
`GENERATED_CUSTOM_HOUSES` with no network at all —
`parseWarehouseCode()` in `packages/core/src/masters/warehouse-code.ts`.
`MAA1U001` is real: M/S APM TERMINAL(I) PVT. LTD, from ICEGATE's own Public
Enquiries manual (v1.01, §5.5).

**Blocker** when the code is absent or fails to parse. The rejection names the
character at fault — "`ZZZZ` is not an ICES port code", "the fifth character is
U, R or P" — rather than "invalid".

**Warning** when the warehouse's licensing station differs from the station the
BE is filed at. Legitimate for a bond-to-bond movement, a typo otherwise.

> Confirm `R` = private and `P` = special against a real licence. The sources
> agree on `U` = public; the other two are the less-attested half of the
> mapping. See [open-questions.md](open-questions.md#warehouse-type-letters).

### `WH_Name`, `WH_Add1`, `WH_Add2`, `WH_City`, `WH_PIN`

**Not encoded in the code** — nothing can infer them. Two sources:

1. **ICEGATE's public warehouse enquiry**,
   `enquiry.icegate.gov.in/enquiryatices/wareHouseCodeEnquiry`. Takes a code or
   a name (min 3 characters), returns code / name / address. No login, no
   captcha. Client: `apps/web/lib/icegate-warehouse.ts`.
2. **The operator**, when it cannot be reached.

Either way the answer is cached in `bonded_warehouses` and read from there
afterwards. A government portal does not sit in the path of a workbook
download, and the data survives that portal being down.

`WH_PIN` is written with `code()`, not a number: a PIN with a leading zero is a
real PIN.

**Warning**, never a blocker, when only the code is known. ICES needs only the
code; the name is for Logi-Sys's own printing.

### `WH_Country`

**Constant `IN`.** The one honest constant on this sheet — a warehouse licensed
under the Customs Act, 1962 is in India by definition.

---

## 8–9. `InBond_BENo`, `InBond_BEDate`

**Ex-bond only.** Blank on a `W` filing, which *is* the into-bond BE and cannot
draw against one.

Four sources, in precedence order:

| Source | Where |
|---|---|
| operator | `job_boe_header.inbond_be_no` / `_date` |
| parent job | `jobs.into_bond_job_id` → that job's own resolved block |
| attached document | doc type `into_bond_be`, extracted by `IntoBondBeExtractSchema` |
| mail | `job_mail_instructions.inbond_be_no` + its quoted sentence |

**Blocker** on an ex-bond BE with either missing.

The parent-job link is also the only thing that can fill
`ITEMS.Inbond_InvSrNo` / `Inbond_ItemSrNo`, still hard-zeroed in
`map/items.ts` — the into-bond BE's own item serials are what an ex-bond
clearance points back at.

## 10–12. `Bond_No`, `Bond_Date`, `Bond_ExpiryDate`

**Source:** operator, then an attached into-bond BE, then the mail.

**Warning** when the bond number is missing, and again when the expiry date has
passed — warehoused goods need a bond in force.

The mail extractor is told explicitly that a bank guarantee, a continuity bond
for another purpose, or a shipping-line container deposit is **not** this.

## 13–14. `IsWareHouseSale`, `IsSEC65ManufacturingWH`

**Source:** `IsWareHouseSale` is an operator checkbox. `IsSEC65ManufacturingWH`
defaults from `bonded_warehouses.is_sec65` — a Section 65 permission belongs to
the warehouse, not to a filing — and the operator's tick on the job overrides
it. Both `ynBlank()`: `Y` when ticked, blank otherwise, never `N`.

Section 65 alone does not decide what an ex-bond BE declares. What it clears is
a separate operator answer, `job_boe_header.exbond_clearance_kind`, because
Circular 48/2020 para 8.1 lets warehoused goods be cleared **as such** out of
the same warehouse — with interest under section 61, and with no finished
product to declare. Only a `resultant_product` clearance fills
[SEC65_EXBOND_INFO](08-sec65-exbond-info.md); the others **warn** that interest
is payable, and an unanswered one warns that nobody has said.

---

## The released portion

Fields 35–38 above are mandatory on an ex-bond BE and have no column here, so
they reach the workbook through the sheets that do have columns:

```
Into-bond BE:    200 kg, 8 bags
This ex-bond BE:  50 kg, 2 bags   <- what is declared

  SHIPMENT.No_of_Pkg  = 2
  SHIPMENT.GrWt       = 51.000
  ITEMS[].QTY         = the released quantity
  ITEMS[].amount      = rescaled with it
```

**The whole Bill of Entry states the released portion**, not the warehoused
consignment. So `applyInbondExbondResolution` rescales `draft.items` — quantity
and amount together, which is what keeps the ITEMS sheet's
`quantity × unit price = amount` blocker true — and calls `recomputeDuty`,
because the assessable value moved. Doing that in the resolver rather than the
exporter keeps one truth on the draft: what the job screen shows is what the
workbook says and what duty was computed on.

**Blocker** on an ex-bond BE that does not say how much it releases.

### Where the weight comes from

Goods leave a bond in whole packages, and the BE declares what those packages
weigh. That requires a **per-package weight**, which needs the packing list read
line by line rather than as totals:

```
packing list:  PRODUCT A · 10 BAG · 250 kg net · 255 kg gross
               -> 25.5 kg gross per bag
releasing 4:   4 x 25.5 = 102.0 kg
```

`PackingListExtractSchema.lines[]` captures the rows;
`packages/extraction/src/packing.ts` matches them to invoice lines and derives
`perPackageGrossKg` / `perPackageNetKg` onto `DraftItem.packing`.

Matching refuses rather than guesses, on the same discipline as
`resolveIndianStation`: a line matching no item, matching two items equally
well, or one item matched by two rows of different package sizes attaches
**nothing** and warns. A wrong per-package weight puts a wrong gross weight on
a customs declaration; an empty field gets filled by the operator, a wrong one
looks answered.

A weight the operator keys always wins over a derived one — they can see the
goods. When both exist and disagree by more than 1%, that is a warning.

Our arithmetic is a **pre-check, never the authority**: ICES keeps the ledger
and will refuse a release larger than it holds.
