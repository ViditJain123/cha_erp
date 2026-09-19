# Open questions

Things a mapped column depends on that are not settled. Each one has a stated
interim behaviour, and every interim behaviour is *ask the operator* rather than
*guess*.

## Sec 46 holiday calendar

Section 46(3) measures its deadline in days that exclude customs holidays. We
do not hold a holiday calendar, so `IsUnderSec46` is computed on calendar days:
`beFilingDate > inwardDate` → `Y`.

**Consequence:** a BE filed the working day after a holiday weekend can be
flagged late when the statute would not treat it as late.

**Interim:** the operator can clear the flag on the job screen with a reason,
stored in `job_boe_header.sec46_override_reason`.

**To settle:** is the flag meant to say "this BE was presented late" (our
reading), or "we are claiming a waiver of the late fee under the proviso"?
Those are the same cell for most jobs and different cells when the officer has
already waived the charge.

## Warehouse type letters

The fifth character of a warehouse code is its licence type. `U` = public
(s.57) is well attested. `R` = private (s.58) and `P` = special (s.58A) come
from a single secondary source, and `P` for *special* rather than *private* is
the kind of thing that gets transcribed wrong.

**Interim:** all three are accepted and decoded; only the label shown to the
operator is affected, never the code written to the workbook.

**To settle:** check one real private-warehouse licence and one special-warehouse
licence.

## Section 65: one finished product, several input items

The sheet is dictated ([08-sec65-exbond-info.md](08-sec65-exbond-info.md)), but
two things in it are read from the spec rather than from anything observed.

**When one finished product is declared against several of the BE's items, is
Control MSR the full quantity cleared on every row, or an apportioned share?**
The spec says only *"Control MSR — Quantity"*, and the JNCH Annexure *"cleared
finished product quantity"*. Neither hints at apportionment, and an apportioned
share would need an input-output norm we do not hold.

**Interim:** the full quantity is written on each row. A single-product job — the
common MOOWR shape — is unaffected either way.

**To settle:** one filed Section 65 ex-bond BE with more than one input line.
Ask Sandesh.

## Section 65: a job-work return

Circular 48/2020 says that where imported inputs are consumed during job work,
duty is paid by ex-bond BE when the job-worked goods go back to the principal.
But that return moves on a **delivery challan**, not a GST invoice — and ICES's
`SEC65` control row is built around a GST invoice number and date.

**Interim:** `job_work_return` is one of the four clearance kinds on the bond
panel, it writes no rows, and it warns that the position is unsettled.

**To settle:** whether ICES expects a SEC65 declaration on a job-work return,
and if so what goes in Control Result Code. Ask Sandesh.

## Section 65: the warehouse code's length

`BE Message format 2.25` header field 31 is `Warehouse Code C 8`, which matches
`parseWarehouseCode()` — port(4) + type + serial(3). JNCH Public Notice 119/2020
Annexure 1 calls `ctrl_loc` a *"ten digit warehouse code"*.

**Interim:** eight, from the newer document, which is also the one ICES
validates the BE message against.

**To settle:** one real MOOWR permission, or one accepted Sec65 ex-bond filing.

## The ICEGATE warehouse enquiry endpoint

`enquiry.icegate.gov.in` returns NOERROR with no address from outside India —
GeoDNS — so the exact request its Search button issues could not be observed.
`apps/web/lib/icegate-warehouse.ts` tries two plausible shapes and degrades to
operator entry.

**To settle:** open the enquiry from an Indian network, watch the network tab,
and pin the real method, path and payload. Until then every warehouse is typed
in once.

## Ex-bond item serials

`ITEMS.Inbond_InvSrNo` / `Inbond_ItemSrNo` should point at the into-bond BE's
own item serials, and are still hard-zeroed in `map/items.ts`. The parent-job
link and the `into_bond_be` document type both now carry those serials; nothing
reads them yet.

**To settle:** confirm against a real ex-bond checklist whether Logi-Sys wants
the into-bond BE's serials or its own line numbering.

## `ITC_Lic_details` — settled

Named as a flag in the dictation ("is ITC license details") but the column name
reads like it wants the licence particulars, and there is a separate LICENSE
sheet in the workbook.

**Settled** by four vendor exports that each carry a live licence on the LICENSE
sheet — `ex_job20` (RoDTEP scrips), `ex_job25` (Advance Authorisation),
`ex_job26` (EPCG) and `ex_job28` (DFIA). All four leave `ITC_Lic_details`
**blank**, including `ex_job26`, which does set `IsBondsCertificates Y`. So
Logi-Sys writes neither `Y` nor a licence number here, and the LICENSE sheet is
not gated on it. It stays a `Y`/blank operator flag, and
[10-license.md](10-license.md) records the blank as a decision.

## Which AD code reaches the customer

`AD_Code` is on the checklist verification mail for the customer to confirm.
The mail template does not have that line yet
(`packages/mail/src/templates.ts`).

**To settle:** is AD-code confirmation part of the existing checklist mail, or
its own question asked earlier — before the BE is drafted rather than after?

## Custom house when the mail is silent

The chain falls back to `organizations.default_custom_house`, which nobody has
populated yet, so today the practical answer for a silent thread is *ask the
operator*.

**To settle:** should the first job for an importer at a station set that
importer's default automatically?

## SHIPMENT's house columns — ask Sandesh

`HAWB_HBL_No` and `HAWB_HBL_Date` are annotated, literally, **"Ask Sandesh"** in
the dictated spec. Air is settled by the goldens — `ex_job1` and `ex_job5` both
fill them off the house air waybill, with numbers and dates independent of the
master's. Sea is not.

**Interim:** on sea they are filled only under the house-B/L rule in
[03-shipment.md §9-10](03-shipment.md) — a house B/L with no master goes here and
the master columns stay empty with a warning.

**To settle:** does Logi-Sys want the house pair populated on every consol
shipment, or only when the BE is filed against the house document? And when the
customer sends only a forwarder's house B/L, is the right answer to chase the
master B/L or to file against the house one?

