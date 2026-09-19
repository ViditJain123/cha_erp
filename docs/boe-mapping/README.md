# Bill of Entry mapping — the field contract

One document per sheet of the Logi-Sys import workbook
(`packages/exporter/templates/ImportXLSXTemplate.xlsx`), declaring for **every
column** where its value comes from and what decides it.

| Sheet | Doc | Status |
|---|---|---|
| GENERAL | [01-general.md](01-general.md) | Specified and wired |
| INBOND_EXBOND | [02-inbond-exbond.md](02-inbond-exbond.md) | Specified and wired |
| SHIPMENT | [03-shipment.md](03-shipment.md) | Specified and wired |
| CONTAINERS | [04-containers.md](04-containers.md) | Specified and wired |
| INVOICES | [05-invoices.md](05-invoices.md) | Specified and wired |
| ITEMS | [06-items.md](06-items.md) | Specified and wired |
| STATEMENT | [07-statement.md](07-statement.md) | Specified and wired |
| SEC65_EXBOND_INFO | [08-sec65-exbond-info.md](08-sec65-exbond-info.md) | Specified and wired |
| RE-IMPORT | [09-re-import.md](09-re-import.md) | Specified and wired |
| LICENSE | [10-license.md](10-license.md) | Specified |
| SW_ADDL_INFO | [11-sw-addl-info.md](11-sw-addl-info.md) | Specified and wired; `ORC` and the FSSAI answers warn rather than file |
| SW_CONSTITUENT | [12-sw-constituent.md](12-sw-constituent.md) | Specified, and deliberately not wired |
| SW_PRODUCTION | [13-sw-production.md](13-sw-production.md) | Specified and wired; three defects named and being closed |
| SW_CONTROL | [14-sw-control.md](14-sw-control.md) | Specified, and deliberately not wired |
| SEZ_INFO | [15-sez-info.md](15-sez-info.md) | Specified, and deliberately not wired |
| HSS | [16-hss.md](16-hss.md) | Specified and wired |
| BONDS_CERTIFICATES | [17-bonds-certificates.md](17-bonds-certificates.md) | Specified and wired |
| SUPPORTING_DOCS | [18-supporting-docs.md](18-supporting-docs.md) | Specified and wired; a row without an eSanchit IRN warns rather than files |
| EXCHANGE_RATE | [19-exchange-rate.md](19-exchange-rate.md) | Specified and wired |

Supporting documents:

- [masters.md](masters.md) — every master a mapped column depends on, where it
  lives, and who maintains it.
- [open-questions.md](open-questions.md) — the things a rule depends on that
  have not been settled. A column may not ship as a guess; it ships as an
  operator decision until the question here is answered.

## The rule this exists to enforce

> **No exported column may be a constant in code.**

Every column resolves through exactly one of five sources, and the source is
declared, not implied:

| Source | Meaning | Where it comes from |
|---|---|---|
| `document` | Read off a PDF the customer sent | `packages/extraction/src/extract.ts` → `merge.ts` |
| `master` | Looked up in reference or tenant master data | `packages/core/src/masters/`, Supabase master tables |
| `mail` | Stated in the customer's instruction thread | `packages/extraction/src/instructions.ts` |
| `operator` | A person decided it on the job screen | `job_boe_header`, `job_containers` tables |
| `constant` | Genuinely always the same, with the evidence recorded | the mapper, with a comment naming the vendor export that proves it |

A column with no available source does not silently become blank or a default.
It raises a `warn` (the export happens, the operator is told) or a `blocker`
(the export refuses), per `packages/exporter/src/map/context.ts`.

## Precedence

When more than one source has an opinion, later wins:

```
document  <  master  <  mail  <  operator
```

An operator's choice is never overwritten by a re-read of the documents — the
same rule `applyPartyResolution` already applies to a hand-picked party
(`matchStatus: 'manual'`).

## How a column gets added

1. Write the row in the sheet's doc: column, source, rule, failure mode.
2. Add the master or the operator field it needs. Never widen a code domain
   without adding it to `packages/core/src/masters/codes.ts` in the same change.
3. Implement it in the sheet mapper under `packages/exporter/src/map/`.
4. Add a rule test in `packages/exporter/test/`, and — where a real vendor
   export covers the case — extend the golden test that diffs our row against
   `liv_job1/JobData_*.xlsx`.
