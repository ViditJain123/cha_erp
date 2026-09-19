# Leaving Logi-Sys — the phase plans

One document per phase. Each is written to be executed on its own: it states the
goal, the decisions already settled, the files to change, and what "done" means.
Pick one up, do it, tick the acceptance criteria.

**Scope.** The customs-filing path only. Logi-Sys is deliberately kept for
charges/billing, quotations, job numbering and MIS. Filing route when we get
there: **ICEGATE Open API direct**.

## Why this order

Phases 0–2 make the **current** Logi-Sys export better. They are worth doing
even if direct filing never happens, and they are where the scorecard moves
most per unit of work. Phases 3–5 build the business records we have never
kept. Phase 6 is the channel. Phase 7 is the cutover.

Nothing in phases 0–5 depends on ICEGATE registration, so none of it is blocked
on the one thing we do not control.

| Phase | Title | Depends on | Moves |
|---|---|---|---|
| [0](phase-0-correctness.md) | Correctness debts | — | a live wrong-duty bug; the safety net |
| [1](phase-1-ices-conventions.md) | ICES encoding conventions | 0 | ~175 column misses, cheaply |
| [2](phase-2-operator-data.md) | Operator data + IGM enquiry | — | ~270 warnings across 7 fields |
| [3](phase-3-esanchit.md) | eSANCHIT | 0 | SUPPORTING_DOCS off 0% |
| [4](phase-4-licence-ledger.md) | Licence ledger | 0 | LICENSE off 0% |
| [5](phase-5-bonds-warehouse.md) | Bonds, BGs, warehouses | 0 | BONDS_CERTIFICATES off 0%; 3 blocked jobs |
| [6](phase-6-filing-channel.md) | The filing channel | 0–5 | removes Logi-Sys from the loop |
| [7](phase-7-cutover.md) | Parallel run and cutover | 6 | switches the handoff off |

## The baseline every phase is measured against

Last full corpus run, 2026-09-18:

- **26 of 32** jobs export; 6 are blocked.
- Agreement against Logi-Sys' own workbooks, on the 8 jobs where we have one:
  **32.7% – 77.1%**.
- Three sheets at **0%**: SUPPORTING_DOCS, LICENSE, BONDS_CERTIFICATES.
- **1,429** total column misses, of which **175** are duty/notification columns.

Re-run it the same way every time, or the numbers are not comparable:

```bash
set -a; . .env.local; set +a
cd apps/web
./node_modules/.bin/tsx --conditions react-server scripts/corpus-export.mts
python3 scripts/corpus-compare.py
```

Read the result in `corpus-exports/comparison/SCORECARD.md`.

**One caution on the headline percentage.** A good share of the diffs are cells
*we* fill and Logi-Sys leaves blank — seal numbers, packages stuffed, gross
weight. Judge a phase by its named sheet and its warning counts, not by the
overall number.

## Before starting anything

The working tree carries ~180 uncommitted files, including whole untracked
feature areas. Commit or stash first, or no phase will have a readable diff.
