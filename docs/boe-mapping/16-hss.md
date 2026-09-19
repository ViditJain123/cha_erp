# HSS

**Who owned the goods before the importer did, while they were still at sea.**
The sheet is ICES `<TABLE>HSS` (**BE Message format 2.25, CACHI01 Part 12/24**,
p.33 of the spec in `data/customs-corpus/icegate-specs/`).

**One row per party in the chain of sales, ordered by `Level`** — not one row
per invoice and not one per item. The sheet has no `Inv_SrNo` at all: a
high-seas sale is a fact about the consignment, and the money it moves is
declared on [INVOICES](05-invoices.md) instead.

**Wired**, at `packages/exporter/src/map/hss.ts`.

Evidence, in order of authority:

- Your dictation, on the sheet itself (`understanding_this_sheet.xlsx`, `HSS!B4`):

  > So all this data, all the high seas related data will come from either of
  > these three sources. So first is the BE, second is the agreement, the high
  > seas agreement that the party signs, they send us the agreement and from
  > there we can extract all this data. And third is we can also get this data
  > from the mail. The importer might send us all this data from mail. If not,
  > if we are not able to figure out any of this data, then we have to fall back
  > to operator.

  That is the standard `document < master < mail < operator` precedence, named
  in `README.md`, applied to this sheet.
- `BE Message format 2.25` — the field list, the preceding-level rule and its
  worked example, and the exempted-IEC list that decides which columns are
  mandatory.
- `BE_fresh_filing_error_codes_24032026.pdf` — seven codes land on this sheet.
- **No populated vendor row exists.** All fifteen workbooks carry the sheet
  header-only, so format questions are answered from the spec and the places
  that leaves a choice are marked.

---

## What a high-seas sale is

Goods are sold while afloat, after they leave the load port and before they are
entered for home consumption. The buyer at the end of the chain is the importer
of record and files the Bill of Entry; everybody upstream sold goods they never
cleared. Customs assesses on the **last** price — the one the filing importer
paid — which is why the sheet and the loading on INVOICES are two halves of one
declaration.

`GENERAL.IsHSS` is the switch. The spec's note is unambiguous:

> Entry in this table is mandatory, if Column — 'High Sea Sale' is 'Y' in the
> Table – BE, particulars of the original importer have to be given.

## `Level` is a preceding level, and it counts backwards

This is the column to get right, and the spec's own example is the
specification:

> Party1 sells the goods to Party2 and Party2 in turn sells it to Party3. If
> Party3 is the IEC (importer) who is filing the BE, [Party3] will be declared
> in the main table, Party2 details would be entered with preceding level of
> '0'. Party1 would be entered with preceding level of '1'.

So:

| Who | Where they are declared | `Level` |
|---|---|---|
| the importer filing the BE | `GENERAL` / `<TABLE>BE`, **not here** | — |
| the party who sold to them | this sheet | `0` |
| that party's seller | this sheet | `1` |
| and so on, up the chain | this sheet | `2`, `3`, … |

Two consequences a mapper must honour:

- **The filing importer never appears on this sheet.** Emitting them as `Level`
  0 shifts every real party down one and misstates the entire chain.
- **`Level` 0 always exists on a high-seas sale.** A sheet with rows that starts
  at `1` is missing the immediate seller.

The ordinary case is one row. A chain of two sales afloat is two rows; the spec
puts no cap on the chain and neither does this sheet.

## The columns

Logi-Sys exposes ten. ICES has fourteen fields, of which 1–6 are message control
supplied from GENERAL, and Logi-Sys adds three columns of its own that ICES has
no field for.

| # | Column | ICES field | Type | Source |
|---|---|---|---|---|
| 1 | `Level` | 14. Preceding level | C(1), **M** | derived — position in the chain |
| 2 | `HSS_Name` | 9. Importer Name | C(50), O / **M** | `document` < `mail` < `operator` |
| 3 | `HSS_BranchName` | — | — | `master` — Logi-Sys' own |
| 4 | `HSS_BranchSr` | 8. Branch Serial Number | N(3), **M** | `master` < `operator` |
| 5 | `HSS_IECode` | 7. IEC | C(10), **M** | `document` < `mail` < `operator` |
| 6 | `HSS_ADCode` | — | — | `master` — Logi-Sys' own |
| 7 | `HSS_Address` | 10–11. Importer Address 1 + 2 | C(35) each, O / **M** | `document` < `mail` < `operator` |
| 8 | `HSS_City` | 12. Importer City | C(35), O / **M** | `document` < `mail` < `operator` |
| 9 | `HSS_Country` | — | — | `document` < `operator` |
| 10 | `HSS_PostalCode` | 13. Importer Pin | C(6), O / **M** | `document` < `mail` < `operator` |

### The `O / M` columns — conditional, and the condition is the IEC

The spec splits the party particulars two ways, and this is the only rule on
the sheet that changes what is mandatory:

> Providing of Importer particulars (Importer Name, Address, City and Pin) is
> **optional** for regular importer (who have individual IE Code issued by
> DGFT). System would retrieve the information from the IE Code directory
> maintained in ICES.
>
> Providing of the particulars … is **mandatory** for importer who is using the
> IE Code specified for exempted category.

The exempted-category IECs are the fixed list on spec p.14 — `0100000011`
Central Govt, `0100000029` State Govt, `0100000037` UNO/diplomatic,
`0100000045` baggage, `0100000053` personal use, `0100000061` Nepal,
`0100000070` Myanmar, `0100000088` Ford Foundation, `0100000096` ATA carnet,
`0100000100` blood group ref. lab, `0100000126` charitable institutions,
`0100000001` others with permission.

