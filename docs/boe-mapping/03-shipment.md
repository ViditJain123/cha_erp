# SHIPMENT

One row. The transport document — which conveyance carried the goods, under
whose bill of lading or air waybill, how many packages, and what they weigh.

Implemented by `packages/exporter/src/map/shipment.ts`, fed by the
`// ---- Shipment ----` block of `packages/extraction/src/merge.ts` and, for the
six operator columns, by `apps/web/lib/general.ts` (`applyGeneralResolution`).

Vendor evidence for the column list and for every `constant` below: five
workbooks Logi-Sys produced or accepted —
`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx` (its own export),
`final (1).xlsx`, `logisys-ce9c889d-…xlsx`, `logisys-dbf3530c-…xlsx` and
`ex_job6/logisys-EP061126-1-20260630.xlsx` — plus the seven checklists Logi-Sys
printed for `ex_job1..7`.

## Why this sheet needed dictating

Every other sheet's blanks are mostly *inapplicable* columns. SHIPMENT's were
not: five columns shipped blank with no warning at all, three more went blank
whenever nobody had keyed them, and the extraction schema had nowhere to put
half of what a bill of lading actually prints. The complaint this document
answers was "data just goes missing", and it was accurate.

The rule from [README.md](README.md) now holds here too:

> A column with no available source does not silently become blank. It raises a
> `warn` or a `blocker`.

No column on this sheet raises a `blocker`. Every gap here is completable by
hand in Logi-Sys, and the other nine sheets are worth having meanwhile.

---

## 1. `CarrierCode`

**Source:** `constant` — always blank.

All five vendor workbooks write nothing here, on every row, **including the rows
that name a carrier**. `liv_job1`'s bill of lading has an explicit
`Carrier: RCL FEEDER PTE LTD` box and Logi-Sys' own export still leaves
`CarrierCode` empty. It resolves the shipping line from `CarrierName` against
its own repository; there is no code to give it.

**This is the one column on the sheet that does not warn.** An unfillable column
that is *meant* to be empty is not a gap, and warning about it every time would
teach operators to ignore the warning list. `golden-ep061126-1.test.ts` asserts
both halves: the cell is empty, and no warning mentions it.

> Not a missing master. [masters.md](masters.md) lists "carrier code master"
> under *deliberately not built*, and the reason is this column, not an
> unfinished task.

---

## 2. `CarrierName`

**Source:** `document`, then `master` on air.

The carrier is not whoever's name is most prominent on the document, and the
three parties on a transport document are not interchangeable.

| Mode | Rule |
|---|---|
| Sea | the B/L's `carrierName` — the carrier proper — then its `shippingLine` |
| Air | `lookupAirline()` on the MAWB's 3-digit prefix; the stated carrier only as a fallback |

**Sea: the carrier hides.** On `ex_job6` it appears nowhere but the signature
block — *"INTERASIA LINES, LTD. AS AGENT FOR THE CARRIER INTERASIA LINES
SINGAPORE PTE. LTD."* — while the letterhead names the shipper; the accepted
workbook says `INTERASIA LINES`. On `ex_job2` it is only in the letterhead.
`logisys-dbf3530c` says `Maersk A/S`, which on a Maersk waybill appears only as
*"Signed for the Carrier Maersk A/S"*. So the extraction prompt asks for the
letterhead, the `Carrier` box and the signature block by name, and returns the
agent and the forwarder into separate fields so neither can be mistaken for it.

**Air: the form names a forwarder.** `ex_job1`'s air waybill says
`Issuing Carrier's Agent: DSV AIR & SEA INC` and `Issued by DSV AIR & SEA INC`.
DSV is a freight forwarder. The carrier is Air France, and two independent
things on the page say so: the MAWB `057 BOS 79606800` and the routing row
`CDG / AF / BOM / AF`. The prefix is the reliable one, so it wins, and
`GENERATED_AIRLINES` — 61 airlines, in the repo and until now wired to nothing —
is what decodes it. `057` → AIR FRANCE, `618` → SINGAPORE AIRLINES; both golden
air jobs resolve.

> `lookupAirline` matches a prefix on a word boundary, so it must be handed the
> three digits, not the whole number: `61854841905` has no boundary after `618`.

