# LICENSE

The licences a Bill of Entry is filed against, and what each one is debited by.
The sheet is ICES `<TABLE>LICENCE` (**BE Message format 2.25, CACHI01 Part
7/24**, p.29 of the spec in `data/customs-corpus/icegate-specs/`): the
authorisation or scrip, the serial of its own import-item table this line draws
on, and the value, duty and quantity taken off it.

**One row per (line of goods × licence)**, keyed `Inv_SrNo` / `Item_SrNo` — the
underscore spelling this sheet shares with STATEMENT, RE-IMPORT and
SW_ADDL_INFO, not the `InvSrNo` of ITEMS. ICES says so outright:

> The Licenses used for import of each item has to be given in this table.
> **There can more than one license against an item.**

Both directions occur in the corpus: `ex_job20` debits **two scrips against one
line**, `ex_job25` debits **three lines against one licence serial**.

Implemented by `packages/exporter/src/map/license.ts`. The per-line facts are
`DraftItem.licences`, proposed by `applyLicenceResolution`
(`apps/web/lib/licences.ts`) out of the licence master and confirmed by a
person. The master is `licences` / `licence_import_items` / `licence_debits`.

Evidence, in order of authority:

- **Four populated vendor exports** — Logi-Sys' own LICENSE rows, the format
  authority for every column:
  `ex_job25/JobData_I-30288_26-27_20260907_164002.xlsx` (Advance Authorisation),
  `ex_job26/JobData_I-60133_26-27_20260907_164152.xlsx` (EPCG),
  `ex_job28/JobData_I-13882_26-27_20260907_164837.xlsx` (DFIA),
  `ex_job20/JobData_I-14225_26-27_20260907_162112.xlsx` (two RoDTEP scrips).
- The `… LICENCE DETAILS` block of the Logi-Sys checklists for `ex_job25`,
  `ex_job27`, `ex_job28` and `ex_job20` — the **only** place the
  `BCD Fg / CVD Fg / IGST Fg` triple is printed, which is what makes column 11
  computable at all.
- The authorisations themselves: `ex_job26/EPCG-831018385.pdf` (=
  `ex_job13/60133 EPCG LICENCE.pdf`), `ex_job14/30290 ADVANCE LIC.pdf`,
  `ex_job27/14222 TRQ LIC.pdf`, `ex_job28/0811016774_FS.pdf` (transfer letters
  and the authorisation in one bundle), and
  `ex_job25/052. 0311048850 DTD 11.11.2025 PS-39023000 LUT.pdf` — image-only,
  no text layer.
- `ex_job28/Allotment - 86684.pdf` — a broker's allotment advice, the document
  that names the licence item serial and quantity per Bill of Entry line.
- `BE Message format 2.25` for field types and mandatory/optional, and
  `BE_fresh_filing_error_codes_24032026.pdf` for what ICES rejects.
- `ICES 1 5 Customs - DGFT Message Formats Version 1 9 (21 07 08).pdf` — the
  licence structure Customs and DGFT exchange, which the master mirrors, and
  the **Scheme Code directory** that is the domain of `ITEMS.Exim_Code`.

## Why this sheet needed dictating

It had no mapper. `LICENSE` sat in `UNMAPPED_SHEETS` behind the comment
`// advance authorisation / EPCG debits`, and nothing behind it: no type, no
table, and no way to read a licence at all — `license` was not one of
extraction's `DOC_TYPES`, and the classifier's own prompt listed licences as an
example of `other`. Same failure as the shipping bill in
[09-re-import.md](09-re-import.md): the authorisation was in the job folder the
whole time and nothing read it.

The lesser-known half is that **three of the four goldens could not be exported
at all**, for an unrelated reason. `EXIM_SCHEME` was transcribed from a
photograph of the Logi-Sys dropdown that happened to be scrolled, so it stopped
at `20`. `ex_job28` files `Exim_Code 26` (DFIA), `ex_job27` files `32` (TRQ) and
`ex_job20` files `RD` (RoDTEP) — all three hit the blocker in
`map/items.ts` and refused the **whole workbook**. The full directory was in
`data/customs-corpus` the entire time.

---

## The vendor rows this sheet is measured against

