# RE-IMPORT

Goods that left India and have come back. The sheet is ICES `<TABLE>REIMPORT`
(**BE Message format 2.25, CACHI01 Part 13/24**, p.34 of the spec in
`data/customs-corpus/icegate-specs/`), and it is what claims the re-import
exemption: the shipping bill the goods went out under, and the notification
entry that says how much duty comes back with them.

**One row per line of goods that is a re-import**, keyed `Inv_SrNo` /
`Item_SrNo` — the underscore spelling this sheet shares with STATEMENT and
SW_PRODUCTION, not the `InvSrNo` of ITEMS. Not every line on the BE need be one.

Implemented by `packages/exporter/src/map/re-import.ts`. The per-line facts are
`DraftItem.reImport`, filled by `merge.ts` from a `shipping_bill` document and
confirmed by a person. The notification entries are
`RE_IMPORT_NOTIFICATIONS` in `packages/core/src/masters/data.ts`, and the
candidates come from `reImportNotificationCandidates` in
`packages/core/src/masters/index.ts`.

Evidence, in order of authority:

- **`ex_job29/JobData_I-14385_26-27_20260907_165024.xlsx`** — Logi-Sys' own
  export for job I-14385, and the only populated RE-IMPORT row in the repo. It
  is the format authority for every column.
- The REIMPORT DETAILS block of the Logi-Sys checklists for **`ex_job3`**
  (I-13592) and **`ex_job4`** (I-14075).
- The shipping bills themselves: `ex_job3/13592 SB.pdf`,
  `ex_job29/14385 SHIPPING BILL.pdf`.
- `BE Message format 2.25` for field types and which fields ICES calls
  mandatory, and `BE_fresh_filing_error_codes_24032026.pdf` for what it rejects.
- The notifications themselves, in `data/customs-corpus/text/notification.jsonl`:
  45/2017-Cus, 46/2017-Cus, 94/96-Cus, 158/95-Cus and the amendments 36/2021-Cus
  and 37/2021-Cus; plus Circulars 16/2021 and 21/2019.

## Why this sheet needed dictating

It had no mapper at all, and that was the lesser problem. `merge.ts` matched the
goods description against a re-import regex and raised a **blocking** error on
every such line — "the pipeline does not apply re-import exemptions … Which
applies depends on the shipping bill the goods left under". So a re-import could
not be exported. The shipping bill was in the job folder the whole time;
`shipping_bill` was not a document type, so nothing read it.

The sheet is also the only place the exemption lives. On `ex_job29`'s ITEMS row
`Basic_Notn` and `Basic_NotnSrNo` are **empty**, and `ex_job3`'s checklist prints
the tariff rate of 30% with `BCD Amt 0.00` and `Cus. Notn` blank. Filing
045/2017 in `Basic_Notn` as well would claim the exemption twice.

And the choice is per line, not per job. `ex_job4` has two lines of the same CTH
from the same exporter on one invoice, under two different shipping bills, and
files two different entries:

```
1  1  045/2017 5   SB 1916896  17-May-2025  Nhava Sheva Sea  0.00 …
1  2  045/2017 1E  SB 3030694  26-Jun-2025  Nhava Sheva Sea  0.00 …
```

---

## The vendor row this sheet is measured against

`ex_job29`, sheet `RE-IMPORT`, row 2, every cell a string:

```
Inv_SrNo       1              SB_Inv_SrNo  1        Exp._Freight   0.00
Item_SrNo      1              SB_Item_SrNo 1        Exp.Insurance  0.00
SB_No          3250689        Notn_No      045/2017 Cus.Duty       0.00
SB_Date        03-Jul-2025    Notn_SrNo    1E       Excise_Duty    0.00
Port_of_Export INNSA1                               File_No        (empty)
                                                    IGSTPaid       0.00
```

Four things follow, and each is a way the sheet was going to be got wrong:

1. `Port_of_Export` is the **ICES code**. The checklist prints the name
   (`Nhava Sheva Sea`); the workbook takes `INNSA1`.
2. `Notn_SrNo` is **alphanumeric**. `1E` is Sl. No. 1 clause (e). It can never
   be held as a number.
