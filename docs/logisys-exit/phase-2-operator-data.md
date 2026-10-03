# Phase 2 — Operator data and the IGM enquiry

**In progress.** The plan this file used to hold said these seven warning
classes were *questions nobody has been asked* — operator data with nowhere to
put it. Four of its premises did not survive the data. What follows is what is
true, what has been done, and what is left.

The headline so far, measured by replaying every stored draft through the
mappers with no model calls:

- **423 warnings → 325**, of which **−118 is this phase** and **+20 is Phase 1's**
  refused screen defaults showing up against a pre-Phase-1 baseline.
- **`SW_PRODUCTION` 34 → 2**, and both survivors are genuinely FSSAI lines.
- **`ITEMS[].Brand` 29 → 0.**
- **`INVOICES.Supplier_Name` 22 → 5**, `GENERAL.Importer` 21 → 17.
- **`CONTAINERS.IGM Sr.No` 24 → 0** and **`CONTAINERS.Container No` 7 → 1.**
- **Eight containers that do not exist are no longer declared to Customs.**
  Every job with a vendor workbook now declares exactly the vendor's set.
- **24 of the corpus's 44 party names now bind `exact`**, 17 ambiguous, 2 with
  no match — measured by `scripts/party-bind-report.mts`.

---

## What the evidence changed

### 1. The party warnings are a botched import, not a matching problem

`organization_imports` holds **three rows, same file, same sha256, six seconds
apart** — the upload was fired three times. The route upserted in chunks of
1,000 and then retired everything not stamped with *this* import id, so the runs
retired each other's freshly stamped rows: `retired_count` 3000 / 1000 / 0.

**3,000 of 5,091 organizations carry `is_active = false` while their own
`raw["Is Active"]` says `"True"`.** Both resolution paths skip them —
`parties.ts` (`.eq('is_active', true)`) and the `search_organizations` RPC.

All 30 distinct unbound names, diagnosed:

- **19 are blocked purely by `is_active = false`.** Thirteen are single-branch
  and would bind `exact` **with no code change at all** — ELITE POLYPLUS,
  CELLMARK AB, BENNI FOODS, Borouge, MLM INDIA, MLM INFRA, A ONE CHEM TRADE,
  JSC Segezha, HEALTH EXPERT KFT, ALLY HYDROGEN, INNER MONGOLIA YONGHE, FUCHS
  LUBRICANTS GERMANY, FUCHS LUBRICANTS SUZHOU.
- **5 are genuinely `ambiguous`** — RAJSHREE POLYPACK (14 branches), SIGMA
  CHEMTRADE (8, on two jobs), TUFROPES (4), ZHEJIANG GUXIANDAO (2).
- **2 have no match**: `GUJARAT FLUOROCHEMICALS LIMITED(EOU)` — the `(EOU)` is
  an establishment marker and the repository holds branches `EOU MOVERS` and
  `EOU VAGRA MAIN` — and `Heat Trace Limited`, genuinely absent, which has to be
  added in Logi-Sys and re-uploaded.

Ambiguity is structural, not a tail: **479 of 3,790 distinct `name_key`s have
more than one branch**, and branch names are often meaningless (`'0'`, `'1'`, …
`'13'`). `city` is the real discriminator.

### 2. Every store this phase depends on is empty

| store | rows |
|---|---|
| `organizations.default_end_use_code` | **0 set** → 136 `End_Use` warnings |
| `organization_ad_codes` | **0**, and *no writer exists anywhere* → 26 `AD_Code` warnings |
| `product_master` | **0** |
| `job_boe_header.igm_no` | **0** → 26 `AdvancePriorNormal` warnings |

The code for all of this exists and works. `filingStatusFrom()` already derives
Advance/Prior/Normal; `be-header-panel.tsx` already has the IGM form; the
end-use default already flows through `items-resolve.ts`; the AD-code picker
already renders from `adCodeChoices`. **`AdvancePriorNormal` closes on data
entry alone.**

### 3. The branch pick does *not* supply the AD code

Worth stating plainly, because it is the obvious assumption and it is wrong.
Only **two of seven** filed AD codes sit on the row whose branch Logi-Sys filed:

| job | filed branch | filed AD code | where the repository holds it |
|---|---|---|---|
| ex_job20/21 | `AMBERNATH` | `6550001` | on FUCHS' **KARNATAKA** row |
| ex_job25 | `DAMAN & DIU` | `0510146` | **no RAJSHREE row holds any AD code** |
| ex_job26 | `33` | `0510007` | **no GUJARAT AMBUJA row holds any** |
| ex_job28 | `Mumbai` | `0023340` | on SIGMA's Mumbai row ✓ |
| ex_job29 | `Dahej` | `0180027` | on branch `1` |
| ex_job6 | — | `0510226` | the row holds `0410002`, a *different* code |
| liv_job1 | `0` | `0510007` | on A-ONE's only row ✓ |