```
              Inv It Ref License_No   License_Date  RegNo        RegDate       Reg_Port ItmSr CIF_Value    DebitDeuty   DebitQty    Unit
ex_job25 (AA)  1  1  –   0311048850   10-Nov-2025   0311048850   10-Nov-2025   INHZA1    1      609341.20    169000.78   5200.000   KGS
               1  2  –   0311048850   10-Nov-2025   0311048850   10-Nov-2025   INHZA1    1     1772362.63    491564.78  15125.000   KGS
               1  3  –   0311048850   10-Nov-2025   0311048850   10-Nov-2025   INHZA1    1     3418755.68    948191.89  29175.000   KGS
ex_job26(EPCG) 1  1  –   0831018385   07-May-2026   0831018385   07-May-2026   INHZA1   19    52827500.00  14651707.13      1.000   NOS
ex_job28(DFIA) 1  1  –   0811016774   20-Nov-2025   0811016774   20-Nov-2025   INSBI6    1     7905081.60    652169.23  59800.000   KGS
               1  2  –   0811016774   20-Nov-2025   0811016774   20-Nov-2025   INSBI6    2     5181926.40    427508.93  39200.000   KGS
ex_job20(scrip)1  1  –   2609001995   02-Sep-2026   2609001995   02-Sep-2026   INNSA1    1     1481579.42     74078.97      0.000   KGS
               1  1  –   2609002009   02-Sep-2026   2609002009   02-Sep-2026   INNSA1    1     3617960.04    180898.00  19440.000   KGS
```

---

## The columns

| # | Column | ICES field | Source |
|---|---|---|---|
| 1 | `Inv_SrNo` | 7, key | derived |
| 2 | `Item_SrNo` | 8, key | derived |
| 3 | `License_RefNo` | — | **constant** — blank |
| 4 | `License_No` | — (vendor-side) | `document` < `master` < `operator` |
| 5 | `License_Date` | — (vendor-side) | `document` < `master` < `operator` |
| 6 | `License_RegNo` | 13, **M** | `master`, defaulting to column 4 |
| 7 | `License_RegDate` | 14, **M** | `master`, defaulting to column 5 |
| 8 | `Reg_Port` | 16, **M** | `document` → `master` |
| 9 | `License_ItemSrNo` | 9 | proposal + **operator confirmation** |
| 10 | `CIF_Value` | 10 | derived — the job's own valuation |
| 11 | `DebitDeutyValue` | (vendor-side) | derived — the job's own duty |
| 12 | `DebitQuantity` | 11 | derived, converted to the licence's unit |
| 13 | `DebitQuantityUnitCode` | 12 | `master` — the licence's unit |

ICES' own table is only sixteen fields and carries **no licence number or date
at all** — just the registration triple (number, date, port) and the two-char
`License Code`. Columns 4 and 5 are Logi-Sys', and column 11 is Logi-Sys'
too. That asymmetry is why this sheet has thirteen columns and ICES has ten
that matter.

## 1–2. `Inv_SrNo`, `Item_SrNo`

**Source:** derived — the line's own `invoiceSrNo` and `slNo`, never its
position in an array.

Zero or null is ICES **423** (*Item Details Missing but Licence Details*) and
**335** (*Licence Details not available for this item*). Both are blockers.

## 3. `License_RefNo`

**Source:** `constant` — **blank, always**.

