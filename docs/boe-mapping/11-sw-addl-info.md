# SW_ADDL_INFO

The Single Window declaration: everything a participating government agency —
or Customs itself — wants said about a line of goods that the tariff line does
not already say. The sheet is ICES `<TABLE>BE_ITEM_SW_INFO_TYPE`
(**BE Message format 2.25, CACHI01 Part 19/24**, p.40 of the spec in
`data/customs-corpus/icegate-specs/`), and it prints on the assessed Bill of
Entry as **Part IV section J, "SINGLE WINDOW DECLARATION"**, columns
`1.INVSN 2.ITMSNO 3.INFO TYP 4.QUALIFIER 5.INFO CD 6.INFO TEXT 7.INFO MSR
8.UQC` — the eight columns of this sheet, in this order.

**One row per declaration**, keyed `Inv_SrNo` / `Item_SrNo` — the underscore
spelling this sheet shares with STATEMENT, RE-IMPORT and LICENSE, not the
`InvSrNo` of ITEMS. A line carries between one and six rows in the corpus, and
the row count is decided entirely by the line's CTH and what it claims. Nothing
about this sheet is per-job: every trigger is per-line.

Written by `packages/exporter/src/map/sw-addl-info.ts` out of
`ChecklistDraft.singleWindowInfo`, which
`packages/extraction/src/single-window.ts` builds a line at a time. The code
domains are `SW_INFO_TYPE_CODE` / `SW_QUALIFIER_CODE` in
`packages/core/src/masters/codes.ts`; the triggers are
`isChemicalDeclarationCth()` and `isHazardousCth()` in `data.ts`; the unit and
the quantity are `standardUqcForCth()` / `standardQuantity()` in
`standard-uqc.ts`, over a master built by
`packages/core/scripts/build-standard-uqc.py`.

Evidence, in order of authority:

- **Eight ICES-processed Bills of Entry** — section J of the assessed BE, which
  is ICES' own output for a filing it accepted. This is a stronger authority
  than anything else in the repo, and it is the only place we can see what
  Customs actually took: `ex_job12` (I-14214), `ex_job13` (I-60133),
  `ex_job14` (I-30290), `ex_job15` (I-14313), `ex_job16` (I-14168),
  `ex_job17` (I-14149), `ex_job23` (I-14399), `ex_job31` (I-20271).
- **Eight populated Logi-Sys exports** — the format authority for the workbook
  itself: `ex_job20`, `ex_job21`, `ex_job25`, `ex_job26`, `ex_job28`,
  `ex_job29`, `ex_job31`, `liv_job1`. The two sets overlap on **two jobs only**:
  I-60133 is `ex_job26`'s workbook and `ex_job13`'s processed BE (same job, two
  folders — the EPCG licence is in both), and I-20271 is `ex_job31`'s both. So
  of fourteen distinct filings, twelve show one end and two show both.
- The `SINGLE WINDOW - Additional Product Information` block of the Logi-Sys
  checklists (`ex_job25` is the fullest), which is the **only** place the
  prose labels behind the codes are printed.
- `BE Message format 2.25` Part 19/24 for field types and lengths, and
  `BE_fresh_filing_error_codes_24032026.pdf` for what ICES rejects.
- **Circular 55/2020-Customs dated 17.12.2020, Annexure A** — CBIC's own
  info-type × qualifier directory, 35 entries. In the corpus at
  `data/customs-corpus/text/circular.jsonl` (id 1000245, page 5). This is where
  Logi-Sys' UI labels come from, verbatim, down to the trailing full stop in
  *"Chemical Abstract Service registration number."*.
- **Circular 15/2023-Customs dated 07.06.2023** (deferred to 01.10.2023 by
  18/2023), **amended by Circular 23/2023-Customs dated 30.09.2023** — the
  chemical qualifiers, mandatory for bills of entry filed on or after
  **15.10.2023**. Both now in `data/customs-corpus/circulars/`
  (`15_2023__1003162.pdf`, `23_2023__1003180.pdf`).
- **Circular 24/2026-Customs dated 14.05.2026** — hazardous cargo, implemented
  across all formations by **01.07.2026**, with Annexure-A's 68 specified goods
  and their CTHs. `data/customs-corpus/circulars/24_2026__1003324.pdf`.
- JNCH Public Notice 95/2023 (F.No. S/22-GEN-133/2017-18/AM(I)), which
  reproduces the DG Systems advisory and is the only document that states the
  `info_type` / `info_qfr` / `info_code` triple for the chemical category
  outright.
- `data/customs-corpus/index/tariff-first-schedule.json` — the ITCHS standard
  unit per CTH, which is the whole of columns 7 and 8.

---

## Why this sheet needed dictating

It had a mapper, and the mapper was faithful to a draft that was wrong in three
ways. This was not a missing sheet; it was a sheet quietly filing less than half
of what every one of fourteen real filings contains. All three are fixed — what
follows is what was wrong, kept because each one is the reason a rule below is
written the way it is.

**1. The measure was dropped on any line not invoiced in kilograms.** `merge.ts`
wrote the SUQC row's `measurement` and `unit` only `if (item.unit === 'KGS')`.
`sw-addl-info.ts` then turns the absent measure into `0.000000` via
`orElse(qty(...), qty(0))` and leaves the unit blank. So a line invoiced in
`SET`, `UNT`, `MTS` or `NOS` files a Single Window quantity of **zero with no
unit** — ICES **488** (*Info Measurement/UQC is null or Invalid UQC*) and
**493** (*Quantity in SUQC is not available*), a hard reject at filing. Two of
the fourteen filings are exactly this shape, and both are ones we can see
end-to-end: I-60133 (1 `SET` → `1.000000 NOS` in the workbook, `1 NOS` on the
assessed BE) and I-20271 (1 `UNT` → `1.000000 NOS` on each of four invoices).