## Which date dates a bill of lading

The BE is supposed to carry the shipped-on-board date, falling back to the date
of issue. On two of the three sea goldens, the date Logi-Sys filed is neither
date printed on the document:

| Job | Printed on the B/L | Filed on the checklist |
|---|---|---|
| `ex_job6` | `JUL 14 2026` — twice, as date of issue and in the signature block, and the only date anywhere on the document | `30-Jun-2026` |
| `ex_job2` | `Date Issued : 15-Jun-2026` | `18-Jun-2026` |

The likeliest explanation is that the on-board date is a rubber stamp the text
layer of a scan loses. `ex_job6` is also a *copy* B/L, so the stamped page may
simply not be in the file we hold.

**Interim:** on-board date when the document states one, else the issue date,
with an `info` flag on the draft naming which was used. The eval asserts what
the document prints (`2026-07-14` for `ex_job6`), **not** what the checklist
filed — an eval that asserts a value absent from the PDF is asserting that the
model should hallucinate.

`ex_job3` is a third shape: its Maersk waybill has both a
`Shipped on Board Date` box and a `Date Issue of Waybill` box, and **both are
empty** on the copy we hold, while the checklist files `13-May-2026`. So on
three of three sea goldens the filed date is not readable from the transport
document.

**To settle:** find one job where the shipped-on-board stamp is legible and
compare it against its checklist. If the filed date still differs, the date is
coming from somewhere other than the B/L and the rule is wrong, not the reading.

## `Marks_&_Nos` on a re-import

`ex_job3` files `RE-IMPORT OF INDIAN ORIGIN GOODS & RE EXPORTED` and `ex_job4`
files `INV NO-GFLA/RETURN/INVOICE / REJECTED AND RETURNBLE CARGO`. Neither
phrase appears on any document in either job; both are declarations a person
writes, and both jobs are free-of-cost re-imports of Indian-origin goods.

**Interim:** `AS PER BL` remains the sea default, and
`job_boe_header.marks_and_nos` overrides it. Nothing detects a re-import and
prompts for the declaration.

**To settle:** is the phrase formulaic enough to be generated from the shipping
bill and the notification claimed, or is it genuinely per-consignment?

## `NtWt` when no document states a net weight

Logi-Sys' own export for job I-10793 writes `NtWt` as `0.000` with
`NtWtUnitCode` `KGS` — not blank — on a job whose B/L states no net weight.

**Interim:** we write blank and warn. Blank and `0.000` are different claims,
and declaring a net weight of zero is a statement about the goods.

**To settle:** upload one produced workbook and see whether the validator accepts
a blank `NtWt`. Checkable on the next real upload, along with the `CONFIRM:`
question above `PACKAGE_UNITS` about whether Logi-Sys wants `BAG` or the
three-letter ICES form `BGS`.

## Bundled scans

`ex_job7` is a single 13-page PDF holding an invoice, a bill of lading, a packing
list, a certificate of origin, an insurance certificate, a grade certificate and
a certificate of analysis. Until this change the classifier returned one type per
file and six documents' worth of data was discarded silently.

**Interim:** the classifier returns every type it finds, and the pipeline sends
the whole PDF once per type with that type's extraction prompt. N model calls
instead of one; no page splitting.

**To settle:** whether page-range splitting is worth a PDF-manipulation
dependency. Re-reading thirteen pages five times works and costs calls; slicing
would cost a dependency and a new class of bug (a document split across a page
boundary). Not worth deciding until the call cost is actually a problem.

## The valuation dropdown contradicts the export

`INVOICES.Valuation_Method` has two vocabularies and they disagree.

The dropdown, photographed open on the customer's `understanding_this_sheet.xlsx`
(`INVOICES!BD9`), is the Customs Valuation Rules **2007** ladder:

```
RULE 3 (DETERMINATION OF METHOD OF VALUATION)   RULE 8  (COMPUTED VALUE)
RULE 4 (TRANS. VALUE OF IDENTICAL GOODS)        RULE 9  (RESIDUAL METHOD)
RULE 5 (TRANS. VALUE OF SIMILAR GOODS)          RULE 10 (COST AND SERVICES)
RULE 6 (DETERMINATION OF VALUE)                 RULE 11 (DECLARATION BY IMPORTER)
RULE 7 (DEDUCTIVE VALUE)                        RULE 12 (REJECTION OF DECLARED VALUE)
                                                OTH (OTHERS)
```

Eleven entries, and **no transaction-value entry** — correctly, because under
CVR 2007 the transaction value is Rule 3(1) itself. Yet Logi-Sys' own export of
job I-10793 writes `RULE 4 (TRANSACTION VALUE)`, which is the **1988**
numbering, and so does the hand-corrected `final (1).xlsx`. Meanwhile every
checklist Logi-Sys prints renders the field as the single word `Transaction`.

**Interim:** the default is `RULE 4 (TRANSACTION VALUE)` — the string Logi-Sys
emitted itself, and therefore the one it will read back. The eleven dropdown
strings are the operator's set. Both live in `VALUATION_METHOD`
(`packages/core/src/masters/codes.ts`), and `valuationMethod()` deliberately
refuses a bare rule number, because under two schemes "RULE 5" names two
different rules.

**To settle:** upload one workbook carrying `RULE 4 (TRANSACTION VALUE)` and
read the value back off the Logi-Sys invoice screen. If it lands on the
dropdown's Rule 3 or on nothing, the default changes and only that table does.

## `TOI_Place`

ICES field 76, "Terms Place" — the place named after the Incoterm. Invoices
routinely state one ("CIF NHAVA SHEVA", "Ex-Works Taunton, MA") and **every
vendor workbook leaves the column empty**, including ones whose invoice names a
place.

**Interim:** parsed off `deliveryTermsRaw` and written when we read one; never
warned about, so a blank is not reported as a gap.

