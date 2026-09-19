# Phase 0 — Correctness debts

**Do this first, and do it whether or not we ever leave Logi-Sys.** One item
here is a live bug that misstates duty on real filings today. The other two are
the safety net every later phase leans on.

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

### Done when

- Working tree clean.
- CI green on a pull request.
- A nightly corpus run publishes the scorecard and fails loudly on regression.