**2. No chemical rows at all.** Eight of the fourteen filings carry the
`CTG/CPC` category row, and six of those also carry `IDT/CAS` and `PNM/IUP`.
Nothing in the pipeline produced them, and nothing warned that they were
missing. They have been mandatory since 15.10.2023.

**3. The one rule that did exist emitted one line's facts about another line's
goods.** `SINGLE_WINDOW_RULES` had a single entry: chapters 2–22, PGA `FSSAI`,
four rows carrying the info codes `STCNR`, `MSC`, `FC0102` and `RFAN` as
**constants**. The rows never reached a workbook — their qualifiers had no entry
in `SW_QUALIFIER_CODE`, so the mapper dropped every one with a warning the
moment the rule fired — which is the only reason this never went to Customs.

The codes themselves are real; three Logi-Sys checklists print all four. What
is wrong is that they are **per line**, and `ex_job24` proves it on a single
Bill of Entry:

```
I-14303 item 1  17021110  lactose        STCNR    MSC  FC0102  RFAN
I-14303 item 2  35022000  whey protein   STCCT18  AYU  FC0101  RFAN
ex_job3         12074090  sesame         STCNR    —    FC1430  RFAN
                                         + PLC011  PLP003  PCN1172
```

Two lines of one consignment, the same four questions, three different answers:
a storage condition of *not refrigerated* against *controlled at 18°*, a drug
category of `MSC` against `AYU`, a proprietary status of `FC0102` against
`FC0101`. That is the constant-in-code rule this whole directory exists to
enforce, broken in the place it matters most — a wrong storage condition on a
food consignment is a statement about whether the goods are fit to eat.

The rule now names the **questions** and takes the answers from the line. There
is nowhere to record them yet, so a line in scope warns and files none. That is
worse than Logi-Sys, which files all four; it is better than filing the wrong
one. The chapter range is not settled either — `ex_job24`'s whey protein is
**chapter 35**, outside the 2–22 the rule was written for, and is carried as a
second entry rather than by widening a range nothing evidences.

And one thing that is half-built: **ICES makes the origin declaration mandatory
in this table whenever an FTA notification is claimed at item level** (spec
revision 2.7, 14.09.2020). We implement the other half of that same sentence —
`ITEMS.Transit_Country`, documented at [06-items.md](06-items.md) — and not
this half. No vendor export in the repo claims an FTA, which is why it was never
noticed.

---

## The filings this sheet is measured against

Fourteen filings, twenty-two lines. `W` = Logi-Sys workbook, `B` = ICES
processed BE; `WB` is a job where we hold both ends.

```
              src CTH        ch  invoice qty  →  SW rows
ex_job20      W  27101979    27  19440 KGS       SQC 19440.000000 KGS
ex_job21      W  34039900    34  17600 KGS       SQC 17600.000000 KGS
ex_job12      B  48042100    48  3 lines         SQC 25330 / 24820 / 23799 KGS
ex_job16      B  54022090    54  24000 KGS       SQC 24000 KGS
ex_job26/13   WB 84051090    84  1 SET           SQC 1.000000 NOS  →  SQC 1 NOS
ex_job31      WB 88022000    88  1 UNT × 4 inv   SQC 1.000000 NOS × 4
--------------------------------------------------------------------------
liv_job1      W  29171400    29  100000 KGS      SQC 100000 KGS
                                                 CTG/CPC  CPCBB
                                                 IDT/CAS  108-31-6
                                                 PNM/IUP  FURAN-2, 5-DIONE
ex_job15      B  29091990    29  4800 KGS        SQC 4800 KGS
                                                 CTG/CPC  CPCBB
                                                 IDT/CAS  1623-05-8
                                                 PNM/IUP  1,1,1,2,2,3,3-heptafluoro-3…
ex_job17      B  29269090    29  23040 KGS       CHR/HZRDS  N
                                                 SQC 23040 KGS
                                                 CTG/CPC  CPCPR
                                                 CTG/DRC  MSC
                                                 IDT/CAS  75-05-8
                                                 PNM/IUP  ETHANENITRILE
ex_job23      B  29321100    29  4500 KGS        SQC 4500 KGS + CTG/CPC CPCPR
ex_job14      B  39021000    39  24750 KGS       SQC 24750 KGS
                                                 CTG/CPC  CPCBB
                                                 IDT/CAS  9010-79-1 Ethyl
                                                 PNM/IUP  Ethylene Propylene Copoly…
ex_job25      W  39023000    39  5200/15125/     per line: SQC + CPCBB
                                 29175 KGS                + CAS + IUP
ex_job28      W  39021000    39  59800/39200 KG  per line: SQC + CPCBB
                                                          + CAS + IUP
ex_job29      W  39046990    39  3450 KGS        SQC 3450 KGS + CTG/CPC CPCPR
```

Two things fall straight out of that table, and both are load-bearing.

**The `CHR/SQC` row is on every line of every filing, without exception** —
twenty-two of twenty-two, across eight chapters, seven importers, and all three
BE types (home consumption, warehousing, ex-bond). It is the only row family
with no trigger. I-60133 also shows it surviving the round trip: `1.000000 NOS`
in the workbook, `1 NOS` on the assessed BE.

