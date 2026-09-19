# BONDS_CERTIFICATES

**The security the importer has already lodged with Customs, and the
certificates produced in place of one.** The sheet is **two ICES tables merged
into one**: `<TABLE>BOND` (**BE Message format 2.25, CACHI01 Part 10/24**, p.31)
and `<TABLE>CERT` (**Part 11/24**, p.32), discriminated by the first column.

**One row per bond or certificate.** No `Inv_SrNo`, no `Item_SrNo` — both ICES
tables are keyed at Bill of Entry level, so a bond covers the whole filing even
when only one line draws against it.

**Wired**, at `packages/exporter/src/map/bonds-certificates.ts`.

Evidence, in order of authority:

- **Three populated vendor exports** — the only sheet of the seven where
  Logi-Sys' own output settles the format:

  | Job | Row |
  |---|---|
  | `ex_job25/JobData_I-30288_26-27_20260907_164002.xlsx` | `B \| DE \| 2002542921 \| – \| – \| – \| – \| INHZA1` |
  | `ex_job26/JobData_I-60133_26-27_20260907_164152.xlsx` | `B \| EZ \| 2002611612 \| – \| – \| – \| – \| INHZA1` |
  | `ex_job31/JobData_I-20271_26-27_20260911_143243.xlsx` | 4 × `C \| MS \| NOC/2026/00000487n \| 03-Aug-2026 \| – \| – \| – \| –` |

  All three are `H` type — home consumption — so a bond is **not** a
  warehousing-only fact. All three set `GENERAL.IsBondsCertificates = Y`.
- `BE Message format 2.25` — the two field lists, the 25 bond codes, the eBond
  purpose codes, and the IGCR rule.
- `BE_fresh_filing_error_codes_24032026.pdf` — eighteen codes land on this
  sheet, more than on any other of the seven.
- `packages/core/src/masters/index.ts:896` already tells the operator a 158/95
  re-import *"also needs a BONDS_CERTIFICATES row"* and then has nowhere to put
  one. This sheet is where that warning stops being a warning.

---

## `Bond_or_Certificate` is the discriminator

| Value | ICES table | What the rest of the row means |
|---|---|---|
| `B` | `<TABLE>BOND` | a bond **registered with Customs**, drawn against by this BE |
| `C` | `<TABLE>CERT` | a certificate produced **in lieu of** a bond, or a permit ICES wants by number |

The two shapes are visibly different in the vendor's own rows: a `B` carries
type + number + `Registration_Port_Code` and **no date**; a `C` carries type +
number + **date** and no port. That is the ICES field lists exactly —
`<TABLE>BOND` has no date field and `<TABLE>CERT` has no port field.

## The columns

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `Bond_or_Certificate` | — (selects the table) | C(1) | derived |
| 2 | `Bond_Cert_Type` | BOND 8. Bond Code · CERT 9. Certificate Type | C(2), **M** | `master` |
| 3 | `Bond_Cert_No` | BOND 7. Bond Number · CERT 7. Certificate Number | N(10) / C(30), **M** | `document` < `operator` |
| 4 | `Bond_Cert_Date` | CERT 8. Certificate Date | Date, O | `document` < `operator` |
| 5 | `Commissionerate` | — | — | `document` < `operator` |
| 6 | `Division` | — | — | `document` < `operator` |
| 7 | `Range` | — | — | `document` < `operator` |
| 8 | `Registration_Port_Code` | BOND 9. Bond Port | C(6), **M** | `document` < `master` |

Note the width asymmetry on column 3, because it decides the cell constructor:
a **bond number is `N(10)`**, ten digits, and a **certificate number is
`C(30)`**, free text. `ex_job31`'s `NOC/2026/000004873` would not fit a bond
column at all. Both are written with `code()` — a bond number is a digit string
whose leading zeros matter, not an integer.

### 2. `Bond_Cert_Type` — the bond codes

The 25 codes, from spec p.31. This is the domain that belongs in
`packages/core/src/masters/codes.ts`, and nowhere else:

| | | | |
|---|---|---|---|
| `PD` Provisional Duty | `EU` End Use | `RE` Re-Export | `TB` Test |
| `LG` Letter of Guarantee | `UT` Undertaking | `TP` Transshipment | `IT` ITC |
| `WH` Warehouse | `EC` EPCG | `EZ` EPZ | `DE` DEEC |
| `PJ` Project | `CD` Cash Deposit | `EO` EOU | `JB` Jobbing |
| `PI` Project Import | `NB` Common Bond for EP Schemes | `EI` IGCR | `SZ` SEZ |
| `PG` Provisional duty Bond Global for SEZ | | | |