Four populated vendor exports, eight rows, four different schemes, and the
column is empty on every one, including three rows that carry the same licence.
It is not an ICES field. Written blank as a decision rather than an omission,
the same way `SHIPMENT.CarrierCode` and `RE-IMPORT.File_No` are — see
[open-questions.md](open-questions.md#license-refno).

## 4–5. `License_No`, `License_Date`

**Source:** `document` < `master` < `operator`.

The DGFT authorisation or scrip number and its issue date, off the licence's own
header. Written with `code()`, never as a number: `0811016774` is ten digits and
loses its leading zero the moment anything treats it as one — the broker's
allotment advice for that very licence prints `Reg No 811016774`, nine digits,
which is exactly that bug happening upstream of us.

A **blocker** when absent: without the number there is no licence.

## 6–7. `License_RegNo`, `License_RegDate`

**Source:** `master`, defaulting to columns 4 and 5.

ICES fields 13 and 14, both **mandatory**; null is error **403** / **404**, and
a number ICES does not hold is **407** (*Invalid Licence Registration Number*)
or **408** (*No Such Licence*).

They equal the licence number and date on all four goldens, and the DGFT message
format says why:

> **No separate registration is required at the Customs Station.** License
> Number will be used for processing of Bill of Entry and Shipping Bill
> declarations.

So the default is the licence's own number and date. They are still held
separately, because a physical licence carries a stamped `REG. NO / DATE / REG.
PORT` block and that block can say something else. When a document states a
registration number that differs, it wins and the export **warns** — it does not
silently normalise one into the other.

## 8. `Reg_Port`

**Source:** `document` (printed on the licence) → `master`, validated against
`GENERATED_CUSTOM_HOUSES`.

ICES field 16, mandatory; an unknown station is error **340**.

**This is not the station the Bill of Entry is filed at, and it must never be
defaulted to it.** Three of the four goldens differ:

| Job | Filed at | Licence registered at |
|---|---|---|
| `ex_job25` | `INSAJ6` ICD Tumb | `INHZA1` Hazira |
| `ex_job26` | `INCCU1` Kolkata | `INHZA1` Hazira |
| `ex_job28` | `INNSA1` Nhava Sheva | `INSBI6` ICD Sabarmati |
| `ex_job20` | `INNSA1` | `INNSA1` |

The 2008 DGFT spec says *"NO import is permitted against the license other than
the port of registration"*, and that is simply no longer how it works — a
licence registered at any EDI port is usable at all of them. The data settles
it; the older sentence does not.

The licence prints the port in three shapes, all seen in the corpus:

```
INHZA1-HAZIRA PORT, CHORYASHI, BYPASS RD., HAZIRA, SURAT      (EPCG, AA)
INSBI6-ICD SABARMATI …                                       (DFIA)
JNCH, NHAVA SHEVA, TAL:URAN, DIST-RAIGAD-400707 (INNSA1)      (TRQ)
```

so the rule is: take the six-character `IN`-prefixed token wherever it sits,
check it against the custom-house master, and **blocker** if there is no match.
Never assemble a code from the name.

## 9. `License_ItemSrNo`

**Source:** a proposal, then an **operator confirmation**. Never a silent guess.

ICES field 9 — the serial of the row in the licence's *own* import-item table
that this line draws on. A wrong one is error **427** (*Slno in Lic is not
matching / not available*); a null one is **424**.

The customer's own note is the whole problem:

> So basically license will list multiple products and bill of entry would have
> one of those listed products. Then now we have to compare which serial number
> that item corresponds to in the license.

Each golden makes it hard in a different way:

| Job | The licence's table | What decides the serial |
|---|---|---|
| `ex_job26` EPCG | 36+ rows; `84051090` appears once | an exact 8-digit CTH match is unique → **19**. Nothing about the BE line says "19" |
| `ex_job28` DFIA | 2 rows, **both `39021000`** | CTH is ambiguous. The descriptions differ (*PP Granules* / *PP Granules for lamination*), and the broker's allotment advice names them outright |
| `ex_job25` AA | 1 row | trivially 1 — and three BE lines all debit it |
| `ex_job20` scrips | no item table at all | `1` by construction |

Precedence, first answer wins, in the contract's own order:

1. **`document`** — an allotment advice on this job naming this licence and a
   serial. `ex_job28`'s matches its two lines by quantity to the kilogram
   (59,800 / 39,200) and by value to the dollar; matching on the quantity and
   not merely the licence number is what makes it a fact rather than a
   coincidence.
2. **`master`** — a previous confirmed debit for the same importer and the same
   `productDescriptionKey` against the same licence. This is what makes the
   second EPCG shipment against serial 19 free.
3. **a proposal** — CTH at 8 digits, else 6, else 4; filtered to items with
   balance left, and to the stated country of origin where the licence
   restricts it (`ex_job27`'s TRQ is UAE-only). Ranked, never applied.
4. **`operator`** — always wins, and is always required when the proposal is
   not unique.

A scrip with no item table gets `1`, and that is written down as a rule with
`ex_job20` beside it, not left to fall out of a default.

## 10. `CIF_Value`

**Source:** derived — `ItemDutyResult.assessableValue`, the figure this Bill of
Entry's own valuation already produces. The customer's note reads "BE", and this
is what it means.

Not the invoice value, not a figure off the licence. Proof, exact:

- `ex_job26`: 550,000 USD × 96.05 = **52,827,500.00**, the single row verbatim.
- `ex_job28`: 134,640 USD × 97.20 = **13,087,008.00**, the sum of its two rows,
  split 59,800 / 39,200 kg.
- `ex_job27`'s checklist prints `Assessable Value 10459845.00` in the item block
  and `Debit Val 10459845.00` in the licence block. The same number twice.

`ex_job20` settles that it is the *assessable* value and not
`QTY × Unit_Price × rate`: its two rows sum to 5,099,539.46, which includes the
apportioned misc charges and insurance.

Written with `money()` (2dp). A debit less than the line's actual CIF is ICES
**351**, so where one line is split across licences the parts must sum back to
the line's assessable value — a **blocker** when they do not.

## 11. `DebitDeutyValue`

**Source:** derived — the duty this scheme forgoes on this line, out of the
job's own duty calculation. **Never read off the licence.** A licence's own
"Duty Saved" figure is a *ceiling* the ledger checks against (ICES **415**), not
a value to copy into this cell.

Logi-Sys prints the working on its checklist, and it is a sum of three:

```
ex_job25  EXIM Notn (DEEC) 021/2023 1 (BCD:Nil, CVD:Nil, CESS:Nil, Addl Duty : Nil)
              BCD Fg 484267.41   CVD Fg 0.00   IGST Fg 1143751.57      → Debit Duty 1628018.98
ex_job27  EXIM Notn (TQ) 022/2022 III2 (BCD:3.75, …)
              BCD Fg 431468.61   CVD Fg 0.00   IGST Fg 0.00            → Debit Duty  431468.61
ex_job28  EXIM Notn (DFIA) 025/2023 1 (BCD:Nil, …)
              BCD Fg 652169.23   CVD Fg 0.00   IGST Fg 0.00            → Debit Duty  652169.23
```

`BCD Fg` is the foregone basic duty **with SWS folded into it** (× 1.1), which
is why the AA and EPCG lines debit 27.73% of assessable value and not the 26.25%
the three headline rates add up to.

`computeDutyForegone` in `packages/core/src/duty.ts` produces it by running the
duty engine twice — once as filed, once with that notification's exemptions
removed — and differencing. Pinned to the paisa by
`packages/core/test/duty-foregone.test.ts`.

### The IGST base rule, which this sheet is the only reason we found

A scheme's relief is duty **forgone**, not a rate. It stays chargeable under
section 12 of the Customs Act, and so it stays in the IGST base under section
3(8) of the Customs Tariff Act. An ordinary exemption is different: it sets the
effective rate, and the reduced duty is what goes in the base.

Two independent confirmations that a scheme keeps the forgone duty in the base:

- `ex_job28` (DFIA, BCD wholly forgone) files `IGST 1,540,305.15`, which is 18%
  of AV 7,905,081.60 **+ the tariff BCD 592,881.12 + SWS 59,288.11**. 18% of the
  assessable value alone would be 1,422,914.69.
- `ex_job27` (TRQ, BCD 7.5% → 3.75%) files `IGST 2,038,100.80`, which is 18% of
  AV + the **full** 784,488.38 + SWS 78,448.84 — although only 392,244.19 was
  paid.

And one control that an ordinary exemption does not:

- `ex_job6` (India–Japan CEPA, 069/2011 serial 295, BCD 0%) files
  `IGST 3,303,058.70`, which is 18% of the assessable value exactly, with
  nothing notional added.

`ExemptionClaim.kind` carries the distinction: `'scheme'` for anything claimed
in `Exim_Notn`, `'effective'` (the default) for everything else. Getting this
wrong understates IGST on every scheme import — which is a misdeclaration on the
duty line, not merely a wrong licence debit.

## 12–13. `DebitQuantity`, `DebitQuantityUnitCode`

**Source:** derived, but **in the licence's unit** — `master` for the unit
itself. ICES fields 11 and 12, and the spec is explicit:

> Debit Quantity and Unit of Measurement shall be given **as per the license**.
> If the Unit of Measurement of the Invoice is different from that of the
> License, the quantity (Invoice) **has to be converted** to the Unit of
> measurement as per License.

`ex_job26` is the case: the line is invoiced as **1 SET** and debited as
**1.000 NOS**. `ex_job27`'s checklist debits **99.00 MTS** against a line of
99,000.000 KGS.

A conversion we cannot do is a **blocker**, never a pass-through — ICES **416**
(*Less Value (Quantity)*), and a factor of a thousand in the wrong direction
takes a thousand times too much off someone's authorisation. Weight-to-weight
converts through `weightToKg()`; identical units are identity; count-to-count
between different units needs a factor a person has stated, stored on the
licence item so it is asked once and not once per job; weight-to-count and
anything involving a volume is refused outright, because nothing in the system
holds a density or a pack size.

`DebitQuantity` may legitimately be **`0.000`** — `ex_job20`'s first scrip
debits value with no quantity, because a duty-credit scrip has no quantity
ledger. Zero here is a real figure, not a missing one.

Written with `weight()` (3dp) and `code()`; the unit must be a `VALID_UQC`
member, and never `normalizeUqc`'s `NOS` fallback.

---

## Cross-sheet invariants

These are what "never getting this wrong" actually means: every one of them is
a rejection at filing, and none of them is visible from inside this sheet.

| Other sheet | Invariant | ICES |
|---|---|---|
| `ITEMS.Exim_Code` | must equal the scheme code of every licence on that line | **426** *Scheme Code Mismatch in Licence and item* |
| `ITEMS.Exim_Notn` / `Exim_NotnSrNo` | present **iff** `Exim_Code` is set | **330** / **331** / **383** |
| `ITEMS.Basic_Notn` | **empty** on all four goldens — the scheme exemption is claimed in `Exim_Notn` only | filing both claims the relief twice |
| `ITEMS.IGST_ExemptionNotn` | AA (`021/2023`) and EPCG (`026/2023`) repeat the scheme notification; **DFIA (`025/2023`), TRQ and scrips leave it blank** | this is exactly why the debit is 27.73% on AA/EPCG and 8.25% on DFIA |
| a line with a scheme | must have at least one LICENSE row | **389** *Item details missing but scheme details* |
| a LICENSE row | must have an item behind it | **423** |
| `GENERAL.BETypeCode` | `W` (warehousing) carries **no** licence particulars — the debit happens on the ex-bond clearance | **834** |
| `GENERAL.ITC_Lic_details` | **blank**, even here. Not the gate for this sheet — see below | — |
| `BONDS_CERTIFICATES` | an AA or EPCG runs against a bond; `ex_job25`'s checklist prints `EB 2002542921 INHZA1` and `ex_job26` sets `IsBondsCertificates Y` | **419** / **425** |

### `ITC_Lic_details` is not this sheet's flag

Four vendor exports, each carrying a live licence, leave `ITC_Lic_details`
**blank** on GENERAL — including `ex_job26`, which does set
`IsBondsCertificates Y`. Whatever that column is for, it is not "this BE has
licence particulars", and the LICENSE sheet must not be gated on it. This
closes the open question at [open-questions.md](open-questions.md).

---

## What ICES rejects, and what guards it

| Code | Rejection | Guarded by |
|---|---|---|
| 330 / 331 / 383 | Scheme Code Notn details missing / not required / null | the ITEMS cross-check |
| 335 / 389 | Licence details not available for this item | a scheme with no LICENSE row is a blocker |
| 351 | Debit Value less than actual CIF | the split must sum to the line's assessable value |
| 403 / 404 / 405 | Registration number / date / licence code null | mandatory-field blockers |
| 407 / 340 | Invalid registration number / port | validated against `GENERATED_CUSTOM_HOUSES` |
| 409 | Licence fully debitted — no balance available | the `licence_debits` ledger |
| 415 / 416 | Less value (duty) / (quantity) | the ledger, per dimension the licence states |
| 423 / 424 / 427 | Item details missing / serial null / serial not matching | the `License_ItemSrNo` confirmation |
| 426 | Scheme code mismatch in licence and item | the ITEMS cross-check |
| 834 | Licence particulars on a warehousing BE | the BE-type gate |

And the ones **nothing here can prevent**, said plainly rather than claimed:
**408** (No Such Licence), **410** / **411** (agency / licence mismatch), **413**
(invalid or expired), **417** (rejected), **421** (amendment pending), **422**
(cancelled). These are facts about ICES' own licence table, which we cannot see.
The master's `status`, `import_validity_to` and transfer chain make them less
likely and let the operator be told early; they are not guarantees, and the
export says so rather than pretending otherwise.

---

## Tests

`packages/exporter/test/license.test.ts` holds the rule tests, one per ICES code
above. `packages/core/test/duty-foregone.test.ts` pins column 11 against all
five checklists — the two exemption shapes (full and partial), the two IGST
treatments (exempt and charged), and the FTA control that must *not* change.
The goldens are `ex_job28` (two serials, a registration port that is not the
filing station), `ex_job20` (two licences on one line, a `0.000` quantity),
`ex_job25` (three lines on one serial) and `ex_job26` (serial 19 off a 36-row
table, `SET` → `NOS`).