**The chemical rows appear on chapters 29 and 39 and on nothing else** —
never on 27, 34, 48, 54, 84 or 88. That is exactly the scope of Circular
23/2023 (`28, 29, 32, heading 3808, chapter 39`), fourteen for fourteen, with
no exception in either direction. The rule does not have to be inferred from the
data; the data confirms the circular.

---

## The columns

| # | Column | ICES field | Source |
|---|---|---|---|
| 1 | `Inv_SrNo` | 7, key | derived |
| 2 | `Item_SrNo` | 8, key | derived |
| 3 | `Info_Type` | 9, **M** | `master` — decided by the row family |
| 4 | `info_Qualifier` | 10, **M** | `master` — decided by the row family |
| 5 | `Info_Code_Description` | 11, O | `master` per family, else blank |
| 6 | `Information` | 12, O | `document` < `mail` < `operator` |
| 7 | `Measure` | 13, O | derived — the line's quantity in the standard unit |
| 8 | `Measure_Unit` | 14, O | `master` — the ITCHS standard UQC of the CTH |

Note the header spelling: `info_Qualifier` has a lower-case `i`, and the writer
resolves columns by exact header text. `Info_Code_Description` holds a *code*,
not a description — `CPCBB`, `MSC`, `N` — and the column name is Logi-Sys',
not ICES'.

The spec states one rule that governs columns 5–8 jointly:

> The Value is to be provided in either Code, Text or Msr and **not in more
> than one field**.

ICES enforces it with **456**, **458**, **460** and **489** (*Info Text is not
required for this info qualifier*). Which of the three a family uses is fixed
per family and is not a choice.

## 1–2. `Inv_SrNo`, `Item_SrNo`

**Source:** derived — the line's own `invoiceSrNo` and `slNo`, never its
position in an array. `ex_job31` is the case that proves it matters: four
invoices, each with one item, each with its own `SQC` row at `Item_SrNo 1`.

Zero, null or negative is **451/452**, **462/463**, **465/466** or **473/474**
depending on which table ICES is walking; a row whose line does not exist is
**461** (*Item table details are not available for SW info*) or **497** (*Item
missing for SUQC details*). All blockers.

Two families invert this and are the only exceptions: hand-carriage `HAC` rows
take `Item_SrNo 0` (**918**) and `Inv_SrNo 0` (**917**), and the SEZ `CBW` row
takes zero for both (**941/942**). We file neither today.

## 3–4. `Info_Type`, `info_Qualifier`

**Source:** `master`, and never the operator's typing.

ICES field 9 is a 3-character code from the `d_info_type` directory. The spec
names six values and the corpus adds three more that only appear in later
sections of the same document:

| Code | Meaning | In our corpus |
|---|---|---|
| `IDT` | Item identification | `IDT/CAS` on six filings |
| `CTG` | Item category | `CTG/CPC` on eight filings, `CTG/DRC` on one |
| `CHR` | Item characteristics | `CHR/SQC` on all 22 lines, `CHR/HZRDS` on one |
| `PNM` | Product name | `PNM/IUP` on six filings |
| `PEC` | PGA exception category | not seen |
| `ORC` | Origin criteria | not seen — see the FTA family below |
| `DTY` | ADD/CVD/SGD declaration, SEZ `M`-type only | not seen |
| `SEZ` | Authorised person, bonded-warehouse movement | not seen |
| `HAC` | Hand carriage | not seen |

Field 10 is the qualifier, 100 characters, from `d_info_qfr`. Neither directory
is published as a file anywhere reachable; **Annexure A of Circular 55/2020 is
the closest thing to it that exists in the open**, and it is what
`SW_QUALIFIER_CODE` should be built from rather than from the four labels one
export happened to show:

```
CHR  SQC  Statistical Unit Quantity Code for Customs      CTG  GRA  Grade of the Product
CHR  SEX  Sex                                             CTG  PLC  Plant Category
CHR  BRD  Breed                                           CTG  PLP  Plant Parts
CHR  CLR  Colour                                          CTG  DRC  Drug Related Category
CHR  PLV  Plant Variety                                   CTG  FSP  Foods & Supplement Proprietry Status
CHR  STT  Storage Temperature                             ORC  COO  Country of Origin
CHR  STC  Storage Condition                               ORC  ORG  Origin Criteria
IDT  PAS  Animal Passport Number                          ORC  ACM  Accumulation
IDT  ECI  Electronic Component Identification Number      ORC  WP   Wholly Obtained or Produced
IDT  GTI  Global Trade Item Number                        ORC  VA   Value Added
IDT  VIN  Vehicle Identification Number                   ORC  PS   Product Specific Rules
IDT  MIC  Microchip number inserted into an animal        PNM  PET  Pet Name
IDT  CAS  Chemical Abstract Service registration number.  PNM  SCI  Scientific Name
PNM  COM  Common Name                                     PNM  MOD  Name of the model
PNM  CON  Trade or Commercial Name                        PNM  IUP  Name as per the IUPAC Nomenclature
PNM  PHA  Name as contained in a Pharmacopeia             PNM  INN  International Non-proprietary Name
PNM  PCN  Plant Commodity Name                            PNM  LSP  Name of the Livestock product
PNM  SIU  SIMS Unique Reference Number
```

Three qualifiers in our own evidence are **not** in that annexure — `CPC`
(Circular 23/2023), `HZRDS` (Circular 24/2026) and `SIU`'s companion codes — so
the annexure is a floor, not a ceiling. An unmapped label is **453** / **454**
(*Invalid Info Type / Info Qualifier Code*).

