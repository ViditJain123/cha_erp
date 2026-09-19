# SEC65_EXBOND_INFO

Zero or more rows, and only for an **ex-bond Bill of Entry out of a Section 65
warehouse that is clearing a resultant product**. Every other filing — a
home-consumption BE, an into-bond BE, an ex-bond BE out of an ordinary bonded
warehouse, and an ex-bond BE out of a Section 65 warehouse that is *not*
clearing manufactured goods — emits **no rows at all**, which leaves the sheet
byte-identical to the vendor's template.

Implemented by `packages/exporter/src/map/sec65-exbond-info.ts`, fed by
`apps/web/lib/inbond.ts` (`applyInbondExbondResolution`) off
`job_sec65_finished_goods` and the attached GST tax invoices. The operator
surface is the Section 65 block of
`apps/web/app/(app)/jobs/[id]/bond-panel.tsx`.

## What the sheet is

Section 65 of the Customs Act lets the owner of warehoused goods carry on
manufacture inside the warehouse — the MOOWR scheme, under Manufacture and Other
Operations in Warehouse (no.2) Regulations 2019, notification 69/2019-Cus (N.T.).
When the resultant product is supplied into the domestic tariff area it moves
under a GST invoice, and the import duty on the inputs contained in it falls due
(Circular 48/2020-Customs, para 8).

So the Bill of Entry is upside down relative to every other sheet in this
workbook: **its items are the imported inputs, and this sheet is the output they
were manufactured into.** Nothing on the import side carries any of it.

ICES holds it as `BE_ITEM_SW_CTRL` rows with Control Type Code `SEC65`
(`data/customs-corpus/icegate-specs/BE Message format 2.25 (16Feb2026).pdf`,
Message ID `CACHI01 (Part 22/24)`). Of that segment's seventeen fields — every
one marked `M` in the `X-BE (Sec65)` column — Logi-Sys asks for eight:

| # | ICES field | Sec65 meaning, per the spec | Column | Filled by |
|---|---|---|---|---|
| 7 | Invoice Serial No | invoice serial of the *import* invoice | `Inv_SrNo` | **us** |
| 8 | Item Sr. No. | item serial of the *import* line | `Item_SrNo` | **us** |
| 9 | Control Type Code | `SEC65` | — | Logi-Sys, constant |
| 10 | Control Location | Warehousing Code | — | Logi-Sys, from `INBOND_EXBOND.WH_Code` |
| 11 | Control Start Date | Warehousing date | — | ICES, off the into-bond BE |
| 12 | Control End Date | GST Invoice Dt | `GSTInvoiceDate` | **us** |
| 13 | Control Result Code | GST Invoice No (16 char) | `GSTInvoiceNo` | **us** |
| 14 | Control Result Text | CTH followed by Goods Description of Finished Product, both separated by any delimiter | `FinishedProductCTH` + `FinishedProductDesc` | **us**; Logi-Sys joins them |
| 15 | Control MSR | Quantity — N(16,6) | `FinishedProductQty` | **us** |
| 16 | Control UQC | Unit Quantity Code — C(3) | `FinishedProductQtyUnit` | **us** |
| 17 | Control Slno | Serial No. of GST Invoice ("An Item can have Multiple GST Invoice") | — | Logi-Sys, from row order |

Two of those are **not ours to supply**. Control Location has no column here
because Logi-Sys reads the warehouse code off `INBOND_EXBOND`; Control Start
Date has none because ICES holds the warehousing date against the into-bond BE
itself (filing error 139, "Warehousing Date Not updated for the WBE"). Do not
invent a column for either.

**Control Slno is row order.** With no serial column on the sheet, the only
thing that distinguishes an item's second GST invoice from its first is where
the row sits. The mapper therefore groups by item and keeps each item's rows
contiguous and in declaration order.

### Sibling sheets

`SW_CONTROL` is the same ICES segment for its ordinary, non-Sec65 use — a
pre-arrival inspection or test, with no quantity and no serial. `SEZ_INFO` is
the SEZ flavour. `SEC65_EXBOND_INFO` is the Section 65 flavour, and nothing
belongs on two of them at once.

---

## When the sheet applies

