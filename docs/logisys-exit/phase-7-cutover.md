# Phase 7 — Parallel run and cutover

The only phase with no new capability in it. Its whole job is to earn the right
to switch the handoff off.

---

## The shape

Every job is filed **both ways** — through Logi-Sys as today, and through our
own channel — and the two are compared, until the differences stop being
differences that matter.

This is exactly what the corpus dry run already does, with one change: live jobs
instead of 32 historical folders, and a real filing on both sides rather than a
workbook on one.

## What "differences that matter" means

Do not chase 100% agreement. The comparison has known, acceptable noise:

- **We fill cells Logi-Sys leaves blank** — seal numbers, packages stuffed,
  gross weight. That is us being more complete, not less correct.
- **Logi-Sys writes its own screen defaults** where a column is genuinely
  optional.
- **Format differences** are already normalised by `corpus-compare.py`, which
  compares numbers as numbers and dates as dates.

What matters is a short list: the tariff code, the notification and serial
claimed, the assessable value, the quantity, the party identity, and the duty
that comes back assessed. A difference in any of those stops the cutover.

## The gate

1. **Agreement on the columns that matter, not the headline percentage.**
2. **Assessed duty agrees.** This is the strongest possible check and we already
   have the control for it: `job_clearance` compares what Customs assessed
   against the checklist figure, with a one-rupee tolerance, and sends a job
   back to scrutiny when they differ. Run the same comparison against our own
   filing. If Customs assesses our BE the same as Logi-Sys', the data is right —
   that is the proof the duty engine has never had.
3. **No ICES rejection our validator did not predict.** Phase 0 built the
   ruleset; this is where it is scored. A rejection we did not see coming means
   the ruleset has a hole, and the hole matters more than the rejection.
4. **A full month, including a month-end.** Rates change fortnightly, licences
   run down, bonds get renewed. A week proves nothing about state that moves
   slowly.

## Cutover, and back out

- Switch **one importer at a time**, not the whole book.
- Keep the Logi-Sys export path working and reachable throughout. It is a
  spreadsheet download; there is no cost to leaving it there, and it is the only
  way back if a filing goes wrong on a live consignment.
- Do not delete the handoff in the same release that stops using it.

## What stays attached afterwards

Worth being honest about, because "we left Logi-Sys" will not be quite true:

- **Charges, billing, job costing, quotations, MIS, e-Way Bill** — out of scope
  by decision, still Logi-Sys.
- **Job numbering** — jobs are still numbered `I-14225/26-27` by Logi-Sys and
  keyed in here.
- **The party master.** `/settings/organizations` is a read-only mirror of the
  Logi-Sys Organization Repository, and party names on a filing must be the
  exact strings it holds. Until that master moves, every Bill of Entry still
  depends on a Logi-Sys export.

That last one is the real remaining cord, and it is worth deciding deliberately
whether to cut it — it is a bigger piece of work than it looks, because the
names are the join key and there is no IEC or GSTIN column to fall back on.

## Done when

- A month of live jobs filed both ways, agreeing on the columns that matter.
- Assessed duty agrees on every one.
- One importer filed directly, in production, with the old path still present.
- A written decision on the party master.