The existing all-or-nothing rule stays: a label with no code is **dropped with a
warning**, never written through. That is right for an optional family and
wrong for a mandatory one, so it needs one refinement — a dropped `SQC` row is a
**blocker**, because the line cannot be filed without it.

## 5. `Info_Code_Description`

**Source:** `master` on the families that use a code (`CPC` → `CPCBB` /
`CPCFM` / `CPCPR`; `DRC` → `MSC`; `HZRDS` → `Y`/`N`; `ORC/COO` → the issuing
country code), blank on the families that use text or a measure.

Written with `code()`, never `text()`: every value in this column is a token in
a directory, and `CPCBB` is the sort of thing a spreadsheet will not damage but
a future numeric-looking code would be.

An unknown value is **455** (*Invalid Info Code*); a code on a family that does
not take one is **460**; a missing one on a family that requires it is **499**
(*Mandatory Info Code details are missing*).

## 6. `Information`

**Source:** `document` < `mail` < `operator`. 100 characters, hard.

The free-text payload: a CAS number, an IUPAC name, a certificate number and
date joined by `|`. Null where the family requires it is **457**; present where
the family does not take it is **489**.

Two observations from the corpus that are about data quality rather than
mapping, and both belong in the operator's face rather than in a silent cell:

- `ex_job25`, `ex_job28` and `ex_job14` all file `IDT/CAS` = **`9010-79-1
  Ethyl`** and `PNM/IUP` = **`Ethylene Propylene Copolymer`**. The CAS value is
  a CAS number with the first word of the name stuck to it, and it is the same
  string on three jobs — it has been copied forward. Worse, `ex_job28` and
  `ex_job14` are CTH **39021000**, *polypropylene*: 9010-79-1 is the registry
  number for an ethylene-propylene copolymer, which is **39023000**. The CAS
  number and the tariff line contradict each other on two filed Bills of Entry.
  A CAS number that does not match the CTH is worth a warning; it is a
  misdeclaration of what was imported, and it is the kind of thing an assessing
  officer looks at.
- `ex_job14`, `ex_job15` and `ex_job17` print **`ADDQFR`** in section J's INFO
  TEXT column on the `CTG/CPC` row. No Logi-Sys workbook writes it — `ex_job25`
  and `ex_job28`, the same importer and the same product as `ex_job14`, leave
  `Information` blank on that row. It is added downstream of the workbook, so
  **we write blank** and do not try to reproduce it.

## 7–8. `Measure`, `Measure_Unit`

**Source:** derived, into a `master` unit. These two columns are the whole of
the `SQC` family and are blank-or-zero on every other family.

The spec is unusually direct about what they mean:

> The following values needs to declared in the Single Window Declaration for
> every item for SUQC — Info_type: `CHR`, Info_Qualifier: `SQC`, **Info_msr: to
> be declared as per tariff UQC**, **Info_uqc: UQC declared should be as that of
> UQC in ITCHS for that CTH**.

So `Measure_Unit` is not the invoice unit and not `ITEMS.Unit`: it is the
standard unit the First Schedule prints against that eight-digit CTH, which we
already hold in `tariff-first-schedule.json`. The tariff writes it in its own
notation; the mapping to the ICES UQC is:

| Tariff | ICES UQC | Rows in the schedule |
|---|---|---|
| `kg` | `KGS` | 7,670 |
| `u` | `NOS` | 2,553 |
| `m2` | `SQM` | 829 |
| `m` | `MTR` | 176 |
| `l` | `LTR` | 66 |
| `m3` | `CBM` | 57 |
| `g` | `GMS` | 19 |
| `cm` | `CMS` — **unconfirmed**, `CMS` is not in `VALID_UQC` | 12 |
| *(absent)* | — | 482 |

All fourteen filings agree with it, including the ones that make the point:
`84051090` and `88022000` are `u` in the tariff and file **`NOS`** while the
invoice says `SET` and `UNT`.

Two consequences the mapper has to honour:

- **`normalizeUqc()` must not be used here.** It falls back to `NOS` for
  anything it does not recognise, and its `VALID_UQC` contains `SET`, `PRS`,
  `BGS` and `ROL` — packaging units that are legitimate item UQCs and are never
  a tariff standard unit. A silent `NOS` in this column is **494** (*SUQC wrong
  from the CTH/item*), and the same guard `10-license.md` puts on the licence
  unit applies verbatim.
- **The First Schedule parse has 482 holes, and one of them is in the corpus.**
  `29269090` — `ex_job17`'s acetonitrile — comes back `None`, and ICES filed it
  as `KGS`. The tariff book covers it, so the master is built from both:
  `packages/core/scripts/build-standard-uqc.py` takes the First Schedule as
  authoritative and lets the book fill its holes, **but never with a token the
  superscript bug could have produced**. 12,435 CTHs resolve; 338 have no unit
  from either source, and a line on one of those **blocks** rather than
  guessing. There is no safe default for a unit that multiplies a declared
  quantity.

  The precedence is that way round because of what the disagreements look like.
  The book is an OCR'd scan that loses the superscript in `m2`/`m3`, and its
  build maps `m2` to **`MTS` — the UQC for a metric tonne**:

  ```
  first schedule -> book    rows   what happened
  SQM -> MTR                 238   m2 rendered as m', read as a plain metre
  SQM -> MTS                  42   an area declared as a weight
  CBM -> MTR                  38   m3 rendered as m', read as a plain metre
  GMS -> KGS                  16   g read as kg
  CBM -> MCU                   5   MCU is not an ICES UQC at all
  ```

  829 tariff items are `SQM` and 57 are `CBM`. Had the book won, every one of
  them would have filed an area or a volume as a length or a weight.