An ex-bond BE out of a Section 65 warehouse is **not always** a resultant-product
clearance, which is why one "Section 65 warehouse" tick is not enough to gate
the sheet. The five cases, and what each one files:

| What is leaving | SEC65 rows | Why |
|---|---|---|
| A product manufactured in the warehouse, sold on a GST invoice | **yes** | Circular 48/2020 para 8: duty on the inputs contained in the resultant product, paid on an ex-bond BE. No s.61 interest. |
| The warehoused goods **as such** | no | Para 8.1: *"In case the licensee is unable to carry out any manufacturing or other operations on warehoused goods, then the goods may be cleared as such … after the payment of applicable import duties along with the interest accrued."* There is no finished product. |
| Capital goods removed from the premises | no | The duty event is the removal of the asset, not a sale of output. |
| Inputs consumed in job work, duty paid on return to the principal | **open** | The return moves on a delivery challan, not a GST invoice. Not settled — see `open-questions.md`. |
| Finished goods exported | — | Shipping bill under s.69; no Bill of Entry and no duty on the inputs. |

**There is no Section 65 flag in the BE header message.** ICES infers it from
the IEC-to-warehouse mapping an ACB-role officer maintains (JNCH Public Notice
119/2020). We cannot see that mapping, so the two facts are held separately:

- `bonded_warehouses.is_sec65` — the warehouse holds a MOOWR permission. A
  property of the warehouse, read off the permission, cached per company. This
  is what `INBOND_EXBOND.IsSEC65ManufacturingWH` reports.
- `job_boe_header.exbond_clearance_kind` — what *this* filing clears. Only
  `resultant_product` produces rows here.

---

## 1–2. `Inv_SrNo`, `Item_SrNo`

**Source:** derived — the invoice and item serials of the BE's own line items
(`draft.items[].invoiceSrNo` / `.slNo`), never keyed.

The fan-out is what makes the pair: one finished-goods entry becomes one row per
item it was made from. An entry with no item list applies to **every** item,
which is the ordinary MOOWR case — all the imported inputs went into the one
resultant product. An entry with a list applies to those items only.

```
1 entry, 3 items                2 entries, the 2nd only on item 2
 1  1  GST/26/0912                1  1  GST/26/0912
 1  2  GST/26/0912                1  2  GST/26/0912
 1  3  GST/26/0912                1  2  GST/26/0915   <- Control Slno 2
                                  1  3  GST/26/0912
```

## 3. `GSTInvoiceNo`

**Source:** operator, or an attached `gst_tax_invoice` document.

Written with `code()` — an invoice serial with a leading zero is a real serial.
At most 16 characters, which is both ICES's field width and the ceiling CGST
rule 46 puts on an invoice serial number; a longer one is a transcription error
rather than a long invoice number.

## 4. `GSTInvoiceDate`

**Source:** operator, or the attached GST tax invoice.

**Warns** when it is in the future, and when it predates the into-bond BE — the
finished product cannot have been sold before its inputs reached the warehouse.
Neither blocks: the BE has no date of its own until ICES assigns one, so there
is no firm upper bound to check against.

## 5. `FinishedProductCTH`

**Source:** operator, or the HSN on the attached GST tax invoice.

The **finished product's own** eight-digit heading, which is rarely the heading
of any input it was made from. `pad8()` normalises it and `lookupTariff()` must
resolve it — ICES validates the heading inside the control row (error 730).

A GST invoice prints HSN at four, six or eight digits depending on the
supplier's turnover, so a proposal off a document routinely needs correcting.
The resolution warns that it does rather than padding a four-digit HSN into a
tariff item nobody chose.

## 6. `FinishedProductDesc`

**Source:** operator, or the line description on the GST tax invoice.

Logi-Sys joins this and the CTH into ICES's single Control Result Text field
(4000 characters) with its own delimiter.

## 7. `FinishedProductQty`

**Source:** operator, or the GST tax invoice line.

`qty()` — six decimals, matching ICES's `N(16,6)` and the ITEMS convention. This
is the quantity of **finished product** cleared, in the finished product's own
unit; it has no arithmetic relationship to the input quantities on ITEMS.

