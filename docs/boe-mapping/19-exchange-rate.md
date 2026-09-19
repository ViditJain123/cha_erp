# EXCHANGE_RATE

**The rate every foreign figure on the Bill of Entry is converted at.** The
sheet is ICES `<TABLE>EXCHANGE` (**BE Message format 2.25, CACHI01 Part 2/24**,
p.17 of the spec in `data/customs-corpus/icegate-specs/`).

Your dictation on the sheet (`understanding_this_sheet.xlsx`, `EXCHANGE_RATE!B7`):

> So this is also we have to take from the notifications. This is not the
> general exchange rate that we have globally. This is something which the
> customs release on the notification channel.

**One row per currency the Bill of Entry uses.** The spec: *"There shall be
number of records equivalent to the number of currencies used in the BE."* Not
one row per invoice — `ex_job5` files twelve invoices and needs two rates.

**Wired**, at `packages/exporter/src/map/exchange-rate.ts`, with one correction
this document records.

Evidence, in order of authority:

- **Twelve populated workbooks**, seven of them Logi-Sys' own. The format is
  settled beyond argument.
- `BE Message format 2.25` — the field list and the standard/non-standard split.
- `BE_fresh_filing_error_codes_24032026.pdf` — nine codes, seven of which are
  about currencies that have no row here.

---

## What the vendor writes

| File | Rows |
|---|---|
| `liv_job1/JobData_I-10793_25-26_…` | `INR 1.000000` · `USD 86.200000` |
| `ex_job20/JobData_I-14225_…` | `INR 1.000000` · `EUR 113.600000` |
| `ex_job29/JobData_I-14385_…` | `INR 1.000000` · `EUR 111.350000` · `GBP 129.400000` |
| `ex_job31/JobData_I-20271_…` | `INR 1.000000` · `USD 95.250000` |

Three conventions, in every `JobData_*` export without exception:

1. **The first row is always `INR` at `1.000000`.** The rupee declares itself at
   parity. `INR_BASE` in the mapper already does this and names the vendor
   export that proves it.
2. **Rates are text with six decimals**, not numbers. `'95.300000'`. `qty()`
   in `cell.ts` is the right constructor and is already used.
3. **`BANK_NAME`, `BANK_CERTIFICATE` and `BANK_CERTIFICATE_DATE` are blank in
   every row of every workbook.** That is not because they are always blank —
   see below.

Two older `logisys-*` exports — our own earlier output, not the vendor's — write
a **float** and omit the `INR` row. Both are wrong on both counts.

## The columns

Logi-Sys exposes five of the ICES table's fourteen fields. Fields 1–6 are
message control; three more are dropped, and their absence is the sheet's one
real subtlety.

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `CURRENCY_CODE` | 7. Currency Code, key | C(3) | derived — the invoice currencies |
| — | *(no column)* | 8. Standard Currency (Y/N) | C(1), **M** | **derived by Logi-Sys** — see below |
| — | *(no column)* | 9. Unit in Rs. | N(7,2) | Logi-Sys, from the rate |
| 2 | `EXCHANGE_RATE` | 10. Rate | N(9,4) | `master` — the CBIC notification |
| — | *(no column)* | 11. Effective Date | Date | Logi-Sys, from the notification |
| 3 | `BANK_NAME` | 12. Bank name for non-standard currency | C(35) | `document` < `operator` |
| 4 | `BANK_CERTIFICATE` | 13. Certificate Number | C(20) | `document` < `operator` |
| 5 | `BANK_CERTIFICATE_DATE` | 14. Certificate date | Date | `document` < `operator` |

**ICES wants `N(9,4)` and the vendor writes six decimals.** Both are true: the
workbook is Logi-Sys' input format and it rounds to four on the way into the
message. Write six, as the vendor does.

## The correction: the bank columns are conditional, not blank

The mapper writes all three blank unconditionally. The spec makes them
mandatory in one case, and the case is common enough to matter:

