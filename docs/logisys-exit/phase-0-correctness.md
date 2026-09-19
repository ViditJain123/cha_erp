# Phase 0 — Correctness debts

**Done, 19 September 2026**, on branch `phase-0-correctness`. What follows is
the plan as written, annotated with what actually happened — including three
places where the plan was wrong about the world and the code went a different
way. The headline results:

- The exchange rate master is generated from 398 tables, 2012 to the fortnight
  in force, and the lookup is keyed off the date the Bill of Entry is presented.
  `liv_job1` now values at the 86.20 its filing date carried, not 96.05.
- **18 of 26 exported workbooks would pass ICES** on the rules we can check;
  the other 8 draw 2 distinct codes. That number cost nothing and needed no
  upload — which was the point.
- CI gates every push; a nightly corpus job fails on regression.

---

## 0.1 Exchange rates: a real master, keyed by the filing date

### The bug

Two faults, compounding:

1. `EXCHANGE_RATES` in `packages/core/src/masters/data.ts` is **one hand-typed
   table**, `effectiveFrom: '2026-06-01'`, eight currencies. CBIC notifies new
   rates roughly fortnightly. It has not been refreshed.
2. `packages/extraction/src/merge.ts` calls `exchangeRatesOn(today)`. The rate
   of exchange is fixed by the **date the Bill of Entry is presented** (or entry
   inwards, for a prior BE) — never by the date we happen to run the pipeline.

On `liv_job1` this filed USD at **96.05** against a correct **86.20**. That is
~11% on the assessable value of every line, straight into the duty.

> **What changed against this plan.**
>
> 1. **The master is a generated TS module, not a Supabase table.** Every other
>    master here is generated, and `exchangeRatesOn()` is called from
>    `mergeToDraft`, which is pure and synchronous — a DB-backed lookup would
>    have rippled through the merge, the exporter, the golden tests, the eval
>    harness and the offline corpus scripts for no gain.
> 2. **CBIC is not the source any more.** The notifications stop on 20 June
>    2024: from 4 July 2024 rates are published by the Exchange Rate Automation
>    Module on ICEGATE. `fetch-eram.py` pulls them from
>    `POST /cbu/icegateapi/igexratesubscribe`, which needs no key and no
>    session — the captcha on ICEGATE's page gates the form, not the service.
>    It probes daily rather than fortnightly, which caught eleven off-schedule
>    corrections a fortnightly probe would have missed.
> 3. **A fifth of the notifications are amendments** that substitute a single
>    currency row rather than a whole table. Reading one as a table loses 21 of
>    22 currencies, so they are folded onto the table in force instead.
> 4. **The BE date is not known when the draft is built.** It is keyed by an
>    operator on `job_boe_header`, long after the documents are read. So the
>    merge seeds provisionally and says so, and `applyExchangeRateResolution`
>    (in `applyJobResolution`) re-values the draft whenever the header changes.
> 5. **Five fortnights CBIC published only as image scans** cannot be read at
>    all. They are listed in `EXCHANGE_RATE_GAPS` and the lookup refuses inside
>    one, rather than answering with a neighbour's rates.

### The work

1. **Move the master out of code.** A `customs_exchange_rates` table:
   `(effective_from, effective_to, currency, rate_import, rate_export, source)`.
   Import and export rates differ and CBIC notifies both; we only need import
   today, but the notification carries both and dropping one means re-parsing
   later.
2. **Ingest the CBIC rate notification.** The corpus fetcher already reaches
   CBIC (`packages/core/scripts/fetch-corpus.py`); these are published as
   Customs (N.T.) notifications. Add a builder that parses the rate table and
   upserts by `(effective_from, currency)`. Idempotent — re-running must not
   duplicate.
3. **Key the lookup off the BE date.** Change `exchangeRatesOn(isoDate)` callers
   to pass the rate-determining date from the job, not `today`. That date is
   already modelled: `job_boe_header` carries the filing status, and
   `job_clearance.entry_inwards_date` carries entry inwards. Decide it once, in
   one helper, and let every caller read it.
4. **Refuse rather than guess.** A currency with no notified rate on that date
   is not an error to paper over — it means a **bank certificate is mandatory**
   (ICES error 155), which we already model in
   `packages/exporter/src/map/exchange-rate.ts`. Make the absence route there
   instead of falling through.

### Watch for

- The CBIC list is the **standard-currency list**. A currency's *absence* is
  meaningful, not a gap to fill. Never default a missing rate to 1 — that
  regression has happened before.
- `Unit in Rs.` — some currencies are notified per 100 units (JPY). Getting the
  unit wrong is a 100× error, which is more dangerous than a stale rate because
  it looks obviously wrong only if someone checks.

### Done when

- No exchange rate anywhere in `masters/data.ts`.
- A job filed with a BE date in the past picks the table that was in force then.
- `liv_job1` re-exports with USD at the rate its filing date actually carried.
- Re-running the ingest twice changes nothing.