**To settle:** whether Logi-Sys wants it at all, or resolves the place from the
port of loading. Cheap to check on the next upload.

## The AEO trio on INVOICES

`AEO_Code`, `AEO_Country` and `AEO_Rule` are ICES fields 84–86, and they sit
**after** the third-party block on the invoice table — which reads like the
overseas *supplier's* AEO under a mutual-recognition agreement, not the
importer's. The importer's own AEO is on the BE header (the checklist prints
"AEO Registration No" and "AEO Role" at the top) and
`organizations.aeo_certificate_no` already holds it.

**Interim:** all three stay empty and never warn.

**To settle:** open a Logi-Sys invoice screen on a job with an AEO-accredited
foreign supplier and see which party the fields are labelled for. Filling them
with the importer's certificate when they mean the supplier's would be a false
claim to a preferential channel.

## `Supplier_City`

`liv_job1` — Logi-Sys' own export — folds the city into `Supplier_Address` and
leaves `Supplier_City` empty. The hand-corrected `final (1).xlsx` fills it
(`Singapore`). Ours fills it, following `final.xlsx`, and warns when the invoice
did not state one.

**To settle:** one upload says which the validator prefers. Low stakes either
way — the address carries the city in both readings.

## The itemised miscellaneous heads

`INVOICES` has fourteen `%`/`Amount` pairs (`A - Brokerage and Commissions`
through `N - Unloading Charges`). They are the ICES `MISC_CH` code list
(`BE Message format 2.25` Part 5, codes A–L) plus two Logi-Sys additions, and
ICES wants **one record per charge type** in that table.

We write the aggregate in `Misc_Charge_Amount` and leave all twenty-eight blank,
which is what every vendor workbook and every checklist carries — `ex_job1`
files `Misc. Charges 590.75 USD` with nothing broken out. The customer confirmed
the aggregate.

**To settle:** whether Logi-Sys derives its `MISC_CH` records from the aggregate
alone, or files the invoice-table field with no `MISC_CH` rows behind it. Only
matters if ICES starts rejecting a misc charge with no code against it.

## Free of cost is not readable on every document

`ex_job3` and `ex_job4` are free-of-cost re-imports filed as
`Terms of Payment FOC` / `Nature Of Transaction Free of cost`. `ex_job3`'s
invoice supports that reading — it bills 40,800 USD and states `Payment: N/A` —
and the extraction prompt is told to read that shape as free of cost.
`ex_job4`'s invoice is **a scan with no text layer**, so nothing about the sale
is readable at all, and the eval asserts nothing about it.

**Interim:** `Sale` is the default and the operator switches it. Nothing detects
a re-import and prompts.

**To settle:** the same question as `Marks_&_Nos` on a re-import, above — a
re-import is recognisable from the shipping bill in the folder, and if that is
worth detecting it settles both columns at once.

## ITEMS: which slot a trade agreement files in {#items-sapta-slot}

`ex_job2` (Uganda, DFTP) files `096/2008 (i)` in `SAPTA_Notn` with `Basic_Notn`
empty; `ex_job6` (Japan CEPA) files `069/2011 295` in `Basic_Notn` with `P`.
Logi-Sys' Cust. Duty screen has one "SAPTA Notn." line under the basic duty.

**Interim:** agreements whose concession is a percentage *of the duty* (SAPTA,
APTA, DFTP) go in the SAPTA slot; effective-rate FTA/CEPA tables go in Basic
with `P`. The slot is one field per agreement in `fta-agreements.json`.

**To settle:** ask Sandesh which agreements Logi-Sys expects in the SAPTA line —
in particular SAFTA and the India–Sri Lanka FTA, which no golden carries.

## ITEMS: the rest of the Exim scheme codes — settled {#items-exim-scheme-codes}

The "Exim Scheme" dropdown was photographed scrolled: `01`–`09`, `11`–`15`,
`17`, `18`, `20` were visible and the list continued past the frame.

**Settled from the corpus, not from Sandesh.** The complete Scheme Code
directory is in `data/customs-corpus/icegate-specs/ICES 1 5 Customs - DGFT
Message Formats Version 1 9 (21 07 08).pdf` — the list Customs and DGFT
exchange, and the same domain as `LICENSE` field 15. It runs `00`–`29`,
`41`–`49`, `50`–`56`, `59`, `71`–`76`, `79` and `99`, and it contains all three
codes the photograph cut off (`10` Bulk Licence, `16` Export Licence, `19`
Drawback) as well as `26` DFIA, which `ex_job28` actually files.

This mattered more than a gap in a dropdown: `ex_job28` (`26`), `ex_job27`
(`32`) and `ex_job20` (`RD`) each refused the **whole workbook** at
`map/items.ts`, so three of the four jobs in the corpus that carry a real
licence could not be exported.

**Successor question**, narrower: `32` (Tariff Rate Quota) and `RD` (RoDTEP)
appear in Logi-Sys' own output and in no ICES directory we hold. TRQ and RoDTEP
both postdate the 2008 directory. Are these Logi-Sys-local codes, do they map to
something else on the ICES message, or are they later ICES additions? They are
in `VENDOR_EXIM_SCHEME` with the export that proves each one, kept apart from
the directory so the distinction is not lost.

## ITEMS: IGST exemption type without an exemption

liv_job1 writes `IGST_ExemptionNotnType C` and `IGST_CompCessExemptionNotnType G`
with no exemption notification beside them — the GST screen's defaults leaking
into the export. We write the type only beside an exemption.

**To settle:** one upload with the types blank shows whether the validator
accepts that.

## ITEMS: `AIDC_ExemptionNotn` repeating the levy

liv_job1 files `AIDC_ExemptionNotn 011/2021 17` identical to the levy pair.
11/2021 is both the levy and the exemption notification (it sets the effective
AIDC by exempting the rest), so the repeat may be deliberate.

**Interim:** the exemption pair is written only when the masters name a
separate exemption entry. **To settle:** compare the next vendor export.