**`EB` is not among them, deliberately.** An eBond is declared by putting its
**purpose code** in this column instead — `D1`, `D2`, `E1`–`E4`, `EZ`, `M1`,
`MZ`, `P1`–`P9`, `PA`, `PB`, `PZ`, `R1`, `R2`, `RZ`, `S1`, `SW`, `W1`–`W9`,
`WA`, `WZ`. ICES has a rejection that says so in as many words: **553,
*Invalid Bond code EB, instead use purpose code***.

**The certificate types have no published list.** `<TABLE>CERT` field 9 is
`C(2)` and the spec names exactly one value — `EI`, for IGCR — while noting the
table is *"valid for BEs having EOU and job items only"* and that the
certificate stands in for a bond from the Central Excise Commissionerate. The
`MS` on `ex_job31`'s four DGCA import NOCs is in no list we hold. It is recorded
as observed, not as understood; see
[open-questions.md](open-questions.md#cert-type-ms).

### 5–7. `Commissionerate`, `Division`, `Range` — the Central Excise address

Blank in all three vendor rows, and the spec says why:

> In lieu of BOND, the importer can produce Certificate from the Central Excise
> Commissionerate.

These three are that Commissionerate's jurisdictional address — the EOU and
job-work case, and the one ICES error **195, *Central Excise Certificate
Required***, exists for. On a `B` row they are meaningless; on a `C` row that is
not a Central Excise certificate they stay blank, which is what `ex_job31` does.

### 8. `Registration_Port_Code`

`C(6)`. The ICES station where the bond is **registered**, which is not
necessarily where this BE is filed — a continuity bond registered at one port is
drawn against at another.

Both vendor bond rows read `INHZA1`, and **both jobs' LICENSE rows carry
`Reg_Port = INHZA1` too**. That is the derivation worth taking: a scheme bond is
registered at the port the licence is registered at, because the two are lodged
together. It is a default with evidence, not a constant — the operator can
override it, and a bond with no licence has no such anchor.

## IGCR needs a `B` row and a `C` row

The spec states it twice, once under each table, and ICES enforces it with seven
error codes:

> **Note 1:** For availing IGCR Benefits, the Importer shall declare the IGCR
> Bond with bond code as 'EI' along with the Bond Number and the port.
>
> For availing IGCR benefits Importer mandatorily declare the **IIN number in
> certificate number column and certificate type as EI**. Certificate Date is
> made optional for IGCR.

So one concession produces two rows:

```
B | EI | <continuity bond number> | –          | – | – | – | <bond port>
C | EI | <IIN>                    | (optional) | – | – | – | –
```

The IIN is the IGCR Identification Number the importer gets on Form IGCR-1.
`masters/index.ts:404` already knows which notification entries are conditional
on the IGCR Rules 2022 (`isIgcrConditional`) — that flag is the trigger for both
rows, and it is why claiming an IGCR concession on ITEMS without these rows is
ICES **511**, *IGCR Claimed but IIN Not Declared*, and filing the rows without
the claim is **512**, the mirror.

**Exactly one IIN per Bill of Entry** — ICES **517**, *Multiple IIN Declared*.

---

## When a row is required

| Trigger | Row | Source |
|---|---|---|
| a **warehousing** (`W`) Bill of Entry | `B` / `WH`, from `InbondExbond.bondNo` | the goods are warehoused against a bond by definition |
| an **IGCR** concession on any line | `B` / `EI` **and** `C` / `EI` with the IIN | spec p.31–32; ICES 511–517 |
| **re-import under 158/95** for repair or reprocessing | `B` / `RE` | `masters/index.ts:896` — the exemption runs against a re-export bond |
| an **Advance Authorisation** licence on LICENSE | `B` / `DE` | `ex_job25` |
| an **EPCG** licence on LICENSE | `B` / `EC` — but `ex_job26` filed `EZ` | see below |
| **project imports** | `B` / `PI` | ICES 826, *Project Imports Bond details not provided* |
| **provisional assessment** (`GENERAL.IsUnderProvisionalAssessment`) | `B` / `PD` | — |
| an **EOU or job-work** filing with a Central Excise certificate | `C`, with Commissionerate / Division / Range | spec p.32; ICES 195 |
| a **DGCA / PGA import NOC** ICES wants by number | `C` / `MS` | `ex_job31`, four aircraft NOCs |
| anything else | no rows; the sheet stays header-only | |

**`ex_job26` is an EPCG job and its bond row reads `EZ`, not `EC`.** `EZ` is the
EPZ bond — a different scheme. This is recorded as observed rather than
corrected: either the port accepts `EZ` for EPCG, or an operator picked the
wrong entry from a dropdown and Logi-Sys carried it into the export. Until that
is settled, the mapper **proposes** the scheme bond code and does not impose it.
See [open-questions.md](open-questions.md#epcg-bond-code).

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `GENERAL.IsBondsCertificates` | `Y` **⟺** this sheet has rows | all three vendor exports; [01-general.md](01-general.md) already promises the derivation |
| `LICENSE` | a licence that requires a bond must find one here | ICES 419, *Bond Required for this Licence*; 425, *Bond No. Required for this licence* |
| `LICENSE.Reg_Port` | equals `Registration_Port_Code` on the scheme bond | `ex_job25` and `ex_job26` both |
| `ITEMS` | an IGCR-conditional notification on any line ⟹ the `EI` pair | ICES 511 / 512 |
| `INBOND_EXBOND.Bond_No` | the warehousing bond is the same bond, declared twice on purpose | ICES wants it on both |
| `RE-IMPORT` | a 158/95 entry ⟹ an `RE` bond | `masters/index.ts:896` |
| `SUPPORTING_DOCS` | the bond and the certificate are themselves eSanchit documents (`165000` for a bond) | a declared bond with nothing uploaded is an assertion |

## What ICES rejects

| Code | Rejection |
|---|---|
| **501** | *Bond Code Invalid* — outside the 25, and not a valid eBond purpose code |
| **502** | *Bond Number Cannot be Null* |
| **503** | *Invalid Bond Number* — not a bond ICES holds |
| **504** | *Bond Not Yet Credited* — registered but unfunded |
| **505** | *Bond Already Expired* |
| **506** | *Bond Already Closed* |
| **507** | *Bond Not Available* |
| **511** | *IGCR Claimed but IIN Not Declared* |
| **512** | *IGCR Not Claimed but IIN Declared* |
| **513** | *IIN Not Available for IGCR Bond* |
| **514 / 515** | *IIN No. is Null* / *Invalid IIN* |
| **516** | *EI Bond not available for IGCR* |
| **517** | *Multiple IIN Declared* |
| **551** | *Certificate Type Invalid* |
| **552** | *Certificate Number/Date Cannot be Null* |
| **553** | *Invalid Bond code EB, instead use purpose code* |
| **195** | *Central Excise Certificate Required* |
| **419 / 425** | the licence-needs-a-bond pair |
| **826** | *Project Imports Bond details not provided* |

Five of those — 504, 505, 506, 507, 503 — are facts about the **state of the
bond inside ICES**, which nothing in this system can see. They are the reason
a bond number is never proposed from a previous job without the operator
confirming it is still live: a bond that was good last month is one of these
rejections this month, and the workbook cannot tell.

## Failure modes

| Condition | Severity | Why |
|---|---|---|
| a warehousing BE with no bond number | **blocker** | the filing is not possible without one; ICES 502 |
| an IGCR concession claimed with no IIN | **blocker** | ICES 511, and the concession is what the duty was computed on |
| a licence on LICENSE that needs a bond, with none here | **blocker** | ICES 419 |
| a 158/95 re-import with no `RE` bond | **warn** | the exemption is the operator's to stand behind; today this is already a warning and stays one |
| a scheme bond code proposed but unconfirmed | **warn** | the `EZ`/`EC` question above |
| `Registration_Port_Code` unknown and no licence to take it from | **warn** | ICES 501 catches it; the operator can key it |
| `Bond_Cert_Date` missing on a `C` row | **warn** | ICES 552, except for IGCR where the spec makes it optional |

## Upstream

`draft.bondsCertificates` is a **boolean** today (`extraction/src/draft.ts:531`)
— the flag with no rows behind it. The rows are new: `draft.bonds:
BondOrCertificate[]`, seeded from `InbondExbond.bondNo` / `bondDate` (which
already exist and already carry the warehouse bond), from the licence rows, and
from the IGCR flag; persisted in `job_bonds_certificates` for the operator, on
the pattern of `job_sec65_finished_goods` + `apps/web/lib/inbond.ts` +
`bond-panel.tsx`, which is the panel this belongs on.
