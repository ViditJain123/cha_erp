# STATEMENT

The declarations the importer and CHA sign with the Bill of Entry. The sheet is
ICES `<TABLE>STATEMENT` (**BE Message format 2.25, CACHI01 Part 23, "Declaration
Statements"**, p.50 of the spec in `data/customs-corpus/icegate-specs/`). The spec
calls it *"required for all commodities and mandatory for every declaration"*. Every
Logi-Sys checklist prints it as **DECLARATIONS DETAILS**: codes by `Inv N` /
`Item N`, then a table of each code's full wording.

Implemented by `packages/exporter/src/map/statement.ts`. The rules are
`declarationStatements` in `packages/core/src/masters/index.ts`, and the codes and
their wording are `DECLARATIONS` in `packages/core/src/masters/data.ts`.

Evidence: the DECLARATIONS DETAILS block of the Logi-Sys checklists in
`ex_job1..6`, and the STATEMENT sheet of
`liv_job1/JobData_I-10793_25-26_20260824_114941.xlsx`.

## Why this sheet needed dictating

The mapper wrote six rows copied from I-10793, whatever the job: CUG00/01,
CUV01–03, and **PC002 on every line**. PC002 certifies that the CAS/IUPAC
details of a chemical aren't available. Filing it for sesame seeds or diodes
states something false about the goods. The mapper also never filed CUF02, so
every FTA claim went out without the rules-of-origin declaration. `ex_job6`'s
checklist prints `PC002,CUF02` against its one line, and the workbook carried
only PC002.

Separately, `applicableDeclarations` computed a job-wide list for the checklist
with different rules again: chapters 28–38, and DC007 for any food. Two rule sets
disagreed, and neither matched the checklists.

Nothing on this sheet comes from the customer's documents. Every row is derived
from the draft: its invoices, each line's CTH and exemption, and its Single
Window rows. It is derived **at export**, not read from `draft.declarations`. A
stored draft carries codes without scope, and an operator's edit to a tariff code
changes which declarations apply.

---

## Columns

| Column | Source | Rule |
|---|---|---|
| `Inv_SrNo` | `derived` | 0 for a job-wide declaration, else the invoice's serial |
| `Item_SrNo` | `derived` | 0 for a job- or invoice-wide declaration, else the line's serial within its invoice |
| `StatementType` | `constant` | `DEC`. The spec also allows `UTG` (undertaking) and `REM` (free-text remark); we generate neither |
| `StatementCode` | `master` | ≤ 7 chars. See the rules below |
| `StatementRemarks` | `constant` | Blank. The spec: for DEC and UTG *"Statement Text would remain blank"* |

## Which codes, at which scope

| Code | Scope | Applies when | Evidence |
|---|---|---|---|
| `CUG00`, `CUG01` | (0,0) | Always. General declarations: BE matches the documents, the documents are true | all six checklists, I-10793 |
| `CUV01`, `CUV02`, `CUV03` | (inv,0), every invoice | Always. Valuation declarations under the Customs Valuation Rules 2007 | all six; `ex_job5` repeats them for each of its 12 invoices |
| `PC002` | (inv,item) | The line's CTH is in chapters **28–40** | `ex_job1` ch 34, `ex_job4` ch 39 (both lines), `ex_job6` ch 39, I-10793 ch 29. Absent on ch 12 (`ex_job3`), 17 (`ex_job2`), 85 (`ex_job5`). Filed **even where the CAS number is declared** (`ex_job6` 9003-07-0, I-10793 108-31-6) |
| `DC007` | (inv,item) | The line has a Single Window row with qualifier *Drug Related Category* | `ex_job2` (lactose, category MSC). **Not** `ex_job3`: sesame carries FSSAI rows and no drug category, and files no DC007 |
| `CUF02` | (inv,item) | The line claims a preferential notification: `bcdExemption.scheme` is set, or the notification is one of `FTA_SCHEMES` | `ex_job2` (DFTP 096/2008), `ex_job6` (India-Japan CEPA 069/2011 sr 295). Not `ex_job5`, whose 024/2005 is not an FTA |

Order is the checklist's: job-wide, then each invoice followed by its lines. Within
a line, master order: PC002, DC007, CUF02.

Note that `merge.ts` adds FSSAI Single Window rows to chapters 2–22 by chapter,
including a *Drug Related Category*. So a food line the merge enriched will carry
DC007. That follows the rows we file. If those rows are wrong for the goods, fix
the Single Window rule, not this one.

## What is not generated: mandatory-document exceptions

`ex_job2`'s line also carries `861000, 911001, 0010DC, 0110FS, 0110DC`, each with
text *NA*. These are supporting-document codes, not declaration codes. The spec
describes the mechanism: when a CTH's **mandatory supporting document** (CBIC's
Compulsory Compliance Requirements) is not uploaded, the importer files
`StatementType REM`, `StatementCode` = that document code, and `StatementRemarks`
= the reason it doesn't apply.

No master holds the CTH → mandatory documents list, so these rows are left to the
operator. The exporter warns on any line in a participating-agency chapter
(`SINGLE_WINDOW_RULES`).

## Open

See `open-questions.md` → *STATEMENT*.