`Measure` is the line's quantity expressed in that unit. **No filing in the
corpus exercises a numeric conversion** — every one of the twenty-two lines is
either already in the tariff's unit (all the `kg` lines) or a rename of a count
(`SET`→`NOS`, `UNT`→`NOS`, value unchanged). So the conversion rule is written
down here and is untested against a real filing, which is exactly why it must
refuse rather than approximate:

- identical units, and count-to-count between `NOS`/`SET`/`UNT`/`PCS`: identity.
- weight to weight: through `weightToKg()`.
- everything else — weight to count, anything through a volume or an area:
  **blocker**. Nothing in the system holds a density, a pack size or a
  thickness, and ICES rejects the result as **495** (*Invalid Standard
  Quantity*) if we are lucky and accepts a wrong quantity if we are not.

Written with `qty()` (6dp), which is what every vendor row shows
(`19440.000000`). On every family other than `SQC`, Logi-Sys writes
`0.000000` with a blank unit rather than leaving the cell empty — the existing
`orElse(qty(row.measurement), qty(0))` is correct and stays.

---

## The row families

A family is a trigger plus a fixed shape. This is the part of the sheet that is
actually a rule set, and each one below states what fires it, where its values
come from, and what happens when we cannot fill it.

### SQC — the standard quantity. Every line, no exception.

```
Info_Type CHR   info_Qualifier SQC   code (blank)   text (blank)
Measure   <qty in tariff unit>       Measure_Unit <ITCHS UQC>
```

**Trigger:** every line of every Bill of Entry. Twenty-two for twenty-two.

**Failure:** blocker. Absent is **486** (*Single Window Details Missing*),
**493** or **497**; wrong unit is **494**.

### CPC / CAS / IUP — the chemical declaration. Chapters 28, 29, 32, 3808, 39.

```
Info_Type CTG   info_Qualifier CPC   code CPCBB | CPCFM | CPCPR
Info_Type IDT   info_Qualifier CAS   text <CAS registry number>
Info_Type PNM   info_Qualifier IUP   text <IUPAC name>
```

**Trigger:** the line's CTH is in chapter **28**, **29**, **32** or **39**, or
is heading **3808**. Mandatory for every BE filed on or after **15.10.2023**
(Circular 23/2023, amending 15/2023 para 4.1–4.4). Chapter 38 outside 3808 was
in the original circular and was **removed** by the amendment — a line in
`38170011` or `38249900` is *not* in scope, and reading "chapters 28, 29, 32,
38 and 39" off the 2023 original is the easy way to put chemical rows on a line
that must not carry them — **877** / **931** (*Invalid declaration of mandatory
additional qualifier*).

The three category codes, from the DG Systems advisory reproduced in JNCH PN
95/2023:

| `info_code` | Category | What else the circular then requires |
|---|---|---|
| `CPCBB` | Bulk and Basic Chemicals | CAS number **and** IUPAC name |
| `CPCFM` | Formulations and Mixtures | CAS **and** IUPAC of the main/active ingredient, at least one ingredient |
| `CPCPR` | Proprietary component, R&D or Others | CAS **or** IUPAC of the main/active ingredient, at least one |

The corpus carries `CPCBB` (`liv_job1`, `ex_job14`, `ex_job15`, `ex_job22`,
`ex_job25`, `ex_job28`) and `CPCPR` (`ex_job6`, `ex_job17`, `ex_job23`,
`ex_job29`). `CPCFM` is attested only by the advisory and does not appear in
any filing we hold — which is worth remembering before treating the absence of
a code as evidence it is not used.

`ex_job6` and `ex_job22` are checklists rather than workbooks, so they sit
outside the fourteen-filing count above; both are chapter 39, and both agree
with the scope.

**Source:** the category is an `operator` decision with a `master` proposal —
it is a statement about what the goods *are*, and no document on a job says it.
The CAS number and IUPAC name are `document` (a certificate of analysis or
safety data sheet, which `ex_job21` and `ex_job1` show is routinely on the job
already) < `master` (a previous confirmed declaration for the same
`productDescriptionKey` and importer) < `operator`.

**Failure:** **874** (*Constituent details are required for mandatory
additional qfr for CTH but missing*), **876** (*IUPAC name or CAS number is
mandatory*), **877** / **931** (*Invalid declaration of mandatory additional
qualifier*), **484** / **485** / **499** for a missing type, qualifier or code.
A chapter-39 line with no `CPC` row is a BE that will not file.

**It warns rather than blocks, for now.** The category is an operator decision
and there is no screen to make it on yet, so blocking would refuse every
chemical job outright and leave nobody a way to fix it. The warning names the
three codes and says ICES rejects the BE without one, which is what the `warn`
vocabulary is for — "a column we would have liked to fill and could not; the
export happens and the operator is told". It becomes a blocker the day the
field exists. Same for the per-category CAS/IUPAC obligation, which warns and
names `PC002` as the way out.

Two of the corpus rows are internally coherent in a way worth copying.
`ex_job29` declares `CPCPR` with **no** CAS and **no** IUPAC row, and files
`PC002` on STATEMENT — which is precisely the circular's design: the
proprietary category, plus the self-undertaking that the ingredient data is
withheld. `ex_job23` does the same. The `CPCBB` jobs declare both, as they must.

#### Why the CAS and IUPAC rows are here and not on SW_CONSTITUENT