**Failure mode.** A prefix not in the 61-row master falls back to the stated
carrier **with a warning**, because that value may well be the forwarder. An
empty cell warns.

**Known divergence: the legal name versus the trading name.** Reading `ex_job6`
live returns `INTERASIA LINES SINGAPORE PTE. LTD.` — the carrier named in the
signature block — where the accepted workbook carries `INTERASIA LINES`. Both
name the same company and the extraction is arguably the more correct of the
two. Normalising one to the other would need a carrier-name master, which
[masters.md](masters.md) does not build and should not, so the eval compares
this column by containment rather than equality. If Logi-Sys ever fails to
resolve a line from the longer form, that is the evidence that would justify
building the master.

---

## 3. `VesselName`

**Source:** `document`. Sea only.

The B/L's own vessel box when it has one (`liv_job1`: `Vessel WAN HAI 515`),
otherwise `splitVoyage()` separates a combined string
(`ex_job2`: `WADI DUKA/02621/N`).

**Blank on air, and silent about it.** There is no ship on an air job. This
column used to carry the flight string, because `merge.ts` wrote the air
waybill's `flightAndDate` into the same draft field the vessel uses.

**Failure mode.** Empty on a sea job warns. `splitVoyage` declines to split when
the tail does not look like a voyage — a blank voyage column a person fills in
beats a vessel name silently truncated.

---

## 4. `Flight_Inward_Date`

**Source:** `operator`. The entry-inwards date, off ICEGATE.

The same value that drives `AdvancePriorNormal` and both section flags, so it is
already keyed on the job screen and already governs GENERAL — see
[01-general.md](01-general.md).

**Failure mode.** Warns **only when `igm_checked` is true.** An Advance filing
legitimately has no inward date yet, and nagging for one before the vessel has
arrived is nagging for a value that does not exist. The distinction is exactly
what the `igm_checked` box is for.

---

## 5. `FlightNo_VoyageNo`

**Source:** `document`.

Sea: the voyage number. Air: the flight number, split out of the
`Requested Flight/Date` box (`AF331/01` → `AF331`).

**Failure mode.** Empty warns, with the message naming a flight or a voyage
according to the mode.

---

## 6. `LineNo`

**Source:** `operator`. The consignment's line number on the IGM.

On no document the customer sends. It comes off the same ICEGATE enquiry as the
IGM number, so it is keyed in the same block on the job screen.

Stored as `text`, not an integer, for the reason `ad_code` is text: a leading
zero that becomes a number is a different line.

**Failure mode.** Warns when `igm_checked` is true and it is empty — somebody
did the lookup and did not write this part down.

---

## 7–8. `IGM_No`, `IGM_Date`

**Source:** `operator`.

**On an ICD job this is the ICD's own manifest**, not the gateway port's. The
dictation is explicit:

> In case of ICD, in this field we have to write the IGM of ICD and in there the
> Gateway one, the Gateway IGM number and Gateway IGM date. Over there we have
> to write the IGM number from Gateway board.

**Failure mode.** As column 4: warn only once ICEGATE has been checked.

---

## 9–10. `MAWB_MBL_No`, `AWB_BL_Date`

**Source:** `document`. **The main carrier's document only.**

> Main carrier hoona chaiye.

The master air waybill on air, the master bill of lading on sea. A freight
forwarder's house B/L is a different contract with a different carrier, and
writing it here names the wrong carrier on a customs declaration.

```
master B/L or MAWB present          -> here
house B/L only, quoting its master  -> the master goes here, the house in 11-12
house B/L only, quoting no master   -> BLANK + warn; the house goes in 11-12
```

`merge.ts` enforces this at the source: when `isHouseBl` is true, the number
reaches `hblNo` and reaches `blNo` **only** from `masterBlNumber`. Previously it
set both from the same number and the mapper wrote it into column 9.

**Which number is the B/L number.** `ex_job2`'s bill of lading prints three
side by side — `BOOKING NO ESLKEMBFL2000990`, a `BL No.` box that OCRs as
`l.o,o`, and `AGENCY REF NO EMIVKEMBFL200846` — and the checklist Logi-Sys
printed files **EMIVKEMBFL200846**, the agency reference. So each number is
extracted into its own field, and when the agency reference differs from the
number we picked, the draft says so rather than choosing silently. The same
number is also printed legibly in the continuation-sheet footer
(`continued in next … BL No. EMIVKEMBFL200846`), which is why the prompt tells
the model to read it from there when the header box is unreadable.

