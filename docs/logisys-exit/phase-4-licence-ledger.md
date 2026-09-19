# Phase 4 — The licence ledger

LICENSE scores **0.0%**, 96 blank cells. Unlike the other zeros this one is not
a missing integration — it is a **business record we have never kept**.

This is the phase that most deserves the word "building". Everything else on
the roadmap is plumbing or convention. This is a ledger.

---

## Start by reading this

`docs/boe-mapping/10-license.md` describes the sheet, and says it is
"implemented by `packages/exporter/src/map/license.ts`", backed by
`apps/web/lib/licences.ts` and `licences` / `licence_import_items` /
`licence_debits` tables.

**None of those files or tables exist.** The spec was dictated ahead of the
code. Treat that document as a specification to build against, not as a
description of something that is there — and correct its status line when the
work lands. `LICENSE` sits in `UNMAPPED_SHEETS` in
`packages/exporter/src/build.ts`, which is the honest state.

## Why it is a ledger, not a column

When an importer claims Advance Authorisation, EPCG, DFIA or RoDTEP, the licence
has a **balance** — in quantity and in value — and every Bill of Entry filed
against it **debits** that balance. The sheet does not ask "which licence"; it
asks "how much of it is this filing consuming, and what is left".

That means state that outlives the job, shared across jobs, per importer. No
other part of our system works this way yet.

Four corpus jobs carry live licences: `ex_job20` (RoDTEP), `ex_job25` (Advance
Authorisation), `ex_job26` (EPCG), `ex_job28` (DFIA).

## The work

1. **The schema.** Licences, their import-item lines, and a debit per BE line.
   Multi-tenant like everything else — RLS on `company_id`, and the two easy
   traps: `grant ... to service_role`, and `with check` as well as `using` on
   update policies.
2. **Registration.** A licence has to get into the system before it can be
   debited. The licence PDFs are already in the corpus folders
   (`ex_job26/EPCG-831018385.pdf`), so extraction is plausible — but a licence
   is a legal instrument with a balance, and getting it wrong corrupts every
   later filing against it. **Extract to propose, have a human confirm.**
3. **Opening balance.** A licence bought part-used does not start at its face
   value. This is an open question in `docs/boe-mapping/open-questions.md` and
   needs an operator answer, not a default.
4. **The debit calculation.** `computeDutyForegone()` already exists and already
   prices `LICENSE.DebitDeutyValue`, pinned to the paisa against vendor exports
   in `packages/core/test/duty-foregone.test.ts`: 27.73% for AA/EPCG, 8.25% for
   DFIA, 5.00% for RoDTEP. **The arithmetic is done.** What is missing is
   somewhere to write the answer and something to subtract it from.
5. **The mapper.** `packages/exporter/src/map/license.ts`, and move `LICENSE`
   from `UNMAPPED_SHEETS` to `MAPPED_SHEETS` in `build.ts`.

## Open questions to settle before filing, not before starting

These are all recorded in `docs/boe-mapping/open-questions.md`. Several want an
answer from Sandesh. Build the ledger; leave these as operator decisions until
answered:

- What `License_RefNo` actually is.
- The quantity when one line is split across two licences.
- Whether AIDC and compensation cess belong in the debited duty.
- A scheme claim on a warehousing Bill of Entry.
- Row granularity on upload.
- `ITEMS.Addl_Duty_Flag` and the DEPB table.

## Watch for

The checklist prints a **different item serial** from the one the sheet carries.
Do not reconcile them by changing the data; they are different numbering
schemes.

## Done when

- A licence can be registered, carries a balance, and shows its history.
- Filing a BE against it debits it, and the debit is visible on both sides.
- LICENSE is off 0% on all four scheme jobs in the corpus.
- `docs/boe-mapping/10-license.md` describes something that exists.
- A licence with insufficient balance **blocks** the export rather than
  over-drawing — same refuse-rather-than-guess rule as every other mapper.