Circular 15/2023's Annexure-1 puts the chemical data in a **different table** —
`Constituent 1..4`, element name = IUPAC, element code = CAS — which is
`SW_CONSTITUENT`, ICES `BE_ITEM_SW_CONST`, section K of the printed BE.

They belong here. The Drug Controller's own field list in the 2016 agency-wise
guidelines routes the two facts to two tables by part number — *CAS No. / IUPAC
name* to Table 19, which is this sheet, and *Composition of Finished
Formulation/cosmetics* to Table 20, which is not — and all eight filings in the
corpus do exactly that. The argument, the evidence and the one cost it carries
(Circular 23/2023 masks section K, so a CAS number filed here prints in clear)
are set out in [12-sw-constituent.md](12-sw-constituent.md).

### HZRDS — hazardous cargo. Annexure-A CTHs, from 01.07.2026.

```
Info_Type CHR   info_Qualifier HZRDS   code Y | N   text <mandatory when Y>
```

**Trigger:** the line's CTH appears in **Annexure-A of Circular 24/2026**, a
list of 68 goods compiled with Mumbai Customs Zone-II (NAC Chemicals), spanning
chapters 28, 29 and heading 3808. Implemented across all formations by
01.07.2026.

The corpus settles the trigger exactly, which is worth spelling out because the
circular's own wording ("if the goods being imported fall under the
corresponding Chapters mentioned in Annexure-A") reads as if it were
chapter-wide:

| Job | CTH | On Annexure-A? | Filed | Filed after 01.07.2026? |
|---|---|---|---|---|
| `ex_job17` | `29269090` | **yes** — sl. 19, ACETONITRILE | `CHR/HZRDS N` | yes, 13.08.2026 |
| `ex_job15` | `29091990` | no (the list has `29094990`, `29093090`) | — | yes, 01.09.2026 |
| `ex_job23` | `29321100` | no (the list has `29321300`, `29321990`) | — | yes, 07.09.2026 |
| `liv_job1` | `29171400` | **yes** — sl. 32, MALEIC ANHYDRIDE | — | no, FY 25-26 |

Three chapter-29 Bills of Entry filed after the mandate, and only the one whose
CTH is on the list carries the row. It is **per-CTH, not per-chapter**, and a
chapter-wide rule would have put a spurious row on two accepted filings.
`liv_job1` is the control in the other direction: a listed CTH, no row, and a
job that predates the mandate.

**Source:** the trigger is `master` (the Annexure-A CTH set, which needs adding
— see open questions); the `Y`/`N` is an **operator** declaration, because it is
a statement the importer makes and not a fact about the tariff. `ex_job17`
declared `N` for acetonitrile, which is the operator's answer to give and not
ours to second-guess; what we owe them is the question, asked on the right
lines.

**Failure:** **869** (*Invalid declaration of infotype*) and the
mandatory-qualifier family. Not yet observed as a rejection.

`HAZARDOUS_CTHS` holds all 51, transcribed from the circular in the corpus at
`data/customs-corpus/circulars/24_2026__1003324.pdf`. A listed CTH with no
answer recorded **warns** and files no row: the `Y`/`N` is the importer's
declaration, and inventing either one of them is worse than declaring nothing.

### ORC — origin, whenever an FTA notification is claimed. Not built.

```
Info_Type ORC  info_Qualifier COO           code <issuing country>  text <COO no>|<ddmmyyyy>
Info_Type ORC  info_Qualifier COWO | CONWO  code COOG | COOP        text <VA %> | NA    uqc CC|CTH|CTS|NA
Info_Type ORC  info_Qualifier ACM           code Y | N
Info_Type ORC  info_Qualifier RIS           code Y | N
Info_Type ORC  info_Qualifier DC            code Y | N
```

**Trigger:** an FTA notification claimed at item level. The spec says so twice —
revision 2.7 (14.09.2020) and again in the Part 19/24 notes: *"Whenever FTA
notn is claimed at the item level, following things are mandatory in
sw_info_type table"*. The Korea online-COO variant appends `|Itemslno` to the
COO text.

**Source:** all of it is `document` — `DraftCertificateOfOrigin` already holds
`certificateNumber`, `issueDate`, `issuingCountry`, `originCriterion` and
`issuedRetroactively`. Three facts it does not hold are `ACM` (accumulation),
`DC` (direct consignment) and, for `CONWO`, the value-added percentage or the
tariff-shift rule — those are printed on the certificate and are not extracted
today.

**Why it is still not built:** no vendor export or processed BE in the repo
claims an FTA, so there is no golden, and the spec carries two variants of the
origin-criteria row (the 2.7 original's `ORC/ORG`, and 2.11's `COWO`/`CONWO`
pair, added "along with the Existing") without saying which is current.
Emitting an invented shape into a code column is the one thing this sheet must
not do.

**And Logi-Sys does not file them either.** Two jobs in the repo claim a
preferential notification at item level, and neither prints a single `ORC` row
in its checklist's Single Window block:

| Job | Notification | What its Single Window block carries |
|---|---|---|
| `ex_job6` | `069/2011` sl. 295, India–Japan CEPA, BCD 0% | `SQC`, `CPC` = `CPCPR`, `CAS`, `IUP` |
| `ex_job22` | `046/2011`, ASEAN–India, CTH 39021000 | `SQC`, `CPC` = `CPCBB` |

