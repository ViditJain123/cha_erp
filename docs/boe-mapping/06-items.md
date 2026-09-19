# ITEMS

One row **per line of goods, per invoice**. What the goods are, how they are
classified, which notification sets each duty on them, where they were made,
and on what claim of origin.

Implemented by `packages/exporter/src/map/items.ts`, fed by the
`// ---- Items ----` block of `packages/extraction/src/merge.ts`, by the duty
masters in `packages/core/src/masters/` (`items.ts` and the generated
`generated/items/*.json`), by the importer's product master
(`public.product_master`) and by the operator's edits (`public.job_items`,
applied over the draft after every re-read).

The column list, the code domains and every `constant` below come from:

- the customer's annotations on the ITEMS tab of `understanding_this_sheet.xlsx`
  (rows 3–6 — there are no images on that tab);
- Logi-Sys' own product screens, photographed in `logi-sys-screenshots/`
  15.04.07 (General / Exim Scheme), 15.06.09 (Cust. Duty), 15.06.23 (Oth.
  Duties), 15.06.35 (FTA Info), 15.06.45 (GST), 15.07.00 (Single Window).
  The last two were captioned Re-Import and GST here; opening them shows the
  GST and Single Window sub-tabs, so **no screenshot of the Re-Import tab
  exists** — see `09-re-import.md` and the `File_No` open question;
- the vendor's exports — `liv_job1/JobData_I-10793_*.xlsx`, `final (1).xlsx`,
  `logisys-ce9c889d-…xlsx`, `logisys-dbf3530c-…xlsx`,
  `ex_job6/logisys-EP061126-1-20260630.xlsx`;
- the ITEM DETAILS block of the checklists Logi-Sys printed for `ex_job1..6`;
- the ICES specification the sheet renders: `BE Message format 2.25` Part 6
  (ITEMS) and Part 14 (SBEDUTY), and JNCH Public Notice 80/2017 §4 and §18.

## Why this sheet needed dictating

**Most of the sheet was never computed.** Of 127 columns the mapper wrote about
forty, and a third of those were constants in `merge.ts` rather than decisions:
end use `GNX100` on every line, brand `UNBRANDED`, model `NA`, SWS `10`. The
AIDC serial, the SWS and IGST exemptions, health cess, anti-dumping, safeguard,
CVD and tariff values had no data behind them at all.

**One origin claim was applied to every line.** The FTA claim lived on the
draft, not the item, and the Japan CEPA serial `295` — transcribed from one
job's polypropylene — was stamped on every item of every Japanese consignment,
whatever its CTH. A serial names a tariff line in the agreement's schedule; the
same serial on a different CTH is a false declaration.

**A chosen concession exported as standard.** When the notification step picked
a 45/2025 serial it set `Basic_Notn` but no preferential claim, so the row went
out `S` while the duty was computed at the concessional rate.

**Nothing remembered a classification.** "Job memory" was a JSON file on the
web server's disk, written only by the retired `/legacy` approve button, so a
product the operator had classified last week was classified from scratch again.

---

## Sources, precedence, failure