3. The six money columns are `0.00`, **not blank**. Blank and zero are different
   claims, and the vendor writes zero.
4. `File_No` is empty even on a live re-import.

---

## Columns

| # | Column | Source | Rule |
|---|---|---|---|
| 1 | `Inv_SrNo` | `derived` | The line's `invoiceSrNo`. Never 0 (ICES 371) |
| 2 | `Item_SrNo` | `derived` | The line's serial within its invoice. Never 0 (ICES 372) |
| 3 | `SB_No` | `document`, `operator` override | The shipping bill's number, N(7). Written as text (ICES 375) |
| 4 | `SB_Date` | `document` | The shipping bill's date, `DD-Mon-YYYY` (ICES 376) |
| 5 | `Port_of_Export` | `document`, checked against the custom-house master | ICES 6-character port code (ICES 379) |
| 6 | `SB_Inv_SrNo` | `document` | The invoice's serial **within the shipping bill**, N(2) (ICES 377) |
| 7 | `SB_Item_SrNo` | `document` | The item's serial **within that SB invoice**, N(4) (ICES 378) |
| 8 | `Notn_No` | `master` + `operator` confirmation | `NNN/YYYY` via `logisysNotn()`, C(10) (ICES 373) |
| 9 | `Notn_SrNo` | `master` + `operator` confirmation | The entry claimed, C(10) (ICES 374, 352) |
| 10 | `Exp._Freight` | `document` — freight certificate for the **export** leg | INR, pro-rata to the line. Required by some entries, forbidden by others (ICES 353/355) |
| 11 | `Exp.Insurance` | `document` — insurance certificate for the **export** leg | As above |
| 12 | `Cus.Duty` | `document` / `mail` | The customs incentive being repaid (ICES 354/356/357) |
| 13 | `Excise_Duty` | `document` / `mail` | The excise incentive being repaid. ICES calls this field CVD Amount |
| 14 | `File_No` | none — **deliberately blank** | Not an ICES field. See below |
| 15 | `IGSTPaid` | `document` / `mail` | Money, 2dp. The IGST refunded at export, or not paid at export |

---

## 3–5. `SB_No`, `SB_Date`, `Port_of_Export`

**Source:** `document` — the ICES shipping bill print, whose header block carries
all three together:

```
                              Port Code      SB No      SB Date
INDIAN CUSTOMS EDI SYSTEM      INNSA1        3250689    03-JUL-25
```

The customer's note says "As per importer instruction" for the number and date,
and "From SB / instruction" for the port. The instruction is the fallback, not
the source: when the shipping bill is on the job it decides, and a mail or an
operator entry overrides only by the usual precedence. All three of `ex_job3`,
`ex_job4` and `ex_job29` had the SB number printed on the checklist matching the
SB in the folder.

`SB_No` goes through `code()`, never `int()`. It is a seven-digit identifier and
leading zeros are real.

`Port_of_Export` is looked up in the custom-house master before it is written. A
port code ICES does not hold is rejected, and the name is not an acceptable
substitute — this is the column where "Nhava Sheva Sea" would have gone out.

**Failure mode.** Each is a **blocker** when absent. ICES marks all three
mandatory (spec fields 9, 10, 11) and rejects the filing outright: 375, 376, 379.
There is no partial re-import row.

## 6–7. `SB_Inv_SrNo`, `SB_Item_SrNo`

**Source:** `document` — the shipping bill's **own** invoice and item serials,
from its Part II. These are the export side's keying and must never be confused
with columns 1 and 2.

A shipping bill may carry several. `ex_job29`'s header says `INV 2 ITEM 2`, and
the row filed is `1 / 1` — so the pair is *matched*, by HS code, description and
quantity against the SB's Part-II item table, not assumed. Defaulting to `1 / 1`
happens to be right on all three goldens and is wrong the first time a job
re-imports the second line of a two-line shipping bill.

> **The spec is wrong about these two.** `BE Message format 2.25` marks fields 12
> and 13 `O`ptional. The error list rejects them anyway: 377 *"Shipping Bill
> Invoice Serial Number Cannot be Null or zero or negative in Re_Import Details"*
> and 378 the same for the item number. We treat them as mandatory.