That is not permission to skip them — ICES says twice that they are mandatory
when an FTA notification is claimed, and a checklist is the weakest authority in
this directory. It does mean the gap is the vendor's too, so closing it is an
improvement on Logi-Sys rather than catching up to it, and it removes "Logi-Sys
must know something we do not" as an explanation. The exposure is real and one-sided: `ex_job6` claims
India–Japan CEPA under `069/2011`, and a BE like it would file
`ITEMS.Transit_Country` correctly and then be rejected for the missing origin
rows — **879** (*Invalid COO document number and date*), **888** (*COO
certificate no. already used in some other BE*), **889** (*Item sequence not
available for COO*), **890** (*COO UQC not matching with item UQC*).

**Interim, until a golden exists:** the family is specified here and emitted
behind a **warn** naming every field it filled and every field it guessed at,
so the first FTA job through the system is checked by a person before it goes
to ICES rather than after.

### DRC — drug-related category.

```
Info_Type CTG   info_Qualifier DRC   code MSC | AYU | …
```

Three occurrences, and between them they rule out every simple trigger:

| Job | CTH | ch | code |
|---|---|---|---|
| `ex_job17` (processed BE) | `29269090` acetonitrile | 29 | `MSC` |
| `ex_job2` / `ex_job24` item 1 | `17021110` lactose | 17 | `MSC` |
| `ex_job24` item 2 | `35022000` whey protein concentrate | 35 | `AYU` |

Not a food qualifier — a pharmaceutical solvent carries it. Not a chapter
range — 17, 29 and 35. And not a constant, because two lines of the *same Bill
of Entry* answer it differently. `AYU` is almost certainly AYUSH, which is the
Ministry the whole additional-qualifier programme was agreed with (Circular
15/2023 para 2), so the domain is at least `{MSC, AYU, …}`.

It is also the trigger for `DC007` on STATEMENT
([07-statement.md](07-statement.md)) via `declarationStatements`' `drug-category`
rule, which matches on the qualifier label — so getting this family's trigger
right moves a declaration on another sheet.

**What we do not know** is the rest of the `d_info_code` domain, or what selects
a value. Nothing published names it, and CDSCO's own SWIFT documentation does
not list it. **Interim:** emit a code only when a person has chosen it, warn
otherwise, and never infer a drug category from a CTH.

### The families we do not file, recorded so they are not rediscovered

| Family | Shape | Trigger |
|---|---|---|
| SIMS | `PNM`/`SIU`, code `SIUNAPL`, text `STL<num>/<DDMMYYYY>`; `SIUNAF` + `SIUN000` for air; `SIUNRR` + `SIUN000` for returnable racks | steel CTHs listed in the SIMS notification |
| CAVR, stainless steel | `CTG`/`GRA`, code `J3`, or code `OTH` + the grade as text | `72191200`, `72191300`, `72191400`, `72192390`, `72193290`, `72193390`, `72193490`, `72193590`, `72199012/13/90`, `72202029`, `72202090`, `72209029`, `72209090` — and `UQC` of `KGS` is mandatory on those lines |
| CAVR, linear alkyl benzene | — | `38170011`, `UQC` of `KGS` mandatory |
| MeitY CCDC | `CHR`/`CCDC`, code `MEITY`, text `<CCDC no>|<ddmmyyyy>|<item slno>` | notification `050/2017` sl. no. **237** claimed at item level |
| ADD / CVD / SGD | `DTY`/`ADD`\|`CVD`\|`SGD`, code `Y`/`N`, measure = duty involved (0 when `N`) | SEZ `M`-type BE only |
| Hand carriage | `HAC`/`HACID` `GEMS`\|`SAMPLE`\|`PROTOTYPE`, `HACWH`, `PAXNM`, `PPNO`, `PNR`, `TKTNO`, all at `Inv_SrNo 0` / `Item_SrNo 0` | `H`-type BE at an air cargo site |
| SEZ authorised person / CBW | `SEZ`/`ATP`, `SEZ`/`CBW` | SEZ `Z`/`T`/`M` BEs |

None of these is speculative — each is in the spec with its own error codes
(**884**–**887** for the steel grade, **914**–**925** for hand carriage,
**930**–**934** for CCDC, **941**–**944** for CBW). They are simply not this
tenant's trade today. The CAVR row is the closest to becoming one: it takes a
`KGS` UQC on the same line, so it lands on both this sheet and ITEMS at once.

---

## Cross-sheet invariants

| Other sheet | Invariant | Why |
|---|---|---|
| `ITEMS` | every `(Inv_SrNo, Item_SrNo)` here must exist there | **461**, **497** |
| `ITEMS.RITC` | the `SQC` unit is derived from it — change the CTH and this sheet changes | **494** |
| `ITEMS.Unit` | may legitimately **differ** from `Measure_Unit`; `SET` vs `NOS` on `ex_job26` is correct, not a defect | — |
| `ITEMS.Transit_Country` | mandatory on an FTA line — the other half of the same ICES rule as the `ORC` family | spec rev. 2.7 |
| `STATEMENT.PC002` | the self-undertaking that CAS/IUPAC is unavailable. Circular 23/2023 makes it **conditional**; see below | — |
| `STATEMENT.DC007` | fires off the `DRC` qualifier's presence in this sheet | `drug-category` trigger |
| `SW_CONSTITUENT` | stays empty — it carries the composition of a finished formulation, not a chemical's identity | [12-sw-constituent.md](12-sw-constituent.md) |
| `SUPPORTING_DOCS` | a `CPCBB` line's CAS/IUPAC comes off a certificate of analysis, which eSanchit expects uploaded | Circular 55/2020 Annexure B |

### What this sheet settles about `PC002`