Every column resolves through the five sources in
[README.md](README.md#the-rule-this-exists-to-enforce), later wins:
`document < master < mail < operator`. Per item, the decidable fields record
which source decided them in `DraftItem.sources`, so the items panel can show
what a person has confirmed.

- **blocker** — the export refuses.
- **warn** — the export happens and the operator is told.

---

## 1. `InvSrNo`, `ItemSrNo`

**Source:** `derived`. `InvSrNo` points at the invoice's row on INVOICES;
`ItemSrNo` restarts at 1 within each invoice (ICES field 8, "Item Sr. no. in
Invoice"). STATEMENT uses the same pair.

**Failure mode.** No items at all is a **blocker**.

## 2. `Inbond_InvSrNo`, `Inbond_ItemSrNo`

**Source:** `document` — the into-bond BE, *only on an ex-bond BE*. `0` on every
other BE, which is what every vendor export writes (`constant`, liv_job1,
final (1)). See [open-questions.md](open-questions.md#ex-bond-item-serials).

## 3. `Product_Description`, `QTY`, `Unit`, `Unit_Price`

**Source:** `document` — the invoice line.

`QTY × Unit_Price` must equal the line amount within 0.5%. The classic failure
is a unit conversion that rescaled one side (156.450 MT at 1,207.57/MT is
156,450 KGS at 1.20757/KG): **blocker**.

## 4. `CTH`, `RITC`

**Source:** `document` (an HS code printed on the invoice, COO, B/L or AWB) <
`master` (the importer's product master) < `operator`.

The customer's rule: *"If you are seeing a new description, then we have to ask
the operator to at least scrutinize once that this is the HS code we are using
and these are all the other details. And once the operator confirmed that it is
correct, we have to save it to the master and then eventually when it is coming
back, we have to just use it from the master."*

- The product master is keyed **importer + normalised description**
  (`productDescriptionKey` in `@checklist/core`), per company.
- A hit is used silently, with `sources.ritc = 'master'`.
- A miss — a description this importer has never filed — is a **blocker**
  ("confirm classification") until the operator confirms the line in the items
  panel. Confirming writes the master row: CTH, general description, brand,
  model, end use, Exim scheme and the notification choices.
- `RITC` is the same code as `CTH`. They differ only for goods under a
  restricted-item policy code, which no golden carries.

**Failure mode.** No usable 8-digit code is a **blocker** — the CTH decides the
duty.

## 5. `CETH`

**Source:** `constant` — `NOEXCISE`. Central excise survives only on tobacco
and petroleum made in India; ICES: *"User has to quote NOEXCISE for such
items."* liv_job1 and ex_job6's checklist both say `NOEXCISE`.

## 6. `PolicyPara`, `PolicyYear`

**Source:** `operator`, and only with an Exim scheme ([§10](#10-exim_code-exim_notn-exim_notnsrno)).
Blank otherwise; never warned.

## 7. `General_Description`

**Source:** `master` < `operator`; seeded from the invoice description.

The customer's rule: *"same as column E"* — so the default is the invoice
description as `tradeDescription()` trims it (grade codes stripped). The
product master's confirmed value wins over the seed.

## 8. `Brand`, `Model`

**Source:** `document` < `master` < `operator`.

- **Brand** — *"As per invoice or ask operator"*. The invoice line's brand when
  it prints one; else the product master; else **warn** and offer `UNBRANDED`
  (what every bulk-chemical golden files).
- **Model** — *"As per invoice else NA if blank in invoice"*. The invoice's
  model/grade/part when it prints one, else `NA`. ICES: *"Must be given. If not
  applicable declare as N.A."*; the vendor writes `NA`.

## 9. `End_Use`

**Source:** `mail` < `master` < `operator`, with the importer's default as the
standing instruction.

The customer's rule: *"as per instruction from the importer or else if the
importer has not given any instruction then we have to ask the operator."*

Chain, first answer wins: the operator's edit → the mail thread's instruction
for this job (`MailInstructions.endUse`) → the product master's confirmed end
use for this description → the importer's `organizations.default_end_use_code`
(set by an admin — an importer instruction given once) → **warn**, and the
operator decides.

The domain is the ICES `d_intend_enduse` directory — 46 codes, JNCH PN 80/2017
§18 — in `END_USE_CODES`. `GNX100` (trading) and `GNX200` (manufacture/actual
use) are the two the goldens use.

## 10. `Exim_Code`, `Exim_Notn`, `Exim_NotnSrNo`

**Source:** `operator` (or `mail`).

The "Exim Scheme" dropdown on the General tab — ICES Part 6 field 14, "Item
category (Scheme Code)", and the same domain as the LICENSE sheet's own scheme
code. `EXIM_SCHEME` is now the complete ICES/DGFT directory rather than what a
scrolled screenshot showed, and `VENDOR_EXIM_SCHEME` carries the two codes only
Logi-Sys writes — see [masters.md](masters.md). Blank is the normal import.

**A scheme brings a licence and the LICENSE sheet with it**, and the two sheets
have to agree:

- `Exim_Code` must equal the scheme code of every licence on the line — ICES
  **426**, a blocker.
- `Exim_Notn` / `Exim_NotnSrNo` are present **iff** `Exim_Code` is — ICES
  **330** / **331** / **383**.
- The scheme exemption is claimed **here and not in `Basic_Notn`**, which is
  empty on all four licence goldens. Filing both claims the relief twice.
- `IGST_ExemptionNotn` repeats the scheme notification for an Advance
  Authorisation (`021/2023`) and an EPCG (`026/2023`), and is **blank** for a
  DFIA (`025/2023`), a TRQ and a duty-credit scrip — those do not exempt IGST.
- A line with a scheme and no LICENSE row is ICES **389**; a LICENSE row with no
  item behind it is **423**.

Full contract: [10-license.md](10-license.md).

## 11. `Country_of_Origin`

**Source:** `document`.

*"Same as COO / if no COO then invoice / else ask importer."* The certificate of
origin's country for the line → the invoice's per-line or document origin → the
B/L → **warn**, ask the importer. ISO alpha-2. An uncodable country is a
**blocker** (the column is mandatory and coded).

## 12. `Accessories_Status`, `Accessories_Details`

**Source:** `constant` `0` < `operator`.

ICES field 92: `0` nothing imported with the item; `1` accessories supplied with
it free (then `Accessories_Details` must describe them — **blocker** if blank);
`2` accessories declared as separate items. The customer's rule is `0`.

## 13. `WH_SalePrice_INR`

**Source:** `constant` `0.00` — every vendor export writes it.

## 14. `Standard_Preferential`

**Source:** `derived`. `P` when a preferential claim is made on the line —
an FTA/CEPA concession in `Basic_Notn` ([§17](#17-preferential-origin)) — else `S`.
A 45/2025 concession is a *general* exemption, not a preferential rate, and stays `S`.

## 15. `Basic_Notn`, `Basic_NotnSrNo`

**Source:** `master` — the BCD notification and serial that set the effective
rate.

*"If there is any notification which is valid for that HS code, then we will
put it here … every next time we have to not bother the operator and just put
that by default."*

- An FTA/CEPA claim ([§17](#17-preferential-origin)) with `slot = BASIC` puts its
  concession notification and the serial **for this CTH** from the agreement's
  schedule (`069/2011` `295` on `ex_job6`).
- Otherwise a general exemption the notification step chose — 45/2025, or 24/2005
  for information-technology goods (`ex_job5`: `024/2005` `20` / `23`).
- Otherwise blank: the tariff rate applies with no notification (`ex_job1`,
  `ex_job3`, `ex_job4`).

The serial is the notification's own. A 45/2025 entry with sub-entries files the
sub-entry the goods fall under (S.No. 160 on job I-40127 enumerates four).
A candidate the goods may not qualify for — condition 3 (IGCR), an end-use
restriction — is **warned**, not filed.

## 16. SWS, AIDC, health cess, and the other customs lines

| Columns | Source | Rule |
|---|---|---|
| `SWS_Notn`, `SWS_NotnSrNo` | `master` | The 11/2018-Customs exemption entry for the CTH, when one exempts the surcharge. Blank when SWS applies at 10% (every golden). |
| `AIDC_LevyNotn`, `AIDC_LevyNotnSrNo` | `master` | 11/2021-Customs and the serial covering the CTH. Every golden files it: `011/2021` `17`, and `19` on polypropylene (`ex_job6`). |
| `AIDC_ExemptionNotn`, `AIDC_ExemptionNotnSrNo` | `master` | Only when an exemption notification reduces AIDC. liv_job1 repeats the levy pair here; we do not, until a filing shows it is required. |
| `AIDCNotn_Excise`, `ADICNotnSr_Excise` | `constant` blank | Excise AIDC: petrol and diesel manufactured in India. |
| `CHealthCess_Notn`, `CHealthCess_NotnSrNo` | `master` | *"As per notification"*: health cess on medical devices (Finance Act 2020 s.141) and its exemption notification. |
| `Road_Infra_Cess_Notn`, `…SrNo` | `master` | Road and Infrastructure Cess — motor spirit and diesel only. |
| `NCD_Notn`, `NCD_NotnSrNo` | `master` | *"Take from Notification / else empty"* — National Calamity Contingent Duty (tobacco, crude). |
| `Aggregate_Duty_Notn`, `…SrNo` | `constant` blank | No current levy uses it. |

Each line's flag ([§19](#19-the-flags)) and notification number use Logi-Sys'
spelling, `NNN/YYYY` (`logisysNotn`).

**Failure mode.** A levy notification the masters cannot serial for the CTH
**warns** and leaves the serial blank — never a neighbouring serial.

## 17. Preferential origin

`isFTAbenefitClaimed`, `COO_No`, `COO_Date_of_Issue`, `COO_Issuing_Country`,
`COO_Origin_Criteria`, `COO_Origin_Criteris_Remarks`, `COO_TariffShift`,
`COO_Accumulation_Cumulation`, `COO_Retroactive_Issuance`,
`COO_Direct_Consignment`, `COO_ItemSrNoCert`, `SAPTA_Notn`, `SAPTA_NotnSrNo`,
and `Basic_Notn`/`Standard_Preferential` when the slot is BASIC.

**Source:** `document` (the certificate) + `master` (the agreement) < `mail` <
`operator`.

The customer's rule: *"Trigger is COO / see notification / mail to check if no
COO that if we want to take the benefit or not."* Per **item**:

1. **The agreement.** The certificate's heading and the origin country select
   one agreement in `FTA_AGREEMENTS` (partners, in-force dates, concession
   notifications, rules of origin). Out of force on the BE date: **warn**, no claim.
2. **The serial.** The agreement's schedule must name the item's CTH. No row:
   **warn** "not a concession line under <agreement>", no claim — never the
   serial of another line.
3. **The slot.** `BASIC` agreements (effective-rate tables: Japan, Korea, ASEAN,
   UAE, Oman, UK …) go in `Basic_Notn` with `P`. `SAPTA` agreements (concessions
   stated as a percentage of duty: SAPTA, APTA, DFTP) go in `SAPTA_Notn` — `ex_job2`
   files DFTP `096/2008` `(i)` there. See
   [open-questions.md](open-questions.md#items-sapta-slot).
4. **The certificate fields**, off the COO: number, issue date, issuing country,
   origin criterion coded through the agreement's criterion map, tariff shift,
   cumulation, the item's serial on the certificate.
5. **Direct consignment** — `Y` when the B/L's route matches the agreement's
   direct-consignment rule (no transit country, or transit under the rule's
   conditions). A transit country is written to `Transit_Country`, which ICES
   makes mandatory whenever an FTA notification is claimed.
6. **Retroactive issuance** — the customer's rule, verbatim in intent: *compare
   the COO date with the B/L date. Within the agreement's rule → `N`, nothing to
   think about. Outside it → the certificate must carry the retroactive marking,
   and must have been issued inside the agreement's window with its other
   compliance met; then `Y`. If not, tell the operator it is not compliant and
   the shipper has to be contacted.* The window, the marking and the conditions
   are per agreement (`FTA_AGREEMENTS[].retroactive`); failing them is a
   **blocker** naming the rule and its notification.

**No certificate, but the origin is a partner country** (the sample row on the
customer's sheet: Omani polypropylene, and the India–Oman CEPA in force since
1 June 2026). The item stays `S` / `N`; the draft carries the duty that would be
saved and a drafted mail to the importer asking whether to take the benefit,
which the operator sends. Their answer is a `mail` instruction.

## 18. IGST and compensation cess

| Columns | Source | Rule |
|---|---|---|
| `IGST_LevyNotn`, `IGST_LevyNotnSrNo` | `master` | 9/2025-Integrated Tax (Rate), serial as `<schedule><serial>` (PN 80/2017: *"II3"*). Goldens: `II68`, `I106`, `I67`, `II114`, `II504`. A residual Schedule II match leaves the serial blank. |
| `IGST_LevyNotnFlag` | `derived` | [§19](#19-the-flags) — only when the levy has a specific part; blank for 9/2025's ad valorem rates. |
| `IGST_ExemptionNotnType` | `master` | `C` when the exemption is a Customs notification, `G` when a GST notification (PN 80/2017: *"G by Default; C – customs Notfn."*). liv_job1 writes `C` with no exemption; we write the type only beside an exemption. |
| `IGST_ExemptionNotn`, `…SrNo`, `…Flag` | `master` | The exemption notification and serial covering the CTH, when one reduces IGST. The customer marked these *"On Kumarpal Doshi"*; the type question is settled by the GST screen. |
| `IGST_CompCessNotn`, `…SrNo`, `…Flag` | `master` | 1/2017-Compensation Cess (Rate); S.No. 56 for goods no other serial names. |
| `IGST_CompCessExemptionNotnType`, `…Notn`, `…SrNo`, `…Flag` | `master` | *"Same logic as IGST."* |
| `GST_Comp_Cess_SalePrice_INR` | `operator` | *"Check from rule book"* — only cess charged on retail sale price (tobacco). `0.000000` otherwise, as every vendor export writes. |

## 19. The flags

`IGST_LevyNotnFlag`, `IGST_ExemptionNotnFlag`, `IGST_CompCessNotnFlag`,
`IGST_CompCessExemptionNotnFlag`, `Other_Duty_Flag`.

The customer's note: *"+ - H L — some notification might have this rule that
basic duty plus something from the notification or minus something, or we have
to compare both and tell if one of them is higher or lower."*

That is exactly Logi-Sys' dropdown: every duty line on the Cust. Duty and GST
screens has a `%` box, a Plus/Minus/Higher/Lower dropdown, and an amount-per-unit
box. The flag says how a notification's ad valorem part and specific part
combine — `+` add, `-` subtract, `H` the higher, `L` the lower
(`combineNotnRate`). With no specific part every flag gives the same duty,
which is why the screen defaults to Plus. Other Duties defaults to Higher.

**Source:** `master` — read from the notification's own rate wording ("or Rs. X
per kg, whichever is higher" is `H`).

**Written only when the notification has a specific part**, i.e. when the flag
changes the duty. For a purely ad valorem rate every flag computes the same
thing and the column is left blank: that is what the desk's own hand-filled
sheet does (the sample row on `understanding_this_sheet.xlsx`, and
`logisys-e4a144cd-…`), even though Logi-Sys' export of liv_job1 leaks the screen
default `+` into it.

## 20. Tariff value

`Tariff_Value_Notn`, `Tariff_Value_NotnSrNo`, `Tarrif_Value_Qty`,
`Tarrif_Value_Currency`, `Tarrif_Value_Amount`.

**Source:** `master` — 36/2001-Customs (N.T.) as substituted by the fortnightly
"Fixation of Tariff Value of Edible Oils, Brass Scrap, Areca Nut, Gold and
Silver" notifications, the edition in force on the BE date.

The customer's note: *"Unit ke baare mai samajhna hai how unit is taken."* The
notification fixes a value **per its own unit** — US$ per metric tonne for
edible oils and brass scrap, per 10 grams for gold, per kilogram for silver. So:

- `Tarrif_Value_Amount` = the value per that unit, in its currency;
- `Tarrif_Value_Qty` = the invoice quantity **converted into that unit**
  (156,450 KGS of palm oil at a per-MT value is `156.450`);
- the duty is then computed on amount × quantity at the customs rate, in place
  of the invoice price (`ItemInput.tariffValue`).

Not covered: `0.000` and `0.00`, which is what every vendor export writes.
**Failure mode:** a quantity in a unit that cannot be converted to the
notification's (pieces of gold jewellery against a per-10-grams value) is a
**blocker**.

## 21. Anti-dumping, safeguard, CVD

`ADD_Notn`, `ADD_NotnSrNo`, `CTHSrNo`, `SuppSrNo`, `ADD_Qty`, `ADD_Basis`,
`ADD_%Rate`, `ADD_Currency`, `ADD_AmountPerUnit`, `ADD_AmountUnit`;
`Safeguard_Duty_Notn`, `Safeguard_Duty_NotnSrNo`;
`CVD_Notn`, `CVD_NotnSrNo`, `CVD_Rate`, `CVD_CalculatedOn`, `CVD_ItemSrNo`,
`CVD_SupplierSrNo`.

**Source:** `master` (`TRADE_REMEDIES`) < `operator`.

*"As per safeguard notification"*; ADD and CVD *"same logic as safeguard"*. A
trade-remedy row names a CTH, a country of origin, a country of export, and
often a named producer and exporter; the duty is either a percentage or an
amount per unit.

Match on CTH + origin + export country, then producer (the manufacturer on the
line) and exporter (the seller):

- **One row** → fill it. `CTHSrNo` is the row of the duty table, `SuppSrNo` the
  producer/exporter row. Specific duty: `ADD_Qty` is the quantity in the
  notification's unit, `ADD_AmountPerUnit` / `ADD_AmountUnit` / `ADD_Currency`
  as the notification states. Ad valorem: `ADD_%Rate` with `ADD_Basis` `AV`.
- **A named-producer row and the residual "any other" row** both match → the
  named one when the producer matches by name; otherwise **blocker** listing the
  candidates.
- **No row** → nothing, and nothing warned.

`ADD_Basis` `AV` is the screen's "%age of Assbl. Value"; `CVD_CalculatedOn` `1`
its "%age of Landed Value". liv_job1 writes both on a consignment with no duty —
the screen defaults leaking into the export — and so we write them only beside a
notification.

The zeros (`ADD_Qty 0.000000`, `ADD_%Rate 0.00`, `ADD_AmountPerUnit 0.00000`,
`CVD_Rate 0.00`) are `constant`: every vendor export writes them.

## 22. Other duties under section 3(3)

`Other_Duty_Notn`, `…SrNo`, `Other_Duty_Flag`, `Other_Duty_%Rate`,
`Other_Duty_AmountPerUnit`, `Other_Duty_AmountUnit`, `Duty_Type`,
`Addl_Duty_Flag`, `DUTY_ExemptionType`.

**Source:** `operator`. The SBEDUTY table's catch-all for levies with no column
of their own. The zeros are `constant` (vendor exports); the rest blank unless
the operator fills a line.

## 23. Manufacturer

`MFG_Name`, `MFG_Address`, `MFG_Country`, `MFG_State`, `MFG_PIN`.

**Source:** `document`. *"As per invoice / COO."* The producer the certificate
of origin names → a manufacturer the invoice names → the seller, **warned**
("seller filed as manufacturer — confirm"), which is what `final (1).xlsx` does
(Borouge Pte Singapore on UAE-origin goods). Country from the address;
state and PIN when the address states them.

## 24. `Source_Country`, `Transit_Country`

**Source:** `document` — the certificate of origin's consigned-from and route
boxes, then the B/L. `Source_Country` only when it differs from origin.
`Transit_Country` is **mandatory when an FTA notification is claimed** (ICES
Part 6 note): with a claim and no transit stated, it is the origin country
(*"It can be the same or different than the country of origin"*).

## 25. SVB

`SVBRefNo`, `SVBRefDate`, `SVBCustomHouse`, `SVB_Loading_Basis`,
`SVB_Rate_Assessable`, `SVB_Status_Assessable`, `SVB_Rate_Duty`,
`SVB_Status_Duty`.

**Source:** `master` — `draft.supplierRelationship` (the `supplier_relationships`
table). *"Only in case of relative import party — importer master."* Blank
otherwise, with the two rates at `0.00000` as the vendor writes them.

## 26. `Foc_Item`

**Source:** `document`. *"NCV, no commercial value, FOC, free of charge, value
for customs purpose only — this indicates this to be yes."* `Y` when the invoice
line (or the invoice as a whole) says so, else `N`.

## 27. Previous BE

`Previous_BENo`, `Previous_BEDate`, `Previous_BEIGMNo`, `Previous_BEIGMDate`,
`Previous_BECurrency`, `Previous_BEUnitPrice`, `Previous_BECustomHouse`.

**Source:** `operator`. *"Optional, as per operator."* `Previous_BEUnitPrice`
is `0.000000` when blank (every vendor export).

## 28. `MaterialCode`

**Source:** `operator`; blank otherwise.

---

## The columns that stay empty

| Columns | Why |
|---|---|
| `Aggregate_Duty_Notn`, `…SrNo` | no current levy |
| `AIDCNotn_Excise`, `ADICNotnSr_Excise` | excise AIDC is on Indian-made fuel |
| `Duty_Type`, `Addl_Duty_Flag`, `DUTY_ExemptionType` | only with an operator-entered Other Duty line |

None of these warns.

## What is scored

`packages/extraction/eval/run.ts`, per golden job: item count, `ritc` per item,
AIDC and IGST serials, the FTA agreement and slot (`ex_job2` DFTP in the SAPTA
slot, `ex_job6` Japan CEPA `295` in Basic with `P`), `ex_job5`'s ITA serials.

## Tests

- `packages/exporter/test/items.test.ts` — each rule above against a built
  workbook.
- `packages/core/test/item-masters.test.ts` — the masters: AIDC, SWS, flags,
  tariff-value units, FTA schedule lookups and retroactive windows, trade-remedy
  matching.
- `packages/exporter/test/golden-ep061126-1.test.ts` — `describe('ITEMS')` pins
  `ex_job6`'s row, with serials now resolved from the masters.
