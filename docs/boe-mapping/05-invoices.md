# INVOICES

One row **per invoice**. What was bought, from whom, on what terms, and every
charge that is added to or taken off the price before duty is worked out.

Implemented by `packages/exporter/src/map/invoices.ts`, fed by the
`// ---- Invoices & valuation ----` block of `packages/extraction/src/merge.ts`,
by `apps/web/lib/parties.ts` (`applyPartyResolution` → `applySupplierRelationship`,
`applyImporterDefaults`) and by the `supplier_relationships` table.

Column list, code domains and every `constant` below are taken from the
vendor's own files — `liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx`,
`final (1).xlsx`, `logisys-ce9c889d-…xlsx`, `logisys-dbf3530c-…xlsx`,
`ex_job6/logisys-EP061126-1-20260630.xlsx` — from the seven checklists Logi-Sys
printed for `ex_job1..7`, from the customer's annotated
`understanding_this_sheet.xlsx` (including three photographs of the dropdowns
open), and from the ICES specification the sheet is a rendering of:
`BE Message format 2.25`, Part 4 (Invoice) and Part 5 (Miscellaneous Charges),
in `checklist-app/data/customs-corpus/icegate-specs/`.

## Why this sheet needed dictating

Two things, and the second is worse than the first.

**The sheet declared one invoice whatever the documents said.** `InvSrNo` was
the literal `1` and the draft held a single invoice. `ex_job5` is twelve
invoices in one PDF at two exchange rates — its checklist says
*"Invoice 1 / 12"* — and eleven of them were discarded silently, along with
ninety-odd item lines. Nothing downstream could tell: one row and twelve rows
look equally plausible in a finished workbook.

**The workbook and our own duty figure disagreed about the assessable value.**
`computeValuation` in `packages/core/src/duty.ts` adds `miscCharges` to the
assessable value. `invoices.ts` wrote `Misc_Charge_Amount` as a hardcoded
`0.00`, with a comment saying so deliberately. So on `ex_job1` — whose invoice
bills a `FREIGHT-CHARGE` line of $590.75, and whose checklist files
*"Invoice Value 15283.84 USD, Misc. Charges 590.75 USD"* — the duty was computed
on one number and the number declared to Customs was another.

Beyond those: 21 of the 40 columns the mapper wrote were constants in code, 57
columns were never written at all, and the whole related-party block was the
constant `N` — a declaration to Customs that was not ours to make, on a job
(`ex_job1`) whose checklist prints *"Related Yes / Under SVB Yes"*.

---

## 1. `InvSrNo`, and the shape of the sheet

**Source:** `derived` — 1..N, in the order the documents print the invoices.

`ITEMS.InvSrNo` points back at it, and `ITEMS.ItemSrNo` restarts at 1 within
each invoice, which is what ICES field 8 ("Item Sr. no. in Invoice") asks for.
`STATEMENT` follows the same pair.

The draft carries `invoices: DraftInvoice[]` and a **flat** `items: DraftItem[]`
where each item names its `invoiceSrNo` — the same shape as the two sheets.
Duty is computed per invoice and summed by `computeBeDuty`, because each invoice
has its own currency, terms and charges; `EXCHANGE_RATE` then lists one row per
currency actually invoiced in.

**Failure mode.** No invoice at all is a **blocker**: a Bill of Entry declares
goods against an invoice, and there is nothing to declare without one.

---

## 2. `Invoice_No`, `Invoice_Date`, `Inv_Currency`, `Product_Value`

**Source:** `document` — the invoice.