[open-questions.md](open-questions.md) asks whether `PC002` should drop when CAS
and IUPAC are both known, and records that `CHEMICAL_CHAPTERS` is `[28, 40]`
inferred from three checklists.

Both answers move now.

Circular 23/2023 para 4.2 is explicit that the undertaking is for *"non-
availability of information for even one ingredient … not shared by my supplier
due to confidentiality"*. It is conditional by construction, and `PC002`'s own
text says so.

The eight workbooks say what the CHA actually does, and it is not that:

```
PC002 filed:     ex_job25 (ch 39)  ex_job28 (ch 39)  ex_job29 (ch 39)  liv_job1 (ch 29)
PC002 not filed: ex_job20 (ch 27)  ex_job21 (ch 34)  ex_job26 (ch 84)  ex_job31 (ch 88)
```

`PC002` appears on exactly the lines that carry a `CPC` row, and on no others —
the same 28/29/32/3808/39 scope as this sheet, eight for eight. **`ex_job21` is
chapter 34 and files no `PC002`**, which is the direct counter-example to the
`[28, 40]` range; the range was inferred from `ex_job1`, also chapter 34, which
files it on item 1 and not on item 2 of the *same CTH*. Between a checklist that
contradicts itself line to line and eight workbooks that agree with the
circular, the workbooks win.

**Proposed:** `CHEMICAL_CHAPTERS` becomes the Circular 23/2023 scope, shared
with this sheet's trigger rather than restated, and `PC002` is filed when that
scope applies **and** at least one of CAS / IUPAC is unavailable on at least one
constituent. That second clause is the part the corpus cannot confirm — three of
the four `PC002` jobs declare a CAS number and file the undertaking anyway — so
it ships as a **warn** naming the contradiction, not as a silent drop. See
[open-questions.md](open-questions.md#sw-pc002-scope).

---

## What ICES rejects, and what guards it

| Code | Rejection | Guarded by |
|---|---|---|
| 451/452, 462/463, 465/466, 473/474 | Invoice or item number null, negative or zero | the key columns are derived from the line |
| 453 / 454 / 455 | Invalid info type / qualifier / code | the code domains; an unmapped label is dropped or blocked, never passed through |
| 456 / 458 / 460 / 489 | Code, text and measure given together, or text on a family that takes none | one fixed shape per family |
| 457 | Info text is null | the text families block on an empty payload |
| 461 / 497 | Item table details not available for SW info | every row is emitted from a line, never free-standing |
| 464 / 469 / 472 | SW info type table details not available | the `SQC` row makes this table non-empty on every BE |
| 484 / 485 / 499 | Mandatory info type / qualifier / code missing | the per-family trigger set |
| 486 | Single Window details missing | `SQC` on every line |
| 488 / 493 / 495 | Measurement or UQC null, invalid, or standard quantity invalid | the ITCHS unit lookup; **this is the bug the current mapper has** |
| 494 | SUQC wrong from the CTH/item | the unit comes from the CTH, never from `normalizeUqc` |
| 869 | Invalid declaration of infotype | the info-type domain |
| 873 / 874 / 875 / 877 / 931 | Duplicate, missing, over-supplied or invalid mandatory additional qualifier for the CTH | the chemical trigger, and one `CPC` row per line |
| 876 | IUPAC name or CAS number mandatory | the per-category rule from Circular 23/2023 |
| 879 / 888 / 889 / 890 | COO number/date invalid, already used, item sequence missing, UQC mismatch | **nothing yet** — the `ORC` family is unbuilt |

And the ones nothing here can prevent: **880** (*COO document number is
suspended*) and **882** / **929** (*declared quantity exceeds available number
of…*) are facts about ICES' own registers. The export cannot see them and does
not pretend to.

---

## Tests

`packages/core/test/standard-uqc.test.ts` — the unit and the quantity. Every
CTH it asserts is one a real filing used, with the unit that filing carried:
twelve of them, plus `29269090` (the First Schedule hole the book fills),
`SET`→`NOS` and `UNT`→`NOS` from I-60133 and I-20271, a tonne-to-kilogram
conversion, and the refusals — weight-to-count, a CTH with no unit, a line with
no quantity. One test asserts no `MTS` or `MCU` survives into the master at all.

`packages/core/test/single-window-scope.test.ts` — the two triggers, pinned
against the whole corpus, because in both cases the plausible wrong reading is a
chapter range: nine CTHs in the chemical scope and six out of it (`ex_job21`'s
chapter 34 among them), heading 3808 in and `38170011` out, and the three
chapter-29 filings split exactly as ICES split them on `HZRDS`.

`packages/exporter/test/sw-addl-info.test.ts` — the sheet itself: the four-row
chapter-39 shape written as codes and not labels, the measure kept on the `SQC`
row and off every other family, the blocker when the standard-quantity row
cannot be coded, the warn-and-drop for an optional one, four invoices each
against their own serial, and the Circular 55/2020 qualifiers all coding.

Still untested, because there is nothing to test against: the `ORC` family, and
a CAS number that contradicts its line's CTH (`ex_job28`) — checking that needs
a CAS registry the repo does not hold.

The goldens to diff against are `liv_job1` and `ex_job25` (the full `CPCBB`
shape, three lines on one CTH), `ex_job29` (`CPCPR` alone), I-20271 (four
invoices, `UNT`→`NOS`) and I-60133 (`SET`→`NOS`, and the only job where the
workbook and the assessed BE can be compared directly). `ex_job17`'s processed
BE is the only evidence for `HZRDS` and `DRC`, and it is a BE rather than a
workbook, so it pins the *rows* and not the cell formatting.