In Logi-Sys the branch and the AD code are independent selections, and only
**188 of 4,010** consignee rows carry an `ad_code` at all. So
`organization_ad_codes` is load-bearing rather than a convenience, and
`job_boe_header.ad_code` must stay a free string: a foreign key would make
RAJSHREE's actual filing impossible to record.

### 4. `CONTAINERS.IGM Sr.No` is a row serial, and our container list was wrong

All seven vendor exports that fill the column write exactly `1..n`, contiguous —
never an IGM line number with a gap. The consignment's IGM line is
`SHIPMENT.LineNo`, one per B/L, so the enquiry has nothing to say here.

The real defect was underneath. Seven jobs declared the wrong number of
containers, and **six were ISO 6346 check-digit failures, the count matching the
over-declaration in every one**. On `ex_job26`, `TEIU5715694` and `TETU5715694`
are misreadings of `UETU5715694`; the real one passes its check digit and both
phantoms fail. We were declaring boxes to Customs that do not exist.

### 5. The IGM enquiry does close four columns — but not `LineNo`

The vendor fills `IGM_No` and `IGM_Date` on three of eight jobs and
`Gateway_IGM_No` on a fourth, alongside `AdvancePriorNormal` on all of them. It
leaves `SHIPMENT.LineNo` blank everywhere.

---

## Done

### `SW_PRODUCTION` is scoped by the agency — 34 → 2

`sw-production.ts` emitted for any line carrying a batch number, which is most
of them. All 34 warnings were on chapters with no participating agency: 39, 34,
29, 27. Logi-Sys agrees — its own export ships this sheet empty on all eight
comparable jobs, including the five carrying batch numbers. The mapper now uses
`singleWindowRuleForChapter()`, the gate `statement.ts` and `single-window.ts`
already used. The two survivors are `ex_job2` and `ex_job3`, both FSSAI.

### `Brand` says nothing — 29 → 0

Logi-Sys writes `UNBRANDED` on **every one of the 11 item rows across all eight
workbooks**, six importers, chapters 27/29/34/39/84. It is the convention, not a
guess to apologise for. Both the export warning and the job-screen flag are
gone; the Brand field on the item row stays.

### Containers: a misread number is not declared — `Container No` 7 → 1

`applyContainerResolution` now drops a document-derived number that fails its
ISO 6346 check digit, names each one, and says so explicitly when dropping them
makes the count agree with the B/L. An operator's own list is untouched.

Every job with a vendor workbook now declares **exactly** the vendor's set of
containers, `ex_job26` included (7 → 5). `ex_job29` (8 stated, 1 declared) is a
separate under-reading and stays open.

The `IGM Sr.No` warning is re-scoped to fire only when the list is in doubt:
24 → 0.

### `bestBeforeDate` is extractable at last

Neither `InvoiceDocSchema` nor `CoaProductSchema` had the field, so the
all-three-dates rule could never be satisfied and every batch on a regulated
line was dropped. Both schemas now carry it, both prompts name it and say it is
distinct from the expiry, and `merge.ts` carries it through both the single-lot
and multi-lot paths. Five tests in `packages/extraction/test/batches-merge.test.ts`.

### The repository import cannot eat itself again

- `supabase/migrations/20260919000001_organization_import_status.sql` — a
  `status` enum, an `error` column, and `organization_imports_one_running`, a
  partial unique index giving one in-flight import per company. **Applied to the
  remote project.**
- The apply logic moved to `apps/web/lib/org-import.ts` so the route and a
  script are the same code. The retire sweep is now scoped **by time**
  (`updated_at < importRow.created_at`) rather than by import id: a concurrent
  run converges on the file instead of colliding with it, because the other
  run's upsert brings back anything wrongly retired. A stale `running` row is
  reaped after 15 minutes. The `inserted` count is counted, not inferred from a
  before/after row count.
- `apps/web/scripts/org-import.mts` loads a file from the command line.

**The repair is applied.** `OrganizationRepository_78_20260811_194754.xlsx` was
re-imported through the fixed path on 19 September 2026: `row_count 5091`,
`retired 0`, and the active count went **2,091 → 5,091**. Thirteen names that had
never bound now bind `exact` with no further work.

### Binding a party no longer erases what the documents said

Found by the import: `supplierFrom` and `importerFrom` built a fresh party out
of the repository row, so binding a supplier dropped the city the invoice
printed, and the export then warned that the city *"was not extracted"* — untrue
of the documents and true only of us. Eleven suppliers across the corpus.

The repository's spelling still wins, because Logi-Sys keys its parties on it;
it just no longer speaks for fields it does not hold. `applyPartyResolution` and
`setJobParty` both spread the bound row over the extracted one. The two pure
rewrites moved to `apps/web/lib/party-binding.ts` — no `server-only`, the same
reason `lib/do.ts` has none — and `test/party-binding.test.ts` pins the property
the merge rests on: they omit an absent field rather than naming it `undefined`.

### `apps/web/scripts/party-bind-report.mts`