**The date is the shipped-on-board date**, with the date of issue as the
fallback, and an `info` flag naming which was used when the two differ. See
[open-questions.md](open-questions.md) — on two of three sea goldens the date
Logi-Sys filed is neither.

**Failure mode.** No master document at all warns, naming the house number if
there is one. A master with no date warns separately.

---

## 11–12. `HAWB_HBL_No`, `HAWB_HBL_Date`

**Source:** `document`.

Air is settled by the goldens: `ex_job1` files `HAWB No. BOS0121016 dt.
30-Jun-2026` and `ex_job5` `OGC2606212 dt. 10-Jun-2026`, both off the house air
waybill, both with numbers unrelated to their master's. The house date is now
independent of the master's — they used to share one field.

**Sea is annotated "Ask Sandesh"** and is not settled. Interim: filled only
under the house-B/L rule in columns 9–10. See
[open-questions.md](open-questions.md).

**Failure mode.** A house document with no date warns.

---

## 13. `No_of_Pkg`

**Source:** `document`, across all of them. Ex-bond release wins.

Precedence: bill of lading → air waybill → packing list → certificate of origin.
A value on *any* of them reaches the sheet; the chain used to stop at two.

**Packages are not containers.** `liv_job1`'s B/L prints
`Total No. of Pkgs/Cntrs  0004  CNTR` in the totals box while the cargo is
`4000 BAG(S)`. Four is a true number on that document and a false package count,
and a BE declaring four bags of maleic anhydride is a misdeclaration. The
extraction schema now has a `containerCount` field for the 4 to go to, the
prompt states the trap with this exact example, and the merge warns when the
package count and the container count are equal.

`ex_job6` is the same shape more subtly: `6 CTRS` and `(6,258 BAG(S))` in
adjacent columns.

On an ex-bond BE this column is the **release**, not the consignment — see
[02-inbond-exbond.md](02-inbond-exbond.md).

**Failure mode.** Empty warns, and the message says a container count is not a
package count.

---

## 14. `PkgUnitCode`

**Source:** `document` → `master` → `operator`.

Resolved through `PACKAGE_UNITS` / `normalizePackageUnit()`, so `BAGS`,
`BAG(S)` and `BG` all become `BAG`.

**On air there is usually no document source at all.** Job I-13841/26-27 was
filed `1 PLT` and I-30239/26-27 `20 PKG`, and neither air waybill printed either
word — an air waybill counts pieces without naming them, and `ex_job5`'s packing
list mixes cartons and pallets, which is why the operator generalised to `PKG`.
So this is an operator field (`job_boe_header.package_unit_code`), validated
against the master when it is saved rather than at export.

> Removed in this change: `pkgUnit = bl?.packageUnit ?? (awb ? 'PLT' : undefined)`.
> A constant in code, and wrong on half the air jobs we hold.

**Failure mode.** A unit the master does not know warns, naming it. No unit at
all warns separately.

---

## 15–18. `GrWt`, `GrWtUnitCode`, `NtWt`, `NtWtUnitCode`

**Source:** `document`, across all of them. Unit through `master`.

Gross: B/L → AWB → invoice → packing list → COO.
Net: B/L → packing list → invoice → AWB.

**The unit is not a literal.** `ex_job6`'s B/L prints `157,703.000 KGM` — the
UN/ECE Recommendation 20 code for kilograms, which an EDI-generated B/L uses and
a human never would — with a volume in `MTQ` in the same column. `WEIGHT_UNITS`
/ `weightToKg()` in `packages/core/src/masters/codes.ts` converts at read time
and the mapper writes the resolved code, so:

- `KGM`, `KG`, `KILOGRAMS` → kilograms, `KGS`
- `LBS` → **converted**, not relabelled
- `MTQ`, `CBM` → not a weight. The figure is refused and the draft warns.

That last one is the point of having the table: a volume written into `GrWt`
would be a confident misdeclaration, and `GrWtUnitCode: 'KGS'` as a code literal
is what would have let it through.