---

## 0.2 The ICES rejection ruleset

### Why this is the vendor lock

Every validation rule we own was learned by uploading a workbook to Logi-Sys and
reading the ErrorList it returned. `ErrorList.htm` in the repo root is that
event — 43 errors, hand-transcribed into
`packages/exporter/test/logisys-validator.test.ts`.

**Logi-Sys' uploader is currently our validator.** Until that is replaced we
cannot file anywhere else, and we cannot know how wrong we are.

> **What the first run found.** 617 rows, not 668. And three things worth more
> than the count itself, each settled against the message format spec rather
> than against the vendor:
>
> - **`C&F` is Logi-Sys' spelling, not ICES'.** Field 42 takes `CIF CF CI FOB`.
>   We write the ampersand on six corpus jobs, which a direct filing would be
>   rejected for outright. Phase 1's problem, found here.
> - **Mode of transport is L/S/A**, not A/S. Three corpus jobs are land
>   consignments ICES accepts and their uploader refuses.
> - **`NOEXCISE` is ICES' own sentinel** for goods with no central excise
>   heading. A rule comparing it to the CTH fired on every line of all 26 jobs
>   — 136 findings, none real. Which is the argument for reporting before
>   blocking, made by the ruleset against itself on its first run.

### The work

1. **Parse the error table.**
   `data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf`
   — 13 pages, clean tabular text, 668 rows of
   `MESG_ID | ERR_CD | ERR_DESC | MODULE_ID | MESG_TYP`. It extracts cleanly with
   PyMuPDF; no OCR needed. Generate it into `packages/core/src/masters/generated/`
   like every other master, with a build script beside the others.
2. **Parse the message format for field-level rules.**
   `BE Message format 2.25 (16Feb2026).pdf` gives per-field type, length and
   mandatory/optional per BE type. That is what turns "error 116" into "this
   column, this row, this reason".
3. **Build the validator** as a pass over the mapped sheets, reusing the existing
   `warn` / `blocker` collector in `packages/exporter/src/map/context.ts`. Do not
   invent a second severity model.
4. **Report, do not block, on day one.** Run it across the 26 exporting corpus
   jobs and publish a count. That number — how many of our filings ICES would
   reject today — is the single most useful thing this phase produces, and it
   costs nothing but the parse.

### Watch for

Logi-Sys' uploader is **stricter than ICES** in places (it makes eleven
SUPPORTING_DOCS columns mandatory that ICES treats as optional). Keep the two
rule sets distinct and labelled. We must satisfy ICES to file; we must satisfy
Logi-Sys only while the handoff exists.

### Done when

- The 668 rules are generated, committed, and pinned by a test.
- A report names, per corpus job, which ICES errors our workbook would draw.
- The 43 errors in `ErrorList.htm` are all explained by the generated rules, or
  the ones that are not are recorded as vendor-only.

---

## 0.3 The safety net

### The work

1. **Commit the working tree.** ~180 modified and untracked files, including
   whole untracked feature areas. Nothing below is meaningful until this is done.
2. **CI.** There is no `.github/` and nothing is gated. A workflow running
   `pnpm -r typecheck`, `pnpm -r test`, and the RLS and claims checks.
3. **Gate the corpus run.** The dry run makes real model calls, so it cannot run
   per-commit. Run it nightly, or on demand, and fail if agreement drops or a
   previously exporting job starts blocking.

### Watch for

The golden exporter tests run off **hand-transcribed drafts**. They pin the
mapper and can never catch an extraction regression. Only
`packages/extraction/eval/run.ts` reads real PDFs. Do not mistake a green test
suite for a working pipeline — that is what the corpus run is for.

> **What changed against this plan.** The nightly corpus run **cannot use a
> GitHub-hosted runner**: the 32 folders are a real customer's shipping
> documents and live beside the repo rather than in it, and the run makes real
> model calls. `corpus-nightly.yml` asks for a self-hosted runner labelled
> `corpus` and is inert until one is registered. The gate itself,
> `apps/web/scripts/corpus-gate.mts`, runs anywhere.

### Done when

- Working tree clean.
- CI green on a pull request.
- A nightly corpus run publishes the scorecard and fails loudly on regression.

### Still needs a person

- **Repo secrets.** Both workflows are inert without `OPENAI_API_KEY`, the
  three Supabase keys, `CHECK_EMAIL`/`CHECK_PASSWORD`, `CORPUS_COMPANY_ID` and
  `CORPUS_PROFILE_ID`.
- **A self-hosted runner** labelled `corpus`, on a machine that holds the
  corpus, if the nightly run is to be nightly rather than manual.
- **The rate refresh is a script somebody runs.** `fetch-eram.py` is in
  `refresh-corpus.sh`, but the generated master is committed, so a new
  fortnight still needs a commit and a deploy. The masters screen is the
  escape hatch in between.