> Currencies for which the exchange rate notification is issued by Ministry of
> Finance are termed as **'Standard Currencies'** and the rest as
> **'Non-standard Currencies'** in ICES.
>
> For Non-standard Currencies, providing of — Unit in Rs, Rate, Effective Date,
> Bank Name, Certificate Number and Certificate date is **mandatory**. Date of
> Certificate should match the date of filing.
>
> For Standard Currencies, these parameters are optional.

So:

| | Standard currency | Non-standard currency |
|---|---|---|
| where the rate comes from | the CBIC fortnightly notification | **the importer's bank**, on a certificate |
| `BANK_NAME` / `BANK_CERTIFICATE` / `BANK_CERTIFICATE_DATE` | blank | **mandatory, all three** |
| certificate date | — | **must equal the BE filing date** |

**We already hold the standard-currency list and did not know it.** The master
at `packages/core/src/masters/generated/exchange-rates.ts` *is* the Ministry of
Finance notification, and it is what `exchangeRatesOn()` reads. A currency in
the table that applies is standard by construction; a currency absent from it is
non-standard. No second list is needed, and the spec's Annexure C (where
standard codes are marked `*`) is a cross-check rather than a dependency.

The master is generated, not typed: `build-exchange-rates.py` parses every CBIC
Customs (N.T.) exchange rate notification up to 20 June 2024 and merges the
ICEGATE ERAM tables that replaced them from 4 July 2024, which `fetch-eram.py`
pulls from `POST /cbu/icegateapi/igexratesubscribe` — unauthenticated, and the
captcha on ICEGATE's own page gates the form rather than the service. 398 tables
from 2012 to the fortnight in force.

Today a currency with no rate in the master is a flat **blocker**:

> No customs exchange rate on the draft for XXX. Every INR value on the Bill of
> Entry derives from it.

That is right for a currency the notification *should* cover and does not — a
stale master. It is wrong for a genuinely non-standard currency, where the
absence is the expected state and the bank certificate is the answer. The two
have to be told apart, and the thing that tells them apart is whether a bank
certificate exists on the job.

**The certificate-date rule is the sharpest edge.** *"Date of Certificate should
match the date of filing"* means a bank certificate goes stale in one day: a BE
drafted Friday and filed Monday needs Monday's certificate. That is a warning
the operator must see before the upload, not after.

## A rate is not a nicety — it is the whole valuation

Every INR figure on the Bill of Entry descends from this sheet: the assessable
value, every duty head, the IGST base. `ex_job5`'s checklist prints
*"100 JPY = 60.8000 INR, 1 USD = 96.6000 INR"* against twelve invoices; a BE
that declares one of those two values eleven invoices at the wrong rate.

