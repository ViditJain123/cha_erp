# Phase 2 — Operator data and the IGM enquiry

These are not extraction failures. They are **questions nobody has been asked**.
Logi-Sys does not know them either — a human types them there. We simply have
nowhere to put the answer.

Together they are the largest block of warnings in the corpus, and they cap
agreement near 50% no matter how good the model gets.

| Warnings | Field |
|---|---|
| 136 | `ITEMS[].End_Use` |
| 34 | `SW_PRODUCTION` (mfg / expiry / best-before) |
| 29 | `ITEMS[].Brand` |
| 26 | `GENERAL.AD_Code` |
| 26 | `GENERAL.AdvancePriorNormal` |
| 24 | `CONTAINERS.IGM Sr.No` |
| 22 / 21 | `INVOICES.Supplier_Name`, `GENERAL.Importer` |

---

## 2.1 The IGM enquiry — do this first

**One integration closes four of the seven rows above.** IGM number, IGM date,
IGM serial and Advance/Prior/Normal all come from the same place, and Logi-Sys
has a "Fetch IGM Number" button that does exactly this.

### The endpoint is already known and verified

```
foservices.icegate.gov.in/enquiry/enquiryatices/SeaIgmEnq
```

Returns IGM number, date and line from a master B/L. **Unauthenticated.**

**Use the `enquiryatices` view, not `SeaIgmEnq-public`.** The SCMTR view returns
a *different line number*, and the Bill of Entry takes the ICES one. This is the
kind of mistake that is invisible until Customs rejects the filing.

### The work

1. A client alongside `apps/web/lib/icegate-warehouse.ts`, written to the same
   rules: **never in the path of a workbook download**, cache the result, return
   nothing rather than throwing.
2. Store on the job — `job_boe_header` already carries the ICEGATE-sourced
   shipment fields (see the `shipment_icegate` migration).
3. Derive `AdvancePriorNormal` from it. The rule is already stated in
   `merge.ts`: it turns on whether an IGM has been filed against this B/L and
   whether entry inwards has been granted. Once the IGM is fetched, both are
   known.
4. `CONTAINERS.IGM Sr.No` is currently **invented as 1..n in B/L order** and
   warns. Replace with the fetched line number.

### Watch for

The host is GeoDNS-restricted to India — the same constraint that made the
warehouse enquiry unreliable. Assume it fails from a dev machine, and make the
operator path a first-class fallback rather than an error state.

---

## 2.2 Per-importer defaults

`End_Use` alone is 136 warnings — half the total. It is a property of the
importer and their trade, not of the shipment: a trading house is `GNX100`, a
manufacturer `GNX200`. Asked once per importer, it answers forever.

### The work

1. **Extend the organization record.** `organizations` already carries two
   fields that are *ours* rather than Logi-Sys' (the marine open-policy rate and
   a default end-use code) and which survive a repository re-upload. That is the
   pattern — add to it rather than inventing a parallel store.
2. **AD code.** `organization_ad_codes` exists. 26 warnings say it is not
   populated or not bound. An importer can hold several; the job needs the one
   for this filing, so this is a pick, not a lookup.
3. **Brand.** Currently defaults to `UNBRANDED` and warns. Brand belongs to the
   *product*, and `product_master` already exists and already remembers a
   classification per importer. Put it there and the warning disappears after
   the first filing of that product.
4. **Batch dates** for `SW_PRODUCTION`: manufacture, expiry, best-before. These
   are on the documents but not always extracted; where absent, they are an
   operator question on the item row.

### The principle

Every one of these is asked **once** and remembered — per importer, or per
product per importer. A field that has to be retyped every job has not been
fixed. `apps/web/lib/learn.ts` is the existing precedent for remembering an
operator's answer; note that importers are deliberately *not* learned there,
because the party master is the organization repository.

---

## 2.3 Party binding

22 and 21 warnings: the supplier and importer on the documents do not bind to a
row in the organization repository.

This one has a hard constraint. Logi-Sys resolves parties **by exact name plus
branch** — there is no IEC or GSTIN column on the sheets to fall back on. So the
string has to be the one Logi-Sys holds, not merely the correct company name.
`M/S. ELITE POLYPLUS` and `ELITE POLYPLUS` are different parties to it.

`partyNameKey()` and the `pg_trgm` fallback already exist. The gap is the
**unresolved tail**: near misses, and several branches sharing a name, which
resolve to *ambiguous* by design rather than to a guess. Those need a review
queue, not more matching cleverness — a Bill of Entry is not the place for a
coin toss.

Note this is also the one cord that stays attached after filing independence:
until the party master moves off the Logi-Sys repository export, names must keep
matching theirs.

## Done when

- IGM number, date and line are fetched, cached and on the job; `IGM Sr.No` is
  no longer invented.
- `AdvancePriorNormal` is derived, not blank.
- End use, AD code and brand are answerable once and remembered.
- Unbound parties surface in a queue instead of a warning nobody reads.
- The seven warning classes above are materially down in the corpus report.