`Product_Value` is the **goods** total, not the invoice total. Lines the
extractor marks `isCharge` are taken out of it and land in
[§5](#5-misc_charge_--misc_charge_amount--misc_charge_currency); `ex_job1` files
15,283.84 against an invoice that totals 15,874.59.

Two pages quoting the same invoice number are one invoice — a continuation
sheet, a duplicate copy, the invoice reprinted beside its packing list — and are
merged on the number in `merge.ts` rather than emitted twice.

---

## 3. `TOI` and `TOI_Place`

**Source:** `document`, through `TOI_CODE`.

ICES accepts four codes and no others (`BE Message format 2.25`: *"Terms of
invoice — CIF CF CI FOB"*), and each says which additions are already inside the
price. **This is the gate for the whole charge block:**

| `TOI` | Freight in the price? | Insurance in the price? |
|---|---|---|
| `CIF` | yes | yes |
| `C&F` | yes | **no — `Ins` activates** |
| `C&I` | **no — `Frt` activates** | yes |
| `FOB` | **no** | **no** |

C&F and CFR are the same Incoterm; CIF is not. Keying this by hand once turned a
cost-and-freight invoice into cost-insurance-freight, which would have folded a
non-existent insurance cost into the assessable value.

**Failure mode.** A term with no Logi-Sys equivalent — Ex-Works, CPT, DAP — is a
**blocker**. Terms of invoice decides which charges are already in the price, so
it cannot be rounded to the nearest one. (`merge.ts` rewrites EXW to FOB, or to
C&F when the invoice itself bills the freight, long before this point; the
blocker is the safety net.)

`TOI_Place` is ICES field 76, the place named after the Incoterm — "CIF NHAVA
SHEVA" names Nhava Sheva. Parsed off `deliveryTermsRaw` and written when the
invoice states one. **It never warns**: every vendor workbook leaves it empty,
including ones whose invoice names a place, so a blank here is not a gap.

---

## 4. `Is_Single_Frt_Ins_Other_Chrg`

**Source:** `derived` — `Y` on one invoice, `N` on more than one.

The box means the freight/insurance/other block is a single figure for the whole
Bill of Entry rather than keyed per invoice, which it can only be when there is
one invoice. The customer's rule is *"if multiple then N, else Y"*; the
single-invoice vendor workbooks (`liv_job1`, `final (1).xlsx`) say `Y`. This was
hardcoded `N`, then hardcoded `Y`; it is now the invoice count.

---

## 5. `Frt_%` / `Frt_Amount` / `Frt_Currency`

**Source:** `document` — the freight certificate. Nil when `TOI` already
contains freight.

Either a rate or an amount, never both — the customer's *"either of this two"* —
because they are the same claim and Logi-Sys takes one column or the other. The
currency is usually foreign.

**Failure mode.** Freight is due and no certificate states it: **warn**, and
leave the nil. It is deliberately **not** filled with a notional percentage. The
20% of Rule 10(2) of the Customs Valuation Rules is a fallback for an officer
who cannot ascertain the actual freight, not a figure a declarant may state as
the actual. The warning names the certificate as the fix.

---

## 6. `Ins_%` / `Ins_Amount` / `Ins_Currency`

**Source:** `document` — the insurance certificate; else `master` — the
importer's `marine_open_policy_rate_percent`. Nil when `TOI` already contains
insurance.

An actual premium goes in the amount; an open policy goes in the rate, and
Logi-Sys computes the rupee figure itself. `ex_job6` files `Ins_% 1.1250` with
`Ins_Amount 0.00`, and its checklist prints *"204144.55 INR (1.125%)"* — 1.125%
of the C&F value converted at 96.05.

A premium is usually in **rupees** even on a dollar invoice, because the policy
is Indian. A rate leaves the currency at the invoice's, which is what the vendor
workbooks write beside a zero.

> The certificate's **sum insured** is not the premium and is never declared.
> They differ by three orders of magnitude, and the extraction prompt says so in
> those words.

**Failure mode.** Insurance is due and there is neither a certificate nor a
policy rate: **warn**, naming both fixes.

### The sum insured is checked, not declared

`checkSumInsured` in `apps/web/lib/parties.ts` totals the declared value of
every invoice in rupees and compares it against the importer's
`marine_policy_per_sending_limit_inr`. Over the limit raises an **`error`
flag** naming the shortfall, so the customer can be told before the BE is filed.

It is a flag, not a blocker: over-shipping against a policy is a commercial
problem, not a misdeclaration. The Bill of Entry is correct; the cover is not,
and refusing the export would not fix the cover.

---

## 7. `Misc_Charge_%` / `Misc_Charge_Amount` / `Misc_Charge_Currency`

**Source:** `document` — the invoice and the freight certificate.

**The rate is always `0.0000`; the amount is the actual.** That is the
customer's rule verbatim, and the distinction matters: an older note in this
repo recorded "misc charges always 0" and was wrong about the amount.

What lands here:

1. Every line on the invoice that is not for goods — packing, dismantling,
   handling, documentation, and a freight line billed on an invoice whose terms
   already include freight. `ex_job1` is the golden: a `FREIGHT-CHARGE` line of
   $590.75 out of the invoice value and into this column.
2. The ex-works leg and any other charge a freight certificate states
   separately from the freight itself.

Charges in another currency are converted into the **invoice** currency before
they are added — ICES takes this column in it (`MISC_CH`, Part 5) — at the
customs rates for the filing date. A conversion with no rate available is not
guessed: it warns and stays out of the total.

The currency cell is the invoice's when there is an amount and **empty** at
zero, which is the shape the vendor's own export writes.

> The fourteen `A -` … `N -` head columns (BJ–CK) are the ICES `MISC_CH` code
> list — A brokerage, B containers, C packing, D handling, E goods and services,
> F documentation, G COO certificate, H royalties, I proceeds accruing, J
> warranty, K other cost, L other charges — plus two Logi-Sys additions, M
> loading and N unloading. **They stay blank.** The aggregate is what every
> vendor workbook and every checklist carries, and no evidence exists that
> Logi-Sys accepts the breakdown and the total together.

---

## 8. `Discount_%` / `Discount_Amount` / `Discount_Currency`

**Source:** `document` — as the invoice prints it, in the invoice's currency.
Nil otherwise.

---

## 9. `HSS_%` / `HSS_Amount`

**Source:** `operator` — only on a job flagged `GENERAL.IsHSS`.

A high seas sale must load the import value by at least 2% (CBEC's 2004
practice). The rule is a fork on the difference between the two prices:

| Difference | Declared |
|---|---|
| ≤ 2% of the import value | `HSS_%` = `2.0000`, amount nil |
| > 2% | `HSS_Amount` = the actual difference, rate nil |

**Failure modes.** Flagged as a high seas sale with no HSS price recorded:
**warn**. An HSS price *below* the import price: **blocker** — a high seas sale
cannot be at a loss on the declaration, so one of the two figures is wrong.

---

## 10. `Agency_*` and `Loading_*`

**Source:** `constant` — `0.0000 / 0.00 / INR`, and they never warn.

Agency is the buying commission of Rule 10(1)(a)(i); loading is a value loading.
Both are nil on all five vendor workbooks and all seven checklists, and both are
Indian services, which is why Logi-Sys names rupees beside the zero. An
unfillable column that is *meant* to be nil is not a gap.

---

## 11. The related-party block: `Is_Related`, `Relation`, `Base`, `Condition`, `RD_%`, `RD_Basis`

**Source:** `master` — `supplier_relationships`, keyed on the **importer–supplier
pair**.

An SVB order covers one importer buying from one supplier. The same overseas
seller can be a related party to one of this CHA's importers and at arm's length
from another, so the record cannot hang off the supplier's own row.

| Column | Rule |
|---|---|
| `Is_Related` | the recorded answer; `N` when there is a record saying so |
| `Relation` | the literal `YES` when related, **blank** when not |
| `Base` | how they are related — shareholding, common control, sole agency |
| `Condition` | a condition the relationship puts on the price |
| `RD_%` | the revenue deposit, **enabled only when related**, else `0.00` |
| `RD_Basis` | `A` — on the assessable value. Constant; the vendor writes it beside a nil deposit |

`Base` and `Condition` qualify a relationship and are blank without one — the
same gate the customer puts on `Relation` and `RD_%`, and a database constraint
enforces it (`related_party_details_need_a_relationship`).

A revenue deposit is rare, arrives by customer instruction rather than off any
document, and is typically 1% or 5%.

**Failure mode.** A pair declared related with no SVB reference on record:
**warn**. A related-party import is normally registered with the Special
Valuation Branch, and the absence is worth a question rather than a silence.

---

## 12. The SVB order: `SVB_Ref_No`, `SVB_Date`, `Custom_House_Code`, `SVB_Loading_Basis`, `SVB_Rate_*`, `SVB_Status_*`

**Source:** `master` — the same row.

`SVB_Loading_Basis` is `A` when the load applies to the assessable value, blank
otherwise. The two statuses are `F` final or `P` provisional. The two rates are
written at 5dp, which is the precision the column takes.

> **`Custom_House_Code` is the custom house that imposed the load** — not the
> station this Bill of Entry is filed at, which is `GENERAL.CustomsHouseCode`.
> It is blank on every job with no SVB order, Logi-Sys' own export leaves it
> empty, and filling it with the filing station is a mistake this codebase has
> made before. `packages/exporter/test/invoices.test.ts` asserts both halves.

---

## 13. `PO_No` / `PO_Date` / `Contract.No` / `Contract_Date`

**Source:** `document` — the invoice's own quotation of them, else a purchase
order or contract on the job.

"If given". Blank **without a warning** when the documents quote neither: most
invoices do not, and warning every time would teach operators to skim the list.

---

## 14. `Terms_of_Payment` / `Other_Terms_of_Payment_Remark` / `LC_No` / `LC_Date`

**Source:** `document`, through `termsOfPayment()`.

Six codes, photographed open on the customer's workbook: **LC, FOC, DP, DA, SD,
OTHERS**. (ICES itself carries fewer — `DP/DA`, `FoC`, `LC`, `OTH` — and
Logi-Sys splits DP from DA and adds SD.) Invoices write prose, so the mapping
reads the instrument out of it:

| The invoice says | Filed |
|---|---|
| "D/A 45 days from B/L Date" | `DA` |
| "Irrevocable L/C at sight" | `LC` |
| "CAD", "cash against documents" | `DP` |
| free of cost / no commercial value | `FOC` |
| "100% advance TT", "NET 30", anything naming no instrument | `OTHERS` |

The remark is `OTHERS` beside an `OTHERS` code — Logi-Sys' own export writes the
word in both columns and prints them *"OTHERS (OTHERS)"* — and **blank beside
every other code**. The remark exists to qualify OTHERS; next to `DA` it would
be qualifying a term that already says the thing.

`LC_No` and `LC_Date` are written **only** beside `LC` terms. An LC number
against D/A terms is a statement that the goods were paid for a way they were
not. An LC term with no number warns.

> Three goldens print `OTHERS (OTHERS)`, `ex_job2` among them — whose invoice
> says D/A 45 days. Under this rule that job would now file `DA`. That is the
> customer's decision, taken deliberately: the code is on the document, and the
> operator's `OTHERS` was the old export's limitation rather than a reading of
> the invoice.

---

## 15. `Nature_of_Trans`

**Source:** `document` — the model classifies it into the nine dropdown labels.

Sale · Sale on Consignment basis · Hire · Rent · Gift · Sample · Free of cost ·
Replacement · Others. ICES codes these `S|C|H|F|O|R|P|G|M`; Logi-Sys takes the
label and codes it itself.

`Sale` is the default and is right on every golden but two: `ex_job3` and
`ex_job4` are free-of-cost re-imports and were filed `Free of cost` alongside
`Terms of Payment FOC`. `ex_job3`'s invoice bills 40,800 USD and states
*"Payment: N/A"* — the value is for customs, not a price — which is the shape
the extraction prompt is told to read as free of cost.

---

## 16. `Valuation_Method`

**Source:** `constant` by default, `document`/`operator` otherwise.

Default: `RULE 4 (TRANSACTION VALUE)`.

**The dropdown and the export disagree, and both are in `codes.ts` on purpose.**
The dropdown photographed on the customer's workbook is the Customs Valuation
Rules **2007** ladder — Rule 3 determination of method, Rule 4 identical goods,
Rule 5 similar goods, through Rule 12 rejection, plus OTH — and contains no
transaction-value entry at all, because under CVR 2007 transaction value is
Rule 3(1) itself. Logi-Sys' own export of job I-10793 nonetheless writes the
**1988** spelling `RULE 4 (TRANSACTION VALUE)`, and so does the hand-corrected
`final (1).xlsx`.

So the default is the string that round-trips, and the eleven dropdown strings
are what an operator may choose instead. See
[open-questions.md](open-questions.md#the-valuation-dropdown-contradicts-the-export).

> `valuationMethod()` deliberately has **no `RULE n` regex**. Under two
> numbering schemes a bare rule number identifies nothing: "RULE 5" is the
> transaction value of identical goods under one and of similar goods under the
> other. The old regex silently picked one.

---

## 17. The supplier: `Supplier_Name`, `_Address`, `_City`, `_Country_Code`, `_Branch`

**Source:** `master` — the organization repository; `document` when unbound.

Logi-Sys resolves the supplier from its own repository on name and branch,
exactly as it does the importer, so an unbound supplier is the name printed on
the invoice — routinely an abbreviation of the one Logi-Sys holds
("ASIA SHIGEN INTERNATIONAL" against "ASIA SHIGEN INTERNATIONAL CO., LTD"). That
**warns**. So does a country with no ISO code, and a missing city.

`Supplier_Branch` matters because a supplier with several branches in the
repository is a different party per branch, and an empty branch can bind the
wrong one.

> `liv_job1` folds the city into `Supplier_Address` and leaves `Supplier_City`
> empty; the hand-corrected `final (1).xlsx` fills it. We follow `final.xlsx`.
> See [open-questions.md](open-questions.md#supplier_city).

---

## 18. The columns that stay empty

| Columns | Why |
|---|---|
| `A -` … `N -` (28 columns) | the itemised `MISC_CH` heads — [§7](#7-misc_charge_--misc_charge_amount--misc_charge_currency) |
| `Sale_Condition`, `Other_relevant_info` | operator-only. A contract's sale conditions are extracted but not written: the column is 40 characters and the declaration is a judgement |
| `AEO_Code`, `AEO_Country`, `AEO_Rule` | operator-only, and it is not settled whose AEO they are — see [open-questions.md](open-questions.md#the-aeo-trio-on-invoices) |
| `Actual Seller/Third Party_*` (7 columns) | manual, usually blank, and **never warned about** — the customer's instruction is not to chase the operator for them |

None of these warns. Warning about a column that is meant to be empty on almost
every job is how a warning list stops being read.

---

## Tests

- `packages/exporter/test/invoices.test.ts` — the rules above, branch by branch:
  the four TOI gates, misc aggregation and its currency check, the related-party
  block both ways, the payment-terms mapping, the HSS fork, multi-invoice, and
  the constants with the evidence for them. Each case builds a real workbook and
  reads the cells back.
- `packages/exporter/test/golden-ep061126-1.test.ts` — `describe('INVOICES')`
  pins the whole row against the checklist Logi-Sys printed for `ex_job6`.
- `packages/extraction/eval/run.ts` — `invoiceCount` (12 on `ex_job5`),
  `miscCharges` (590.75 on `ex_job1`), `termsOfPayment` and
  `natureOfTransaction` (`FOC` / `Free of cost` on `ex_job3`) are scored against
  the real PDFs.