A high-seas seller on one of those codes is unusual but not impossible, so the
rule is worth encoding rather than assuming away: **an IEC in that list makes
name, address, city and pin mandatory; any other IEC leaves them optional and
ICES fills them from its own directory.** Where we hold them we file them
either way — a filing that matches the directory costs nothing and one that
diverges is a question worth raising before the BE is submitted, not after.

### 1. `Level`

`C(1)` — a **character**, not a number, so `code()` and not `int()`. One
character caps the declarable chain at ten sales, which no chain reaches.

### 4. `HSS_BranchSr`

`N(3)`. The branch of the seller's IEC that made the sale, exactly as
`GENERAL.BranchSrNo` is for the filing importer. ICES rejects an unregistered
branch outright (error 163), and a default of `1` is a guess about somebody
else's DGFT registration — so it is `master` (the organization repository, where
the party is known to us) then `operator`, never a constant.

### 3, 6, 9. `HSS_BranchName`, `HSS_ADCode`, `HSS_Country` — Logi-Sys' own

ICES' HSS segment has no field for any of the three. They exist because
Logi-Sys models a high-seas seller with the same party record it uses for an
importer, and that record carries a branch name, an authorised-dealer code and
a country.

`HSS_Country` is worth filling where the agreement gives it — a foreign
high-seas seller is the common shape. `HSS_ADCode` is the seller's own bank AD
code and is almost never on any document we hold; it stays blank unless the
organization repository has the party. Neither reaches ICES, so neither can be
rejected, and neither may be guessed either: the workbook is read by humans
before it is uploaded.

---

## When a row is required

| Trigger | Result |
|---|---|
| `GENERAL.IsHSS` = `Y` | **mandatory** — at least the `Level` 0 row. Spec p.33 |
| the job carries a high-seas-sale agreement document | suggests `IsHSS`, per [01-general.md](01-general.md) — a suggestion, never applied on its own |
| an ex-bond (`X`) Bill of Entry | **never** — ICES 664, *HSS details not required for X-bond BE* |
| anything else | no rows; the sheet stays header-only |

## Cross-sheet invariants

These three move together, and any two out of three is a rejection:

| Other sheet | Invariant | Why |
|---|---|---|
| `GENERAL.IsHSS` | `Y` **⟺** this sheet has rows | ICES 116, *High Sea Sale Flag wrong* |
| `INVOICES.HSS_%` / `HSS_Amount` | one of the two is non-nil **⟺** this sheet has rows | ICES 250, *High Sea Sale Load rate/Amount is must for …*; 253, *should be null for …* |
| `INVOICES` | the load is the difference between the HSS price and the import price, at a 2 % floor | [05-invoices.md](05-invoices.md) §9; `map/invoices.ts:336-350` |
| `GENERAL.Importer` | is the party at the **end** of the chain and is not on this sheet | the spec's worked example |
| `INBOND_EXBOND` | an ex-bond BE carries no rows here | ICES 664 |
| `SUPPORTING_DOCS` | the high-seas-sale agreement is itself an eSanchit document | a declared chain with no uploaded agreement is an assertion |

## What ICES rejects

| Code | Rejection | Bearing on this sheet |
|---|---|---|
| **116** | *High Sea Sale Flag wrong* | the flag and the rows disagreeing |
| **161** | *IEC not registered - HSS* | `HSS_IECode` not in ICES' IEC directory |
| **162** | *IEC Branch Slno should not be NULL or …* | `HSS_BranchSr` blank |
| **163** | *IEC Branch Slno not registered - HSS* | a branch serial that IEC does not have |
| **164** | *Importer Name/Address/City/Pin is must for …* | the exempted-category rule above |
| **178** | *Duplicate Record found in High Sea Sale* | two rows at the same `Level`, or the same party twice |
| **250 / 251 / 252 / 253** | the HSS load on INVOICES | the invariant above |
| **664** | *HSS details not required for X-bond BE* | rows on an ex-bond filing |

## Failure modes

| Condition | Severity | Why |
|---|---|---|
| `IsHSS` = `Y` and no chain recorded | **blocker** | the BE would declare a high-seas sale and name nobody. ICES 116 rejects it anyway; better to refuse than to upload |
| a chain recorded with no `Level` 0 | **blocker** | the immediate seller is who Customs assesses against |
| an IEC missing on any party | **blocker** | ICES 161 — the row is not filable |
| a branch serial missing | **warn** | ICES 163 will catch it, and the operator can key it in Logi-Sys |
| name/address missing on an **exempted-category** IEC | **blocker** | ICES 164 |
| name/address missing on an ordinary IEC | no warning | ICES fills them from its directory; that is the spec's own rule |
| `HSS_ADCode` unknown | no warning | it reaches no ICES field |

## Upstream

The draft models the flag and the money and not the parties: `draft.hss?:
boolean` (`extraction/src/draft.ts:530`) and `hssValue` (`:126`). The chain
itself is new — `draft.hssChain: HssParty[]`, resolved from a
`high_seas_agreement` document, then the instruction mail, then the operator,
and persisted in `job_hss_chain` on the pattern of `job_sec65_finished_goods`.

Where a party is already in the organization repository, its IEC, branch serial,
branch name, AD code and address come from there rather than from the agreement
— the same `applyPartyResolution` precedence that governs the importer and the
supplier, and the reason a hand-picked party is never overwritten by a re-read.
