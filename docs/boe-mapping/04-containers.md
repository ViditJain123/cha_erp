# CONTAINERS

One row **per container**. Which boxes the consignment moved in, as the bill of
lading lists them.

Implemented by `packages/exporter/src/map/containers.ts`, fed by the container
block of `packages/extraction/src/merge.ts` and, for the operator's own list, by
`apps/web/lib/containers.ts` (`applyContainerResolution`).

Column list and every `constant` below are taken from the vendor's own files:
`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx` (Logi-Sys' export of a
four-container job), `ex_job6/logisys-EP061126-1-20260630.xlsx` (six), and
`logisys-dbf3530c-…xlsx` (four), plus the annotated `understanding_this_sheet.xlsx`,
which is the customer's own instruction for this tab.

## Why this sheet needed dictating

Every export the system had produced carried **one** container row, whatever the
document said. `liv_job1` moves four boxes; `ex_job6` moves six. A Bill of Entry
that declares one of six containers is not a smaller filing, it is a wrong one,
and it is the kind of wrong that is invisible in the finished workbook — four
rows and one row look equally plausible unless something holds the B/L's own
total up beside them.

The mapper was never the problem: it has always emitted one row per container.
Three things upstream lost them, and all three are now closed:

1. The B/L extraction prompt gave containers one sentence out of forty fields.
   It now has a block of its own (`packages/extraction/src/extract.ts`).
2. Nothing compared the list against `containerCount`, which the schema already
   carried. `containerCountStated` now travels on the draft beside the list, and
   a disagreement warns at merge, on the job screen, and at export.
3. Containers came from exactly one bill of lading. They now come from every
   B/L on the job, deduplicated on the number.

Two more defences sit on top: a **second, container-only read** of the document
when the first pass looks thin (`packages/extraction/src/containers.ts`), and an
**operator list** (`job_containers`) for the documents that cannot be read at
all — `ex_job4`'s B/L is a scan with no text layer.

No column on this sheet raises a `blocker`. A count mismatch warns loudly and the
workbook is still built: the operator may know the list is right and the printed
total wrong, and the other nine sheets are worth having meanwhile.

---

## 1. `IGM Sr.No`

**Source:** `constant` — the row's position, 1…n, and it always warns.

Mandatory. Leaving it blank is what made Logi-Sys reject job `dbf3530c`: four
errors, one per container, and the whole workbook refused — so the invoice and
the products never landed either.

No document we read carries the IGM line number. Logi-Sys' own export of
`liv_job1` numbers its four containers 1, 2, 3, 4 in B/L order, so that is what
we write, and `containers.ts` says so out loud every time: *check them against
the IGM before filing*.

## 2. `Container No`

**Source:** `document` (every B/L on the job), then `operator`.

Exactly as printed — never normalised on the way in, because the B/L's spelling
is what a person checks against. Matching (dedupe across two bills of lading,
against ingest's identifiers, against a typed list) is done on the normalised
form, `normaliseContainerNumber()` in `packages/core/src/masters/codes.ts`.

Each number is checked against its **ISO 6346 check digit**
(`isValidContainerNumber()`, same file). A number that fails it is **kept and
flagged**, never dropped: refusing a container is a container missing from the
Bill of Entry, which is the failure this whole path exists to stop.

`understanding_this_sheet.xlsx`: *As per BL*.

## 3. `Seal No`

**Source:** `document`, then `operator`. Warns per container when absent.

Seals are per box. The extraction prompt says so explicitly, because a single
seal copied down four rows is a plausible-looking wrong answer. Logi-Sys' own
export of `liv_job1` leaves this column empty on all four rows, so a blank here
is not a rejection — it is a gap worth a warning.

`understanding_this_sheet.xlsx`: *As per BL*.

## 4. `FCL_LCL`

**Source:** `constant` — `FCL`.

CONFIRM. Every job in the corpus is full-container, and all three vendor
workbooks write `FCL` on every row. Ingest's triage already reads a real
`containerMode` off the B/L for the delivery-order desk
(`packages/ingest/src/triage.ts`); when the first LCL job appears, that is where
this column's source comes from, and it should not be inferred from anything
else. A wrong value here changes how Customs treats the consignment.

`understanding_this_sheet.xlsx`: *As per BL*.

## 5. `ContainerTypeCode`

**Source:** `document`, derived.

`iso6346Code(size, typeCode)` over the verbatim `sizeType` — `22G1` for a 20'
general-purpose box, `45G1` for a 40' high cube. Returns nothing rather than
guessing a standard box when either half is unreadable.

The vendor is not self-consistent here: `liv_job1`'s own export writes `22G1`
while `ex_job6`'s writes the two-letter group `HC`. The ISO code is what
`understanding_this_sheet.xlsx` shows (`45G1`), and it is what we write.

## 6. `ContainerSize`

**Source:** `document`, derived.

`parseContainerSizeType(sizeType).size` → `20`, `40`, `45`. The same physical box
arrives as `40SD96`, `20GP`, `45G1` or `1 X HIGH CUBE 40` depending on who
printed it, which is why the raw string is what is stored and the two columns are
derived from it rather than the other way round.

`understanding_this_sheet.xlsx`: *As per BL*.

## 7. `Truck Number`

**Source:** `constant` — always blank.

Nothing at Bill of Entry time knows it. It belongs to the delivery-order desk,
after the box has been released.

## 8. `EmptyContainerLocation`

**Source:** `constant` — always blank.

Same reason: the empty-return yard is a detention question, not a declaration
one, and `job_do_containers` is where it is tracked.

## 9. `PackagesStuffed`

**Source:** `constant` — `0`.

`understanding_this_sheet.xlsx` annotates this column *not empty* / *enter 0*,
and Logi-Sys' own export of `liv_job1` writes `0` on all four rows. The total
package count is declared once, on SHIPMENT.

`ex_job6`'s vendor export does carry a per-container figure (1043 on each of six
rows, being 6258 ÷ 6), and it is an even split rather than a reading of anything.
We do not reproduce that: a split is arithmetic dressed as a fact.

## 10. `GrWt`

**Source:** `constant` — `0.000`.

As above, and for the same reason. The consignment's gross weight is declared on
SHIPMENT, from the document that states it.

---

## The count check

`draft.shipment.containerCountStated` carries what the B/L says the total is —
"SAY : SIX CONTAINERS ONLY", "6 CTRS", "Total No. of Pkgs/Cntrs 0004 CNTR",
"1 X 40' FCL CONTAINER". It is not used to fill any column. It exists only to be
disagreed with, in three places:

- `merge.ts` raises a `shipment.containers` flag,
- the **Containers** panel on the job shows both numbers side by side and says
  which one the Bill of Entry would declare,
- `containers.ts` (exporter) warns on `CONTAINERS.Container No` at download.

## What is scored

`packages/extraction/eval/run.ts` asserts the container count, the set of
numbers and the parsed sizes against the real PDFs for five jobs: `ex_job2`,
`ex_job3` and `ex_job4` (one container each), `liv_job1` (four) and `ex_job6`
(six). The single-container jobs are in that list on purpose — a fix for the
multi-container ones must not pass by inventing containers.

Seal numbers are printed by the eval but not scored: Logi-Sys' own export of
`liv_job1` leaves them blank, so the corpus cannot say what right looks like.