Note the `100 JPY` — **some currencies are notified per hundred units**, which
is what ICES field 9, `Unit in Rs.`, exists for and what the vendor sheet has no
column for. Logi-Sys derives it. The master stores the **per-unit** figure —
`JPY: 0.6245` where ICEGATE says `62.45` and flags `units: "100.0"` — so the
arithmetic is right; but an operator reading the
workbook sees `0.641200` where the notification says `60.8000`, and that is
worth knowing before someone "fixes" it. See
[open-questions.md](open-questions.md#exchange-rate-unit).

## When a row is required

| Trigger | Result |
|---|---|
| every Bill of Entry | the `INR` parity row, always first |
| each distinct non-INR invoice currency | one row, in invoice order |
| a freight, insurance, misc or loading charge in a currency no invoice uses | **a row of its own** — ICES 220, 234, 241 each reject a charge currency with no exchange row |
| an ex-bond (`X`) Bill of Entry | **no rows at all** — ICES **662**, *Exchange Details not required for X-bond BE*; the components matrix marks `<TABLE>EXCHANGE` `X` there |
| an SEZ `M` type BE | `INR` only — spec p.17 |

**The charge-currency rule is a gap today.** The mapper takes its currencies
from `ctx.draft.invoices` alone. A freight certificate billed in EUR against a
USD invoice needs a EUR row, and ICES rejects the BE without one.

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `INVOICES.Currency` | every distinct value has a row here | ICES 209, *Exchange details missing for Invoice Currency* |
| `INVOICES` freight / insurance / misc / loading currencies | each has a row here | ICES 220 / 227 / 234 / 241 |
| `INVOICES` INR amounts | are the foreign amounts at these rates | the valuation |
| `INBOND_EXBOND` | an ex-bond BE carries no rows here | ICES 662 |
| `GENERAL` BE date | a non-standard currency's certificate date equals it | spec p.17 |

## What ICES rejects

| Code | Rejection | Bearing |
|---|---|---|
| **151** | *Currency Code invalid (in Exchange Details)* | outside Annexure C |
| **152** | *Standard Currency Flag wrong* | the flag Logi-Sys derives — if it derives it from the bank columns, a blank bank block on a non-standard currency lands here |
| **153** | *Currency is NOT a notified Currency* | a standard-currency row for a currency the notification does not cover |
| **154** | *Exchange Rate / Unit in Rs. / Effective Date should not be NULL for Non Notified …* | the non-standard rule |
| **155** | *Bank Name / Certificate Number / Date should not be NULL for Non Notified Currencies* | **the exact correction above** |
| **156** | *Exchange rates not available* | — |
| **157** | *Exchange Rates not Updated in System* | ICES' own master is stale |
| **176** | *Duplicate Record found in Exchange* | the same currency twice |
| **206 / 208 / 209** | the invoice-currency chain | the invariant above |
| **662** | *Exchange Details not required for X-bond BE* | rows on an ex-bond filing |

## Failure modes

| Condition | Severity | Why |
|---|---|---|
| a currency in the CBIC master | — | the ordinary path |
| a currency **not** in the master, **with** a bank certificate on the job | file the row with the bank block | the non-standard path |
| a currency not in the master, **no** bank certificate | **blocker** | unchanged, and correct: neither source answers |
| the bank certificate's date ≠ the BE filing date | **warn** | ICES 155's sibling rule; the operator must get a fresh certificate |
| a charge currency with no invoice in it | file a row for it | ICES 220 / 234 / 241 |
| an ex-bond BE | emit nothing | ICES 662 |

## Upstream

`invoiceMeta.exchangeRates` is `Record<string, number>`
(`extraction/src/draft.ts`). The merge seeds it **provisionally** from the day
it runs and flags it as such; `applyExchangeRateResolution`
(`apps/web/lib/exchange-rates.ts`) then re-values the draft at the rate the
filing date actually carries, and re-runs on every header change. Two things it
does not carry and this sheet needs:

1. **The bank-certificate particulars** — name, number, date — for a
   non-standard currency. A new `bank_certificate` document type, or an operator
   field; nothing extracts one today.
2. **The charge currencies.** `merge.ts` already warns *"No customs exchange
   rate seeded for XXX"* per invoice currency and does not look at the freight,
   insurance or misc currencies at all.

**Staleness is settled** (Phase 0.1). The master was a single hand-typed table
effective `2026-06-01` with no end date, and `exchangeRatesOn()` returned it for
any date without complaint — which is why `liv_job1` filed USD at 96.05 where
Logi-Sys' own workbook says 86.20, about 11% on the assessable value of every
line. Every table now carries a closed window, the lookup returns `undefined`
outside one, and the fortnights CBIC published only as image scans are listed in
`EXCHANGE_RATE_GAPS` so a date inside one is refused rather than answered with
its neighbour.

**Which date.** Section 14 fixes the rate by the date the Bill of Entry is
presented; the second proviso to section 46(3) deems a prior BE presented on the
date of entry inwards. `rateDeterminingDate()` in `packages/core/src/boe-timing.ts`
is the single place that decides, and it answers `undefined` rather than falling
back to today.