Every party name in the corpus through `resolveParty`, with its status and its
candidate branches. No model calls, no workbook. This is the acceptance test for
the import and for the branch pick.

### `apps/web/scripts/corpus-replay.mts`

Phase 1's measurement technique, made repeatable: re-resolve each stored draft
and rebuild its workbook with no model calls, and diff the warnings against the
last full run's `report.json`. It cannot catch an extraction regression and it
is exactly right for a mapper change.

---

### The branch pick is remembered

`party_bindings`, keyed `(company_id, role, name_key)`
(`20260919000002_party_bindings.sql`). `resolveParty` consults it before the
exact lookup and answers `remembered`.

Deliberately **not** `manual`. The two have to behave differently on a re-read:
`manual` short-circuits resolution, which is right for "someone fixed this job"
and wrong for "someone answered this name once" — a remembered binding must run
through resolution so a later repository upload or correction takes effect
instead of being frozen into an old draft. A binding whose row has since been
retired or lost its role flag is **ignored and warned about**, so a stale
decision cannot resurrect a party Logi-Sys switched off.

Looked up on the exact `name_key`, never by trigram. That exactness is the whole
guard, and `packages/core/test/party-name.test.ts` pins both directions of it:
one decision covers `SIGMA CHEMTRADE PVT. LTD` and
`SIGMA CHEMTRADE PRIVATE LIMITED`, and does not cover
`SIGMA CHEMTRADE INTERNATIONAL`.

`applyPartyResolution` used to **discard** `PartyMatch.candidates`, so the panel
had nothing to show and sent the operator back to a search box to find a list
the app had already built. The branches are now on the draft with city, AD code
and IEC — city is what tells RAJSHREE's branch `'7'` from branch `'11'` — and
the panel lists them, with a "remember this" checkbox defaulted on for an
ambiguous name and off for a name with no match at all (a name that matches
nothing is more often a one-off misreading, and teaching the system a
misreading is worse than being asked twice).

**Settings → Organizations → Remembered parties** lists and forgets them. That
half is not optional: a binding answers a question nobody will be asked again,
so a wrong one is invisible and wrong on every job after it.

Proved end to end against the live repository: `SIGMA CHEMTRADE PVT. LTD`
resolves `ambiguous` → bind Mumbai → `remembered` → `SIGMA CHEMTRADE PRIVATE
LIMITED [Mumbai] AD 0023340`, which is exactly what Logi-Sys filed on ex_job28;
the other spelling inherits it, `TUFROPES` does not, and removing the binding
restores `ambiguous`.

### `organization_ad_codes` has a writer

It had a table, a partial unique index for the default, and a reader on the BE
header from the day that header was built — and no way at all to put a row in
it. Three actions beside `updateOrganizationDefaults`, and an AD codes block in
the Defaults drawer that already existed for "what Logi-Sys does not hold about
this party".

Codes are kept as **text** and never parsed as numbers: `0023340` as a number is
`23340`, a different bank branch, and the BE would be filed against it.

---

## Left to do

1. **Enter the per-importer end use.** Trading (`GNX100`) or manufacture
   (`GNX200`) is the importer's business and not derivable; about 13 importers
   in the corpus. Must come *after* items 1–2, because the default lives on the
   specific branch row the binding picks.
2. **The ICEGATE sea-IGM client.** `foservices.icegate.gov.in` is GeoDNS-
   restricted to India and cannot be exercised from a dev machine, so: unit-test
   the parser against a captured payload, inject the host rather than hardcoding
   it, keep the operator form primary, and treat a silent `undefined` as normal.
   **A successful empty response must not set `igm_checked`** — "ICEGATE did not
   answer" and "no IGM exists" are opposite inputs to `filingStatusFrom()`.
3. **ICES error 203**, blank `Invoice_Date` on ex_job4 and ex_job10, handed here
   by Phase 1. Extraction found no date and there is no operator field for one.

## Measuring it

```bash
set -a; . .env.local; set +a
cd apps/web
./node_modules/.bin/tsx --conditions react-server scripts/corpus-replay.mts   # no model calls
```

The full run, and the caution that goes with it:

```bash
./node_modules/.bin/tsx --conditions react-server scripts/corpus-export.mts
python3 scripts/corpus-compare.py
./node_modules/.bin/tsx --conditions react-server scripts/ices-report.mts
./node_modules/.bin/tsx --conditions react-server scripts/corpus-gate.mts
```

`corpus-export.mts`'s simulated operator answers **blockers only**, and
deliberately only three of them, so the end-use and AD-code
items above prove nothing until the rows exist in the database. And `Import CheckList-*.pdf`, `Processed BE_*.pdf`
and `JobData_*.xlsx` are answer keys: **the IGM number, IGM date and entry-inwards
date are printed on the checklist, and reading them to seed `job_boe_header`
would make the IGM client's verification circular and the agreement number worthless.**

**The baseline still needs refreshing for Phase 1's reason** — the `ADD_Basis`
cell liv_job1 no longer writes. Refresh with `--update` and say why in the
commit message.