## ITEMS: AIDC S.No. 19 and the 06/2025 annexure

11/2021's AIDC serial follows the BCD exemption claimed, not the CTH: S.No. 19
for a claim under a notification in its ANNEXURE, S.No. 17 otherwise. ex_job6's
Japan-CEPA claim (69/2011, an original ANNEXURE row) is filed 19 — reproduced.
But 06/2025 added 24/2005 to the ANNEXURE, so ex_job5's ITA lines read literally
are 19, and Logi-Sys filed 17. Reading the ANNEXURE as it stood before 06/2025
reproduces every filed serial.

**Interim:** `AIDC_ANNEXURE_AS_AT = 2025-02-01` in `item-masters.ts` — the filed
behaviour. Both serials are Nil, so no duty turns on it.

**To settle:** ask Sandesh whether Logi-Sys should be filing 19 for 24/2005
claims; if yes, the constant goes and the ANNEXURE is read on the BE date.

## ITEMS: ex_job6's certificate reads as retroactive

The Japanese certificate on ex_job6 was issued 8 days after the shipment date
read off the documents; 55/2011-Customs (N.T.) treats anything past three days
as retroactive issuance, so the resolver files `COO_Retroactive_Issuance = Y`.
Logi-Sys filed `N`. Either the paper certificate's retroactive box is unticked
and the shipment date used differs (the B/L date is itself disputed — see "Which
date dates a bill of lading"), or the desk files N by habit.

**Interim:** the items panel's "certificate checked, not issued retroactively"
choice files N with the operator's confirmation recorded.

**To settle:** look at Box 8 of the original certificate.

## STATEMENT

Rules and evidence are in `07-statement.md`. Three things the checklists do not
settle:

1. **`PC002`'s scope and conditionality** — both moved to
   [SW_ADDL_INFO: the `PC002` scope](#sw-pc002-scope). The eight Logi-Sys
   workbooks settle the scope (it is the Circular 23/2023 chemical scope, not
   `CHEMICAL_CHAPTERS`' 28–40) and leave the conditionality open.
2. **How `ex_job2`'s document codes were filed.** Were `861000, 911001, 0010DC,
   0110FS, 0110DC` filed as `REM` with text *NA*, as the spec describes, or as
   `DEC`? A Logi-Sys export of that job would show it.
3. **Where Kuberr gets the mandatory-document list for a CTH** (CBIC Compulsory
   Compliance Requirements). Until a master holds it, those `REM` rows are the
   operator's, and the exporter only warns.

Ask Sandesh.

## RE-IMPORT: which entry of 45/2017 when the export claimed several {#reimport-clause}

A shipping bill's Part-I summary sets a flag per scheme, and real ones set more
than one. `ex_job3`'s SB 8942803 has `RoDTEP Y`, `LICENCE Y` and a LUT number in
its marks — three of 45/2017's Sl. 1 clauses — and was filed `1E`. `ex_job29`'s
SB 3250689 has `DBK Y` *and* `RoDTEP Y`, also filed `1E`. One row carries one
entry, and the entry decides which of the six money columns ICES demands and
which it forbids, so this is not a cosmetic choice.

Three readings fit both goldens: the entry with the largest repayment; scheme
(`1E`) taking precedence over reward (`1A`/`1F`); or whatever the importer's
instruction says. `1E` is consistent with all three, so the evidence cannot
separate them.

**Interim:** `packages/exporter/src/map/re-import.ts` blocks until a person
confirms. The candidates, and the reason each is available, come from
`reImportNotificationCandidates`; the panel shows the notification's own words
and the amount each entry demands.

**To settle:** ask Sandesh whether Kuberr has a rule, or whether it is the
importer's instruction every time. If there is a rule, it becomes the proposal's
ranking and the confirmation stays.

**In the corpus dry run** (`apps/web/scripts/corpus-export.mts`) this is
answered mechanically, by the first candidate whose duty is not an amount only
the importer holds — which picked `1E` on `ex_job3` and `5` on `ex_job29`. The
comparison against Logi-Sys' own workbook for `ex_job29` matches on every other
column of the row (SB number, date, port of export, notification) and differs on
the serial alone, which is this question and not a mapping fault.

## RE-IMPORT: what `File_No` is {#reimport-file-no}

Not an ICES field. `<TABLE>REIMPORT` in `BE Message format 2.25` has nineteen
fields and ends at Excise duty; the printed BE's `C. RE-IMPORT AFTER EXPORT`
block has twelve and does not include it. Logi-Sys' own export for `ex_job29`
leaves it empty on a live re-import, and no screenshot in the repo shows the
Re-Import product tab: `06-items.md` captioned
`logi-sys-screenshots/…15.06.45.jpeg` as Re-Import and `…15.07.00.jpeg` as GST,
but those images have the GST and Single Window sub-tabs open. Both captions
were off by one and are now corrected.

Candidates from the notifications themselves: the transit-bond file under
45/2017 Sl. 1(e)(iv), the DEEC/Advance Authorisation file, or the bond file a
158/95 re-import runs against.

**Interim:** written blank, always, and documented as a decision rather than an
omission.

**To settle:** ask Sandesh. Also worth one upload test — the vendor template's
`REIMPORT_NOTN` defined name points at a dead external link
(`[1]Sheet2!$M$7:$M$8`), a two-value dropdown whose domain the template cannot
tell us, and the same upload would settle whether Logi-Sys wants `0.00` or blank
in the money columns.

## RE-IMPORT: no golden has a non-zero amount {#reimport-amounts}

All three re-import goldens (`ex_job3`, `ex_job4`, `ex_job29`) are FOB or EXW
exports filed under Sl. 1 clauses, and every one of their six money columns is
`0.00`. So the Sl. 2 path — goods exported for repairs abroad, where
`Exp._Freight` and `Exp.Insurance` become mandatory and carry IGST as well as
BCD — is built from the notification, Circular 16/2021 and the ICES error codes,
with no example to check it against.

**Interim:** the rules are enforced as blockers either way, so a Sl. 2 filing
cannot go out with the columns empty and a Sl. 1 filing cannot go out with them
filled.

**To settle:** ask for one repair-and-return job with its freight and insurance
certificates, and add it as a golden.

## RE-IMPORT: how a 1990s notification number is spelled {#reimport-old-notn}

`logisysNotn()` produces a three-digit serial and a four-digit year — `045/2017`,
`011/2021` — and every golden is a notification of 2017 or later. 94/96 and
158/95 are the two re-import notifications that predate that, and the trade
writes them with a two-digit year.

`RE_IMPORT_NOTIFICATIONS` holds `094/1996` and `158/1995`, the form consistent
with every other notification column, and `reImportEntry()` accepts either
spelling on lookup. ICES holds `Notification No` in ten characters, so both fit.

**Interim:** the four-digit form is written, and the mapper warns when it writes
one, naming the alternative.

**To settle:** one upload with a 158/95 claim, or one Logi-Sys export of a job
that made one.

## LICENSE: what `License_RefNo` is {#license-refno}

Blank on all four populated vendor exports — eight rows, four schemes, including
three rows that carry the same licence. Not an ICES field either: `<TABLE>LICENCE`
has no reference column. It reads like a Logi-Sys-internal pointer into its own
licence master.

**Interim:** written blank, always, and documented as a decision rather than an
omission — the same treatment as `RE-IMPORT.File_No`.

**To settle:** ask Sandesh whether it is ever non-blank, and what fills it.

## LICENSE: the quantity when one line is split across two licences {#license-multi-licence-quantity}

`ex_job20` debits two RoDTEP scrips against line 1/1 and puts the **whole**
quantity on one row and `0.000` on the other:

```
2609001995  …  1481579.42   74078.97      0.000 KGS
2609002009  …  3617960.04  180898.00  19440.000 KGS
```

The value split is a balance exhaustion, not a pro-rata: the first scrip takes
`74,078.97` — its own remaining duty credit, which is why it is not a round
number — and the second takes the remainder. But which row the quantity lands on
has three readings that one example cannot separate: the row with the largest
debit, the last row, or the row that took the remainder. All three reproduce
`ex_job20`.

**Interim:** the whole quantity goes on the row with the largest value debit,
`0.000` elsewhere.

**To settle:** a second multi-licence job. Until then this is the thinnest rule
in [10-license.md](10-license.md).

## LICENSE: the checklist prints a different item serial {#license-item-serial-print}

`ex_job28`'s Import CheckList prints `Lic Item SNo` **25** for the row whose
workbook cell is **2** — and the broker's allotment advice for the same
shipment also says 2. The workbook is the format authority
([logisys-vendor-export-is-format-authority](README.md)), so the export follows
it, but nobody knows whether `25` is a print bug or a second serial notion.

**To settle:** ask Sandesh, or one more DFIA job.

## LICENSE: whether AIDC and compensation cess belong in the debit {#license-debit-duty-scope}

`DebitDeutyValue` reproduces exactly as `BCD Fg + CVD Fg + IGST Fg`, with SWS
folded into `BCD Fg`. **Every golden has AIDC nil and compensation cess nil**, so
whether a *forgone* AIDC or cess belongs in the figure is untested.

**Interim:** BCD, SWS, CVD and IGST only, and **warn** when a nonzero AIDC or
cess would have been forgone, naming the amount left out.

## LICENSE: a scheme claim on a warehousing BE {#license-on-a-warehousing-be}

ICES error **834** says a warehousing BE carries no licence particulars — the
debit happens on the ex-bond clearance. It does not say whether
`ITEMS.Exim_Code` may still be set on the into-bond filing, or whether the
scheme is claimed only at ex-bond. All four goldens are home-consumption.

**Interim:** no LICENSE rows on a `W` BE, and a **warn** rather than a blocker if
a line still carries a scheme, saying the licence will be debited at ex-bond.

## LICENSE: `ITEMS.Addl_Duty_Flag` and the DEPB table {#license-addl-duty-flag}

`<TABLE>DEPB` (CACHI01 Part 9/24) field 9 is "Whether exemption Required?", and
the spec says it is *"relevant only for import under DEPB Scheme"*. Error **390**
calls it the "Additional Duty Exemption Required Flag". That is probably
`ITEMS.Addl_Duty_Flag`, but no vendor export in the repo populates that column,
so the mapping is an inference from an error message.

**Interim:** left blank, never warned.

## LICENSE: the opening balance of a licence bought part-used {#license-opening-balance}

A transferable DFIA or scrip is routinely bought on the market already
part-debited, and nothing in the documents says by how much. `ex_job28`'s licence
reached this importer through two transfer letters.

**Interim:** `opening_debited_*` is operator-entered with a stated source, and
the balance checks are **skipped with a warn** when nobody has entered one —
because an unchecked balance is honest, and a balance checked against a wrong
opening figure is not.

## LICENSE: row granularity on upload {#license-row-granularity}

Logi-Sys' *checklist* consolidates `ex_job25`'s three lines into one licence row
(`49,500.00 KGS`, one debit); its *workbook* writes three. We follow the
workbook, which is the format authority.

**To settle:** one upload test that Logi-Sys reads three rows back as three.

## SW_ADDL_INFO: the `PC002` scope, and whether it is conditional {#sw-pc002-scope}

Supersedes the earlier question about whether `PC002` drops when CAS and IUPAC
are both known. Two parts, and the first is now settled by the workbooks.

**Scope.** `CHEMICAL_CHAPTERS` is `[28, 40]`, inferred from three checklists.
The eight Logi-Sys workbooks file `PC002` on exactly the lines that carry a
`CTG/CPC` row and on no others — chapters 29 and 39, never 27, 34, 84 or 88 —
which is the Circular 23/2023 scope (`28, 29, 32, 3808, 39`), eight for eight.
`ex_job21` is chapter 34 and files none; `ex_job1`, also chapter 34, files it on
item 1 and not item 2 of the same CTH. The workbooks are the format authority
and the checklist contradicts itself, so the range should become the circular's
scope, shared with [11-sw-addl-info.md](11-sw-addl-info.md) rather than restated.

**Conditionality.** Circular 23/2023 para 4.2 makes the undertaking conditional
on *non-availability* of the data. `ex_job29` and `ex_job23` behave exactly that
way — `CPCPR`, no CAS, no IUPAC, `PC002`. But `ex_job25`, `ex_job28` and
`liv_job1` declare a CAS number **and** file the undertaking that they cannot.
Nothing tells us whether that is defensive practice the CHA wants kept or an
oversight.

**Interim:** file `PC002` on the circular's scope, and **warn** when it is filed
alongside a complete CAS/IUPAC declaration, naming the contradiction. Do not
drop it silently — a missing declaration is an assessment query, and a
redundant one is not.

## SW_ADDL_INFO: the Annexure-A hazardous CTH set {#sw-hazardous-cth-set}

Circular 24/2026 lists 68 goods with their CTHs, and the corpus shows the
`CHR/HZRDS` row is triggered **per CTH, not per chapter** — three chapter-29 BEs
filed after 01.07.2026, only the one on the list carries it. The set is not a
master yet; it has to be transcribed out of
`data/customs-corpus/circulars/24_2026__1003324.pdf`, where several entries
repeat a CTH under different trade descriptions and two are the same description
twice.

**Settled.** `HAZARDOUS_CTHS` in `packages/core/src/masters/data.ts` holds all
51, and `isHazardousCth()` is what the row builder triggers on. A listed CTH
with no answer recorded warns and files no row — the `Y`/`N` is the importer's
declaration, not an inference from the heading. What remains is a screen to
record it on.

## SW_ADDL_INFO: the FSSAI answers, and where they come from {#sw-fssai-codes}

A food or plant line answers four Single Window questions — Storage Condition,
Drug Related Category, Foods & Supplement Proprietry Status, Retail Pre-pack
Food Article — and Logi-Sys files all four. We file none, because the answers
are per line and there is nowhere to record them:

```
I-14303 item 1  17021110  lactose        STCNR    MSC  FC0102  RFAN
I-14303 item 2  35022000  whey protein   STCCT18  AYU  FC0101  RFAN
ex_job3         12074090  sesame         STCNR    —    FC1430  RFAN
                                         + PLC011  PLP003  PCN1172
```

Four open pieces:

1. **Where the answers come from.** A storage condition is on the packaging or
   the supplier's specification; a proprietary status is a fact about the
   product the importer knows. Neither is in any document the pipeline reads
   today. This needs fields on the item, like `chemical` already has.
2. **The code domains.** `FC0101` / `FC0102` / `FC1430` is clearly a structured
   directory and we hold none of it; `STCNR` / `STCCT18` reads as
   "not refrigerated" / "controlled at 18°" but that is an inference from two
   samples. `MSC` / `AYU` likewise — `AYU` is presumably AYUSH, the ministry
   Circular 15/2023 names.
3. **Two qualifiers have no published three-letter code.** "Retail Pre-pack Food
   Article" and "Re-Import Reason" are on the checklists and in neither Circular
   55/2020's Annexure A nor the BE spec, so they are commented out in
   `SW_QUALIFIER_CODE` rather than guessed.
4. **The chapter range.** `ex_job24`'s whey protein is chapter 35, outside the
   2–22 the rule was written for. It is carried as a second rule entry rather
   than by widening a range nothing evidences.

**Interim:** a line in scope **warns**, naming the qualifiers it must answer,
and files none of them. That is worse than Logi-Sys and better than filing a
wrong storage condition on a food consignment.

**Ask Sandesh:** where does the operator get these four answers today, and is
there a screen in Logi-Sys that lists the valid codes?

## SW_ADDL_INFO: a code and a measure on the same row {#sw-plc-measure}

The BE spec says the value goes in "either Code, Text or Msr and **not in more
than one field**", and all fourteen workbook/BE filings agree — every non-`SQC`
row carries `0.000000` and a blank unit. `ex_job3`'s checklist disagrees: its
`Item Category / plant Category / PLC011` row also carries `24000.000000 KGS`.

The same checklist renders "Plant Variety" with an information of `24000` and
"Re-Import Reason" with `SESAMUM INDICM`, which look transposed, so the block
may simply be mis-rendered. Nothing turns on it today — we file no `PLC` row.

**Interim:** the measure stays on the `SQC` row alone, matching the fourteen
filings, and a measurement recorded against a code family is dropped with a
warning rather than written.

## SW_ADDL_INFO: 338 CTHs with no standard unit {#sw-missing-standard-uqc}

Mostly settled. `tariff-first-schedule.json` had no `uqc` for 482 of its 11,864
rows, including `29269090`, which ICES filed as `KGS` on `ex_job17`. The tariff
book covers most of them, so `build-standard-uqc.py` combines the two — the
First Schedule authoritative, the book filling its holes, and never with a
token the book's superscript bug could have produced. 12,435 CTHs resolve and
**338** still have none from either source.

The same comparison turned up a defect in the book's own build worth recording:
`build-tariff-book.py` maps `m2` to `MTS`, which is the UQC for a *metric
tonne*, and `m3` to `MCU`, which is not an ICES UQC at all. 42 and 5 rows
respectively. `standard-uqc.json` refuses both tokens outright, so nothing
downstream can pick them up, but `TariffMaster.unit` still carries them.

**Interim:** a line on one of the 338 is a **blocker**. There is no safe default
for a unit that multiplies a declared quantity, and ICES rejects a wrong one as
**494**.

**To settle:** fix `UNITS` in `build-tariff-book.py` (`m2` -> `SQM`, `m3` ->
`CBM`) so the book stops carrying a weight where an area belongs, and find a
third source for the 338 — none is in any job the repo holds, so nothing is
blocked on it today.

## SW_ADDL_INFO: which table the chemical data belongs in — settled {#sw-constituent-vs-info-type}

Circular 15/2023's Annexure-1 puts the CAS number and IUPAC name in
`SW_CONSTITUENT` (`BE_ITEM_SW_CONST`). Every filing in the corpus puts them in
`SW_ADDL_INFO` as `IDT/CAS` and `PNM/IUP`, ICES accepted all of them, and
section K of all eight processed BEs is empty.

**Settled** by the *Draft Guidelines for Agency-Wise Data Requirements, 29 March
2016* (`data/customs-corpus/icegate-specs/`), which nobody had read. The Drug
Controller's own field list routes the two facts to two tables by part number —
*CAS No. / IUPAC name* to Table 19, which is `SW_ADDL_INFO`, and *Composition of
Finished Formulation/cosmetics* to Table 20, which is `SW_CONSTITUENT` — and
then spells the first one out step by step as `IDT`/`CAS` and `PNM`/`IUP` in
`<Table>BE_Item_SW_Info_Type`. The corpus is not drifting from the circular; it
is following the published mapping, which ICES has honoured for ten years.
`SW_CONSTITUENT` stays unmapped, and [12-sw-constituent.md](12-sw-constituent.md)
records why.

**What would reopen it:** one importer saying its formulation is confidential.
Circular 23/2023 para 4.3 masks section K on the printed BE and section J is not
masked, so `ex_job15`'s `1623-05-8` and `ex_job17`'s `75-05-8` print in clear
today. Nobody has objected. If one importer does, the answer changes **for that
importer alone** — eight accepted filings sit on the other side, so the move
would be a per-tenant switch, never a global one.

## SW_CONSTITUENT: what `Cons_Yield%` means {#sw-const-yield}

ICES field 13, `Constituent Yield Percentage`, `N(6,3)`, mandatory once a row is
sent. **No document defines it.** It is absent from the 2016 agency guidelines,
from Circular 15/2023 and 23/2023, and from SWIFT Quick Referencer v1.7; BE
Message format 2.25 lists it and says nothing more. No populated example exists
anywhere — no vendor export, no processed BE.

**Interim:** the column has no source and the sheet is unmapped, so nothing
depends on it.

**To settle:** the first real ADC composition request will carry a value, or the
ADC's office will say what it wants. Until then this column cannot be filled,
and a plausible-looking number in it is a declaration nobody can defend.

## SW_CONSTITUENT: whether ICES error 874 is live {#sw-const-874}

**874** — *Constituent details are required for Mandatory additional qfr for Cth
but missing* — names the chapter-28/29/32/3808/39 scope, and every filing in the
corpus that carries a `CPC` row on that scope was accepted with section K empty.
(`ex_job23` does not count either way: it is an ex-bond BE, where the segment is
not permitted at all.) Its neighbour **875** — *Not more than 1 constituent details can be
declared for Mandatory additional qfr cth* — caps that same case at one row,
which contradicts Annexure-1's `Constituent 1..4` on its face.

Either 874 is dormant, or the `IDT/CAS` and `PNM/IUP` rows in section J satisfy
it. Nothing in the corpus distinguishes the two, because no filing has ever been
rejected for it.

**Interim:** follow the filings.

**To settle:** a rejection would answer it, which is not a test worth running on
purpose. The cheaper answer is to ask Logi-Sys whether its validator has ever
raised 874, since it validates before transmission.

## SW_CONSTITUENT: whether the ADC has ever asked for a composition {#sw-const-adc-asks}

The one case that makes this sheet real: a finished formulation or cosmetic
referred to the Assistant Drug Controller, where the ADC asks for the
composition. `ex_job17` is an ADC case (`CTG`/`DRC` = `MSC`) and filed none,
because a drum of acetonitrile is a solvent and has no formulation.

**Interim:** the sheet stays in `UNMAPPED_SHEETS`.

**To settle:** ask Sandesh whether any consignment on this book has ever been
asked for an ingredient breakdown by the ADC, and if so what was supplied. That
answer would carry a real `Cons_Yield%` with it, which settles the question
above at the same time.

## SW_CONTROL: the two code directories {#sw-control-domains}

`Control_Type` and `Control_Result` are both `C(17)` and both mandatory, and
**neither has a published directory**. ICES rejects an invalid value in each
(**467** *Invalid Control Code*, **468** *Invalid Control Result Code*), so the
domains exist inside ICES and are in no document we hold — not in BE Message
format 2.25, not in the 260-page SWIFT Quick Referencer v1.7.

The only two values anyone can name — `SEC65` and `SEZ` — belong on
[SEC65_EXBOND_INFO](08-sec65-exbond-info.md) and [SEZ_INFO](15-sez-info.md),
the segment's other two uses. That leaves this sheet with two mandatory coded
columns and no legal value for either.

**Interim:** the sheet stays in `UNMAPPED_SHEETS`.

**To settle:** ask Customs or Logi-Sys for the two directories, or read them off
one accepted filing that carries a control row. No amount of extraction work
closes this; it is a list somebody has to hand over.

## SW_CONTROL: whether this tenant ever files a control {#sw-control-trigger}

No filing in the corpus carries a pre-arrival control — 21 checklists, 31 job
folders, fifteen workbooks, zero rows. The corpus is a sample, and the trade
does file them: a Pre-Shipment Inspection Certificate on metallic waste and
scrap is the likeliest, then fumigation and phytosanitary treatment, then AQCS
veterinary inspection.

Note the spec's own wording — *"inspection … by **authorities**"* — which
excludes a commercial pre-shipment inspection an importer commissioned
privately, however much it looks like one.

**Interim:** unwired.

**To settle:** ask Sandesh whether Kuberr clears metal scrap under PSIC, or
plants or animal products under quarantine control.

## SEZ_INFO: whether this tenant files SEZ Bills of Entry {#sez-info-trigger}

[SEZ_INFO](15-sez-info.md) applies only to a `T` or `M` type SEZ Bill of Entry —
a DTA sale out of a Special Economic Zone, referencing the original `Z` type BE
line by line. Nothing in the corpus is one; every filing is `H`, `W` or `X`.

An SEZ DTA-sale filing starts from an SEZ Online record and a Z-type BE the CHA
did not file, neither of which reaches this system — so this is less a pipeline
gap than a line of business.

**Interim:** unwired.

**To settle:** ask Sandesh. If the answer is never, [15-sez-info.md](15-sez-info.md)
is the whole deliverable and the sheet stays unwired permanently. If it is
sometimes, the `T`/`M` distinction has to be modelled before the first row is
written: on a `T` the keys are this BE's own line serials, on an `M` both are
`0`.

## BONDS_CERTIFICATES: EPCG filed under bond code `EZ` {#epcg-bond-code}

`ex_job26` (I-60133) is an **EPCG** job — its LICENSE sheet carries licence
`0831018385` — and its bond row reads `EZ`, the **EPZ** bond code, not `EC`,
the EPCG one. Both are in the ICES list (spec p.31) and they are different
schemes.

Either the port accepts `EZ` for an EPCG bond, or an operator picked the wrong
entry from a Logi-Sys dropdown and the export carried it through. The filing was
accepted, which proves less than it looks: ICES validates that the bond exists
and is live, and a bond registered as `EZ` would pass under `EZ` whatever the
scheme behind it.

**Interim:** the mapper **proposes** the scheme bond code and does not impose
it — the operator confirms before export.

**To settle:** ask Sandesh which code the Nhava Sheva bond section actually
registers an EPCG bond under.

## BONDS_CERTIFICATES: what certificate type `MS` is {#cert-type-ms}

`ex_job31` files four `C` rows of type **`MS`**, numbered
`NOC/2026/000004873` … `876`, dated 03-Aug-2026 — the four DGCA import NOCs that
also appear on its SUPPORTING_DOCS sheet as doc type `022CO1`.

`<TABLE>CERT` field 9 is `C(2)` and **the spec names exactly one value**, `EI`
for IGCR, while scoping the table to *"BEs having EOU and job items only"* and
describing it as a Central Excise certificate in lieu of a bond. A DGCA NOC is
none of those things, and `MS` is in no list we hold — the obvious reading is
*Miscellaneous*, which is a guess.

**Interim:** `MS` is accepted as an observed value in `CERTIFICATE_TYPES` with
this note against it, and is never proposed — an operator chooses it.

**To settle:** ask Kumarpal Doshi for the certificate-type directory, or ask
Sandesh what Logi-Sys' dropdown calls `MS`.

## SUPPORTING_DOCS: where the eSanchit IRN reaches the operator {#esanchit-irn-source}

`Doc_IRN` and `Doc_Upload_DateTime` are the only two inputs on
[18-supporting-docs.md](18-supporting-docs.md) that no document, master or
extraction can produce. ICEGATE issues them when the signed PDF is uploaded.

Where they arrive decides how they are captured: an ICEGATE acknowledgement mail
would be parsed, a Logi-Sys screen or the eSanchit portal means an operator
pastes them. The difference is a mail rule versus a field on
`document-requests.tsx`.

**Interim:** a document with no IRN warns, naming the file, and files no row.
The rest of the sheet fills.

**To settle:** ask Sandesh how the IRN gets from eSanchit to the person building
the BE today.

## SUPPORTING_DOCS: `Reference_No.` is mandatory to the uploader and blank in the vendor's own exports {#supporting-docs-refno}

ICES marks field 21 optional. Logi-Sys' uploader makes it mandatory — it is one
of the eleven columns on the real `ErrorList.htm`. And Logi-Sys' **own** exports
leave it blank on most rows: `ex_job31` fills it on four of fourteen.

So the vendor's workbook would not pass the vendor's own validator, and copying
vendor output row for row is not sufficient. The spec says what belongs there
for an invoice (the invoice number quoted in `<TABLE>INVOICE`) and says nothing
about anything else.

**Interim:** fill it from the invoice number, the licence number or the
certificate number where the document is one of those, and warn otherwise.

**To settle:** ask Logi-Sys what its validator expects for a document that is
not an invoice, licence or certificate — a bill of lading, a packing list.

## EXCHANGE_RATE: the `Unit in Rs.` a notified rate is quoted per {#exchange-rate-unit}

Some currencies are notified per **hundred** units — `ex_job5`'s checklist
prints *"100 JPY = 60.8000 INR"*. ICES has a field for it (9, `Unit in Rs.`) and
the Logi-Sys sheet has no column, so Logi-Sys derives it from the rate.

`EXCHANGE_RATES` stores the per-unit figure (`JPY: 0.6412`), so our arithmetic
is right. But the workbook then shows `0.641200` where the CBIC notification
says `60.8000`, and an operator comparing the two will read it as an error.

**Interim:** correct as written; recorded here so nobody "fixes" it.

**To settle:** confirm against one accepted filing in a per-100 currency whether
Logi-Sys wants `0.641200` or `60.800000` in `EXCHANGE_RATE`. No such filing is
in the corpus.

## EXCHANGE_RATE: the CBIC rate master is not refreshed {#exchange-rate-staleness}

`EXCHANGE_RATES` (`packages/core/src/masters/data.ts:1432`) holds **one** entry,
effective `2026-06-01`. The notification is fortnightly. `exchangeRatesOn()`
returns that entry for a job filed today without complaint, so every export
converts at whatever rate was last typed into `data.ts`.

This is the largest silent error surface in the workbook — every INR figure on
the Bill of Entry descends from it — and it is invisible because nothing is
missing.

**Interim:** the master's own comment says *"Phase 2 automates this"*.

**To settle:** automate the fortnightly pull, and until then have
`exchangeRatesOn()` **warn** when the effective date it returns is more than a
fortnight behind the filing date, rather than answering silently.