When one finished product is declared against several input items, the **full**
quantity is written on each row, not an apportioned share. That is the plain
reading of *"Control MSR — Quantity"* / *"cleared finished product quantity"*,
and it is on the list to confirm (`open-questions.md`).

## 8. `FinishedProductQtyUnit`

**Source:** operator, or the GST tax invoice line's unit.

Must be a member of `VALID_UQC`. Deliberately **not** put through
`normalizeUqc()`: that falls back to `NOS` for an unknown unit, and a silently
defaulted unit on a customs declaration is what this mapping contract exists to
prevent. An invoice that prints "PCS" is refused so a person picks the code.

---

## The refusal contract

Every blocker below is a rejection ICES would otherwise hand back after filing.
The codes are from
`data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf`.

| Code | ICES rejection | What we do |
|---|---|---|
| 724 | Code wrong for SEC65 XBE in ctrl details | Logi-Sys writes the constant `SEC65`; nothing to do |
| 725 | Warehouse Code cannot be null for SEC65 | **blocker** when rows exist and no warehouse is named |
| 726 | Invalid Warehouse Code / warehouse not mapped to IEC | `parseWarehouseCode()` on INBOND_EXBOND; the IEC mapping is ICES's own and cannot be checked here |
| 727 | Invalid warehousing date / null for S65 XBE | not our column — **warns** when the into-bond BE date is unknown |
| 728 | Invalid GST Invoice Number | **blocker**: present, and 16 characters at most |
| 729 | Invalid GST Invoice Date | **blocker** when absent; **warns** on an implausible one |
| 730 | Invalid CTH in ctrl details | **blocker** unless `lookupTariff(pad8(cth))` resolves |
| 731 | Quantity cannot be null or negative | **blocker** unless `> 0` |
| 732 | Invalid UQC in ctrl details | **blocker** unless in `VALID_UQC` |
| 733 | Duplicate Slno present in ctrl details | rows contiguous per item; **blocker** on the same GST invoice twice against one item |
| 734 | Item details not present for this ctrl details | **blocker** on an entry pinned to an item serial the BE does not have |
| 735 | S65 XBE details not present for this item | **blocker** when any item ends up with no row |
| 868 | SEC65 MOOWR details required only for … | the gate: no rows unless ex-bond **and** section 65 **and** `resultant_product` |

The same rules run again in `saveBondDetails`
(`apps/web/app/(app)/jobs/[id]/actions.ts`) for the per-row ones, so a bad CTH
is refused while the operator is still looking at the field. The cross-row rules
(734, 735, 733) live only in the exporter, because they need the item list.

---

## No golden covers this

**No workbook in this repo has ever had a populated `SEC65_EXBOND_INFO` row** —
not the vendor template, not `liv_job1`, not any of the `ex_job*` fixtures, and
`understanding_this_sheet.xlsx` carries no annotation against the sheet. Every
golden is a home-consumption BE (`BETypeCode = H`); there is no ex-bond golden
at all.

So this sheet is specified against `BE Message format 2.25`, the ICES filing
error list and Circular 48/2020, and not against an observed vendor row. The
precision of `FinishedProductQty` in particular (6dp) is the spec's, not an
observed one. `packages/exporter/test/sec65-exbond-info.test.ts` names the error
code each case guards; the golden test cannot reach this sheet.

Worth asking Kuberr for one filed Section 65 ex-bond job before this goes in
front of a customer.

## Primary sources

- `data/customs-corpus/icegate-specs/BE Message format 2.25 (16Feb2026).pdf` —
  `<TABLE>BE_ITEM_SW_CTRL`, and the `Sec65 XBE:` note under it.
- `data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf` —
  errors 724–735, 868.
- `data/customs-corpus/icegate-specs/advisory - changes in ex-bonding_0.pdf` —
  the warehouse ledger, from 1 September 2025.
- Circular 48/2020-Customs (corpus `text/circular.jsonl`, id 1000252) —
  manufacture under s.65; para 8 the resultant product, para 8.1 clearance as
  such with interest.
- Circular 34/2019-Customs and MOOWR 2019, notification 69/2019-Cus (N.T.).
- JNCH Public Notice 119/2020 — the IEC-to-warehouse mapping ICES validates the
  declaration against, and the field-level Annexure for `BE_ITEM_SW_CTRL`.