**Net weight is usually not a labelled field.** `ex_job2` states it inside the
description block (`NET WT: 25000.00 KGS`); `ex_job6` states it on the attached
list (`NET WEIGHT:156,450(KGS)`), which is why the prompt now says to read every
page including continuation sheets.

**Failure modes.** Either weight missing warns. A net weight larger than the
gross warns — one of the two is misread. Documents that disagree by more than 2%
warn and name each document with its figure; within 2% is a printing difference,
not a dispute.

---

## 19. `Marks_&_Nos`

**Source:** derived, with an `operator` override. Never blank.

| Case | Value |
|---|---|
| Air, master and house waybill | `MAWB` / a sixteen-dot rule / `HAWB`, over three lines |
| Air, master only | the MAWB alone |
| Sea | `AS PER BL` |
| Re-import, FOC, or anything else | whatever the operator writes |

The air form is transcribed from both air checklists, which print it identically:

```
Marks & Nos     05779606800
                ................
                BOS0121016
```

`cell.text()` collapses the newlines, so the exported cell reads
`05779606800 ................ BOS0121016`.

**`AS PER BL` is a default, not a law.** `ex_job3` files
`RE-IMPORT OF INDIAN ORIGIN GOODS & RE EXPORTED` and `ex_job4` files
`INV NO-GFLA/RETURN/INVOICE / REJECTED AND RETURNBLE CARGO`. Both are re-imports,
both free of cost, and neither phrase is on any bill of lading — they are
declarations a person writes. So `job_boe_header.marks_and_nos` overrides, and
once set it survives a re-read of the documents.

**Failure mode.** Empty warns. The BE never leaves this cell blank.

---

## 20. `Port_of_Reporting`

**Source:** mirrors `GENERAL.CustomsHouseCode`. Never the B/L's discharge port.

On an ICD job this is the **ICD**, not the sea port the vessel reported at. The
gateway appears only in columns 21–23.

```
GENERAL.CustomsHouseCode = INTKD6      (ICD Tughlakabad)
SHIPMENT.Port_of_Reporting = INTKD6
SHIPMENT.IGM_No            = the ICD's manifest
SHIPMENT.Gateway_IGM_No    = Nhava Sheva's manifest
```

**Failure mode.** None of its own. GENERAL blocks the export when no station has
been chosen, so this cannot ship blank on its own.

---

## 21–23. `Gateway_IGM_No`, `Gateway_IGM_Date`, `Gateway_Inward_Date`

**Source:** `operator`.

A consignment cleared inland was manifested at a sea port first, and the Bill of
Entry carries both manifests. On a direct-port filing there is no gateway and
these three are correctly empty.

**The station's kind decides whether they are applicable, and it comes from the
sixth character of the ICES site code** — `6` (ICD/CFS/SEZ), `2` (rail) and `B`
(land customs station) are inland. Not from the station's name, for the reason
[01-general.md §1](01-general.md) sets out at length: the names lie.

**Failure mode.** On an inland filing, empty warns, naming the station and
restating that `IGM_No` carries the ICD's own manifest. On a gateway port they
stay silent — which is what all five vendor workbooks show, every one of them
filed at a sea port with all three blank.

---

## What is deliberately not automated

**ICEGATE is not scraped.** Six of these columns are ICEGATE's, and the only
ICEGATE client in the repo is the warehouse enquiry, which returns NOERROR from
outside India (see [open-questions.md](open-questions.md)). They are keyed, and
every one of them now says so on the export instead of arriving empty.

## Tests

| File | What it pins |
|---|---|
| `packages/exporter/test/golden-ep061126-1.test.ts` | the full sea row, plus the four silences: `CarrierCode`, the gateway columns at a sea port, and the IGM block before anyone has checked |
| `packages/exporter/test/shipment.test.ts` | every warn, as a departure from the golden draft; and the air row |
| `packages/extraction/test/shipment-merge.test.ts` | which document wins, per field: the airline prefix, the house B/L rule, KGM and MTQ, the container trap, the marks conventions |
| `packages/extraction/eval/run.ts` | the only assertions that read the real PDFs — seven jobs, each pinning a different trap |

> The golden exporter tests run off hand-transcribed drafts. They pin the mapper
> and **cannot** catch an extraction regression. The eval is the only thing
> standing between a prompt change and a silently emptier sheet.