**Failure mode.** **Blocker** when no SB line matches the BE line, naming both
descriptions so a person can see what failed to match.

## 8–9. `Notn_No`, `Notn_SrNo`

**Source:** `master` for the candidates, `operator` for the choice. **The app
never picks one on its own.**

The shipping bill's Part-I summary declares which schemes the export went out
under — `DBK`, `RoDTEP`, `MEIS`, `LICENCE`, `DFRC`, `RE-EXP`, `LUT` — and each
maps to an entry of 45/2017. In practice more than one flag is set: `ex_job3`'s
SB has RoDTEP `Y` and LICENCE `Y` and LUT declared in its marks, and was filed
`1E`; `ex_job29`'s has DBK `Y` *and* RoDTEP `Y`, also filed `1E`. One row carries
one entry. Which one wins is [an open question](open-questions.md#reimport-clause),
so the mapper presents every candidate with the notification's own words and the
amount it demands, and refuses until a person chooses.

### Which notification

| Situation | Notification |
|---|---|
| Exported on or after 01-Jul-2017, the incentive integrated-tax based | **45/2017-Cus** |
| The same, but the incentive was **Central excise** based — rebate of excise duty, or bond without paying excise duty, which after July 2017 means Fourth Schedule goods | **46/2017-Cus**. Same table; only clauses (c) and (d) differ, and it has no RoDTEP or RoSCTL clause |
| The export's clearance under s.51 predates 01-Jul-2017 | **94/96-Cus** — 45/2017's own paragraph 2 says it applies only to later exports, and 46/2017 superseded 94/96 from the same date. 94/96 also has a DEPB entry (`2A`) that neither successor carries |
| Indian goods coming back **to be** repaired, reconditioned or reprocessed here and then re-exported | **158/95-Cus**, against a bond — which also means a BONDS_CERTIFICATES row |

45/2017 and 46/2017 do **not** apply at all — their second proviso — to goods
exported by a 100% EOU or a unit in a Free Trade Zone, goods exported from a
warehouse, or goods of the Fourth Schedule to the Central Excise Act.

### 45/2017's table

Sl. No. 1 is sub-divided, and the sub-entry is what `Notn_SrNo` carries: clause
(a) is `1A`, (e) is `1E`, and so on. Clauses (f) and (g) were added by
46/2023-Cus.

| Sr. No. | The export was | Amount payable on re-import |
|---|---|---|
| `1A` | under claim for drawback of Union customs or excise duty | the drawback allowed at export |
| `1B` | under claim for drawback of a State excise duty | that duty, at the time and place of import |
| `1C` | under claim for refund of IGST | the refund availed |
| `1D` | under bond / LUT without payment of IGST | the IGST not paid |
| `1E` | under DEEC / Advance Authorisation / DFIA, or EPCG | IGST and compensation cess leviable at import, subject to the authorisation not being redeemed and the re-import being intimated |
| `1F` | under claim for RoDTEP | the RoDTEP allowed |
| `1G` | under claim for RoSCTL | the RoSCTL allowed |
| `2` | goods, other than Sl. 1, exported **for repairs abroad** | duty on the fair cost of repairs including materials, **plus insurance and freight both ways** |
| `3` | cut and polished stones exported for treatment abroad | the same basis as Sl. 2 |
| `4` | aircraft parts replaced during MRO in an SEZ, brought elsewhere in India | Nil |
| `5` | anything else | Nil |

Sl. 2 and Sl. 3 are the entries the customer's note is about, and the value they
build carries **IGST and compensation cess as well as BCD** — notification
36/2021-Cus inserted that clarification, and Circular 16/2021-Cus explains why.

### Time limits

Counted from the shipping bill's date to the re-import. Exceeding them does not
make the claim impossible — the Commissioner may extend — but it makes it
something a person has to have arranged, so it warns rather than passes silently.

| Case | Limit | Extension |
|---|---|---|
| Exported under DEEC / AA / DFIA / EPCG / DEPB or a Chapter-3 reward scheme | 1 year | +1 year |
| Bhutan, machinery and equipment not under those schemes | 7 years | +3 years |
| Everything else under 45/2017 | 3 years | +2 years |
| Returned from an exhibition or a consignment sale | 6 months from the delivery challan | — |
| 158/95 Sl. 1, re-imported for repair | 3 years to come in | re-export within 6 months, +6 |
| 158/95 Sl. 2, re-imported for reprocessing | 1 year to come in | re-export within 6 months, +6 |

`ex_job29` is the case: SB dated 03-Jul-2025, filed September 2026, under `1E`
whose limit is a year — which is why the folder contains a
`Shipping Bill Extension letter.pdf`.

### The trap worth naming

Goods returning from an **exhibition abroad or a consignment sale** went out
under a LUT, so 1(d) looks right. Circular 21/2019-Cus says it is not: taking
such goods out of India is not a supply, no IGST was payable, and the re-import
falls under the residuary **Sl. 5**, provided it happens within six months of the
delivery challan. An operator picking by the LUT flag alone gets this wrong.

**Failure mode.** **Blocker** until a person confirms both columns — an
unconfirmed notification is a duty claim nobody made. **Blocker** if the pair is
not an entry of the master (ICES 352). **Blocker** if the same line also carries
a `Basic_Notn` on ITEMS.

## 10–11. `Exp._Freight`, `Exp.Insurance`

**Source:** `document` — the shipper's freight and insurance certificates for the
**export** leg. The customer dictated this one at length:

> "in case of export, if the bill of entry is CIF, or whatever the invoice is
> CIF, or whatever the document is, is CIF, then we have to ask for freight
> certificate and [insurance] certificate from the shipper … This will mostly be
> in the case of repair and return … we have to just look at the shipping bill
> that is given to us. And if the shipping bill makes sense, if it has data
> related to this, then we have to ask the shipper for the two certificates or
> take the data from directly the SB."

Two things the spec adds. The BE annexure labels this pair **"Payment made for
export on Pro-rata basis (in Rs.)"** — so they are **rupees**, and they are
**apportioned to the line**, not the whole shipping bill's freight. And they are
the *export* leg: the inbound freight and insurance are a different claim
entirely and belong to `INVOICES.Frt_Amount` / `Ins_Amount`. `ex_job29` has both
at once — `Exp._Freight 0.00` here, while `INVOICES` carries `1182.00 EUR` of
inbound freight and `3185.00 INR` of insurance from
`FREIGHT CERTIFICATE UK26007747.pdf`. Reusing one for the other would overstate
the assessable value by the inbound leg.

The shipping bill states its own freight and insurance (`ex_job3`'s Part II:
`3.FREIGHT 2736 USD`, `4.INSURANCE 15.71 USD`), which is the fallback the
customer names — converted to rupees at the SB's own exchange rate, which the SB
also prints.

**Failure mode.** Governed by the entry claimed, because ICES validates the two
against it both ways:

| Entry | These columns |
|---|---|
| `2`, `3` | **required** — blocker when the certificates do not state them (ICES 355) |
| every other entry | **must be zero** — blocker when a value is present (ICES 353) |

Deliberately **not** estimated. The 20% of Rule 10(2) is a fallback for an
officer who cannot ascertain the actual freight, not a figure a declarant may
state as the actual — the same rule `05-invoices.md` applies to the inbound leg.

## 12–13. `Cus.Duty`, `Excise_Duty`

**Source:** `document` / `mail` — the export incentive that has to come back.
ICES names them *"Duties equivalent to export incentives received"*, and holds
them as BCD Amount and CVD Amount.

Where the amount is written down varies: `ex_job29`'s export invoice carries
`DRAWBACK TARIFF ITEM # 390499B, DRAWBACK RATE 1.20% ON FOB`, and Kuberr's own
mail on that job asks the customer for "IGST Payable" and "RoDTEP & DRBK return".
So the export invoice and the instruction thread are both sources, and neither is
computed here — an all-industry drawback rate applied to a FOB value is an
estimate, and this column is a payment.

**Failure mode.** The mirror of the pair above:

| Entry | These columns |
|---|---|
| `1A`, `1B`, `1C`, `1D`, `1F`, `1G`, and 94/96's `2A` | **required**, blocker when unknown (ICES 354) |
| `1E`, `2`, `3`, `4`, `5` | **must be zero** (ICES 356, 357) |

> **`1E` is the entry that looks like it belongs in the first row and does not.**
> An amount is certainly payable on a DEEC/Advance Authorisation/EPCG return —
> but it is *"integrated tax and compensation cess leviable at the time and
> place of importation"*, which is the ordinary duty on this Bill of Entry,
> computed by the duty engine and carried by ITEMS. It is not a figure repaid
> out of the export, so it does not belong in these columns. `ex_job29` is
> exactly this entry: `0.00` in all six money columns, while its filing charges
> IGST on the goods. `ex_job3`, also `1E`, charges ₹197,141 of IGST on an
> assessable value of ₹39,42,821 with `BCD Amt 0.00`.

## 14. `File_No`

**Source:** none. Written blank, always.

It is not an ICES field — the REIMPORT table of `BE Message format 2.25` has
nineteen fields and stops at Excise duty, and the printed BE's
`C. RE-IMPORT AFTER EXPORT` block has twelve and does not include it. Logi-Sys'
own export leaves it empty on a live re-import. So there is nothing it could be
filled from, and [nothing has told us what it means](open-questions.md#reimport-file-no).

Blank here is a decision with evidence behind it, which is why it is written
down rather than merely omitted.

## 15. `IGSTPaid`

**Source:** `document` / `mail`. A money column at 2 decimals — `ex_job29` writes
`0.00`, not `Y` or `N`, which is the only reason we know it is not a flag.

The IGST refunded at export (entry `1C`) or the IGST that was never paid because
the export went under bond (entry `1D`). Zero for every other entry.

---

## What a re-import also changes on other sheets

Half of what goes wrong on these jobs is not on this sheet.

| Sheet | Column | What a re-import does |
|---|---|---|
| ITEMS | `Basic_Notn`, `Basic_NotnSrNo` | **stay empty** — the exemption is claimed here, not there |
| ITEMS | `Country_of_Origin`, `MFG_Country` | `IN` on Indian-origin returns, on all three goldens |
| ITEMS | `Product_Description` | carries the original export reference: `REIMPORT : INOFLON PFA 8003 (MATERIAL IMPORTED VIDE INVOICE NO- 242252000635 DT-30-06-2025)` |
| SHIPMENT | `Marks_&_Nos` | an operator declaration, never `AS PER BL` |
| INVOICES | `Nature_of_Trans` | not the `Sale` default — `Free of cost` on `ex_job3`/`ex_job4`, `Others` on `ex_job29` |
| INVOICES | the invoice list | the original **export invoice** is not a BE invoice. `ex_job29` carries both; Logi-Sys filed one |
| BONDS_CERTIFICATES | — | a 158/95 re-import runs against a bond, and needs a row there |

ICES cross-checks the first of those from the other side: error 388, *"Item Not
declared as reimport but reimport details"*, and 321, *"Re-Import details
missing"*. The Logi-Sys ITEMS sheet has no re-import flag column, so Logi-Sys
sets ICES field 75 from the presence of a row here keyed to that line — which
makes the `(Inv_SrNo, Item_SrNo)` pair load-bearing in both directions.

## What is deliberately not automated

- **The notification entry.** Proposed, never chosen. See above.
- **`Cus.Duty` / `Excise_Duty` / `IGSTPaid` amounts.** Read or asked for, never
  computed from a drawback schedule.
- **`File_No`.** Blank until someone says what it is.
- **`Marks_&_Nos`.** The three goldens use three unrelated phrasings; nothing
  suggests a formula.

## Tests

| Test | What it pins |
|---|---|
| `packages/exporter/test/re-import.test.ts` | the `ex_job29` row cell for cell; every blocker; the ordinary import that must leave the sheet header-only |
| `packages/exporter/test/golden-ep061126-1.test.ts` | RE-IMPORT still at `rowCount === 1` for a plain home-consumption BE |
| `packages/exporter/test/structure.test.ts` | the sheet's position and header row, unchanged |
