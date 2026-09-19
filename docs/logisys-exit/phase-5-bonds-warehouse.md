# Phase 5 — Bonds, bank guarantees and warehouses

Two related gaps, both about state that lives outside any one job.

- **BONDS_CERTIFICATES scores 0.0%.** The mapper exists and emits nothing.
- **Missing warehouse data blocks 3 of the 6 jobs that cannot export at all** —
  `ex_job17`, `ex_job19`, `ex_job23`.

---

## 5.1 The bond and BG register

### What is missing

`job_bonds_certificates` exists and `packages/exporter/src/map/bonds-certificates.ts`
is written, but nothing populates it on the scored jobs. The deeper problem:
**bond state is invisible to us.** A continuity bond has a running balance the
same way a licence does, and we do not hold it.

### What is already settled

- The sheet is **two ICES tables in one**, discriminated by a `B` / `C` column:
  bonds and certificates.
- **IGCR needs one of each** — a bond *and* a certificate — not one or the
  other.
- Bond type codes and certificate type codes live in
  `packages/core/src/masters/codes.ts`, read from the ICES `<TABLE>BOND` and
  `<TABLE>CERT` domains.

### Open, and worth asking Sandesh before building deep

- EPCG filed under bond code `EZ` — confirm.
- What certificate type `MS` is.

### The work

1. A register per importer: bonds, their type, amount, and what is outstanding
   against them.
2. Feed `job_bonds_certificates` from it rather than from nothing.
3. Note the overlap with `importer_line_securities` — that table already holds a
   yearly bond or standing deposit **per importer per shipping line**, for
   container deposits on the delivery-order side. It is matched on
   `jobs.importer_name` plus aliases rather than on an organization id, which
   means a misspelled importer looks exactly like a genuinely uncovered job.
   Decide deliberately whether the customs bond register is the same thing
   extended or a separate ledger. They answer different questions and probably
   should stay separate, but say so on purpose.

---

## 5.2 The bonded-warehouse master

### Why three jobs cannot export

An into-bond or ex-bond Bill of Entry names the bonded warehouse it concerns,
and Customs releases nothing against a code that is not one. We block rather
than guess, which is correct — but it means those jobs produce no file at all.

`ex_job23` additionally lacks the into-bond BE date and the quantity released.

### What we know

- The **code decodes offline**: port (4) + type + serial. So its *structure* can
  be validated without any network call. `packages/core/src/masters/warehouse-code.ts`
  does this.
- The **name, address, city and PIN cannot** be derived — they come from
  ICEGATE's enquiry or from a person.
- `apps/web/lib/icegate-warehouse.ts` guesses between two candidate URL shapes
  because the real request could not be observed from outside India, and the
  host is GeoDNS-locked. It has never been verified.
- `bonded_warehouses` exists as the cache.

### The work

1. **Settle the endpoint or abandon it.** Someone in India runs the enquiry once
   with the browser network tab open, and we either have the real request or we
   stop pretending. Do not leave a guessed URL in the code indefinitely — it
   fails silently and looks like a data problem.
2. **Make operator entry first-class either way.** A warehouse is entered once
   and reused forever; `/settings/warehouses` already exists. The bar is that a
   job must never block on a warehouse someone could have typed in a minute.
3. **Ex-bond quantities.** `ex_job23` blocks partly on the package count and
   gross weight released. Warehoused goods leave in whole packages, and ICES
   owns the ledger of what remains — we declare what this filing releases, not
   what is left. Model it that way.

### Open questions

Recorded in `open-questions.md`: the warehouse type letters, the code's length,
and ex-bond item serials (`Inbond_InvSrNo` / `Inbond_ItemSrNo` are currently
hard-zeroed and nothing reads them).

## Done when

- BONDS_CERTIFICATES is off 0%, and IGCR jobs file one bond and one certificate.
- A bond's outstanding state is visible before a job leans on it.
- `ex_job17`, `ex_job19` and `ex_job23` export.
- Every warehouse we have ever filed against is in the master, however it got
  there.
