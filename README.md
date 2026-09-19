# ERP

Multi-tenant customs-clearance ERP. Invite-only SaaS on Supabase + Next.js, with
a background worker (Phase B) that watches connected Outlook mailboxes and opens
jobs from incoming shipment documents.

The product has no name yet — everything user-facing reads from
`packages/config/src/app.ts`. Renaming it is a one-line change there.

## Layout

```
apps/web            Next.js 15 app — ERP, platform console, and /legacy
packages/config     branding config + per-feature env validation
packages/db         Supabase clients, generated types, tenancy helpers
packages/mail       Resend transport + credential emails
packages/core       duty engine + masters        (legacy, unchanged)
                    masters-source/ + scripts/build-masters.py generate
                    src/masters/generated/ — see The reference masters
packages/extraction OpenAI document pipeline     (legacy, unchanged)
packages/library    CBIC document RAG            (legacy, unchanged)
supabase/           config.toml + migrations
```

`/legacy/*` is the original single-tenant checklist generator. It still works,
still writes to `apps/web/data/`, and is reachable only by platform admins. It
is not part of the ERP and nothing there is tenant-scoped.

## Local setup

Requires Docker (for the Supabase stack), Node 24 and pnpm 11.

```bash
cp .env.example .env.local          # apps/web/.env.local is a symlink to this
pnpm install
pnpm db:start                       # prints the anon + service-role keys
```

Paste the printed keys into `.env.local`, then:

```bash
pnpm db:seed:admin                  # SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD optional
pnpm dev                            # http://localhost:3040
```

Sign in as the seeded platform admin, create a company, and the owner's
credentials email is printed to the server console — `MAIL_TRANSPORT` defaults
to `console` when `RESEND_API_KEY` is unset, which is the only place a temporary
password is ever shown.

## The mailbox watcher

A scrutiny team member connects their Outlook mailbox at `/settings/mailbox`.
The worker then polls each connected mailbox every 5 minutes and, for every new
email carrying attachments, classifies them and either attaches them to the job
they belong to, opens a new job, or skips the message with a recorded reason.

```bash
pnpm worker                         # the watcher loop
pnpm worker:once                    # a single tick, for local testing
```

Matching is scored, not guessed (`packages/ingest/src/match.ts`): a container,
B/L or air waybill number is enough on its own; an invoice number nearly is; an
email thread alone is not, because reply-all chains drift onto unrelated
shipments. Two jobs tying above the threshold are parked as ambiguous rather
than merged — that is unrecoverable, so a human decides.

## Opening a job by hand

The watcher is the intended way in, but not the only one: `/jobs` carries a drop
zone (`POST /api/jobs` -> `processUpload`) for a company that has not connected
Outlook yet, or that was handed a folder of scans. It runs the same triage,
matching and storage the watcher runs, so a job started there is
indistinguishable from one an email opened.

Two deliberate differences from the mail path. A batch whose documents are all
unrecognised still opens a job — the person dropping them has said they want
one, where an email that happens to carry a signature image has not. And an
ambiguous match is handed back to that person with the candidate jobs named,
rather than parked in the log for someone to find later.

## Exporting to Logi-Sys

A job's documents are read into a `ChecklistDraft` (`packages/extraction`) and
filed as a version in `job_drafts`. `packages/exporter` turns that draft into
the workbook Logi-Sys imports — via *Import/Export Data → XLSX* on the Import
Document screen, **not** the XML import beside it, which only accepts Visual
Impex files and rejects a spreadsheet with "Please select valid file".

The exporter does not build a spreadsheet; it clones the vendor's own
`ImportXLSXTemplate.xlsx` and splices rows into it at the zip level, so all 19
sheets, their order and every header are the vendor's by construction. See
`packages/exporter/templates/README.md` for why it is done that way rather than
with a spreadsheet library.

It refuses rather than guesses. A line whose quantity and unit price do not
reconcile, an item with no usable tariff code, a country that cannot be coded —
each aborts the export instead of producing a Bill of Entry that misstates the
consignment. Columns that are merely missing come back as warnings and are shown
to the operator to complete in Logi-Sys.

`packages/exporter/test/golden-ep061126-1.test.ts` pins the whole mapping against
job I-13844/26-27, whose documents and Logi-Sys checklist are in `ex_job6/`.

## The corpus dry run

Thirty-two example jobs sit beside this repo in `ex_job1..31/` and `liv_job1/`,
each a real folder of shipment documents *and* the checklist Logi-Sys printed
for it. The dry run puts every one of them through the live path and keeps the
workbook, so the same jobs can be filed by hand in Logi-Sys and the two
compared column by column.

```bash
set -a; . .env.local; set +a
cd apps/web
./node_modules/.bin/tsx --conditions react-server scripts/corpus-export.mts
python3 scripts/corpus-compare.py
```

The exports, one directory per job, land in `corpus-exports/` along with a
`report.json` naming what was read, what was withheld and every warning.

Three things about it are worth knowing before reading a result:

- **The answer is withheld.** Each folder also holds the checklist PDF, the
  processed Bill of Entry or Logi-Sys' own `JobData` export — every field we are
  trying to predict. `isAnswerKey()` keeps all three out of the job, and the
  report names what it held back, because "the model never saw it" is the claim
  the whole comparison rests on. The mail thread is *not* withheld: it is what
  the broker had in front of them, and the header is read off it in production
  the same way.
- **An operator answers what is theirs to answer.** The export refuses on a
  custom house nobody chose, an unconfirmed classification, an unpicked AD code,
  an unconfirmed re-import entry and an unchosen trade-remedy row — all of them
  questions for a person, not failures of extraction. The run answers them the
  way a broker would, records each answer with its reason in `report.json`, and
  leaves everything else blocked. A blocked job is a finding, not a crash.
- **It writes to the live company.** Jobs are created under the company that
  holds the organization repository, referenced `CORPUS/<folder>` so they can be
  told apart from real work, and `corpus-exports/state.json` lets a re-run pick
  up where it left off.

`corpus-compare.py` reads our workbook and Logi-Sys' for the same job — both
are the same nineteen sheets — and writes a per-job diff and a scorecard
ranking the columns that go wrong most often. It compares numbers as numbers and
dates as dates, so a column is not wrong for being formatted differently.

## The reference masters

The workbook's coded columns are filled from reference documents the CHA
supplied, generated into `packages/core/src/masters/generated/` from the source
files kept beside them in `packages/core/masters-source/`:

| Source | Rows | Fills |
|---|---|---|
| `port-name-and-code.pdf` | 369 foreign ports | `GENERAL.PortOfShipmentCode`, `CountryOfShipmentCode` |
| `custom-house-list.csv` | 296 ICEGATE stations | `GENERAL.CustomsHouseCode`, `SHIPMENT.Port_of_Reporting` |
| `major-airline-code-list.pdf` | 61 airlines | air waybill carrier resolution |
| `country-code-list.pdf` | 238 alpha-3 codes | every `iso2()` caller |
| `igst-rate-notification-09-2025.pdf` | 1,195 IGST schedule entries | `ITEM.IGST_Rate`, `IGST_LevyNotn`, `IGST_LevyNotnSrNo` |
| `bcd-exemption-notification-45-2025.pdf` | 539 exemptions + 125 conditions | `ITEM.BCD_Rate`, `Basic_Notn`, `Basic_NotnSrNo` |
| `bcd-amendment-*.pdf` (6) | 100 applied, 85 omitted, 31 recorded | keeps the above in force rather than as published |
| `igcr-rules-74-2022-nt.pdf` + `igcr-amendment-07-2025-nt.pdf` | the procedure condition 3 points at | reference for the IIN + continuity bond a claim needs |

Before this, the foreign-port master was 27 hand-typed rows and the custom-house
master was six — the stations the two reference jobs happened to use. Anything
filed anywhere else had no code at all, and these are not columns Logi-Sys will
infer.

```bash
pip install pymupdf
python3 packages/core/scripts/build-masters.py     # rewrites generated/
```

The generated files are committed; the script exists so a refreshed list is one
command rather than a hand edit, and so "where did this code come from" has an
answer.

Three things it does that are worth knowing before editing a source list:

- **A country code comes out of the UN/LOCODE, never out of the name beside
  it.** A LOCODE is by construction `<ISO alpha-2><locality>`, so `CNTAO` is CN
  whatever the page says — and the page says "Chinese Mainland", which no ISO
  lookup resolves. It also says "Britain" and "Columbia".
- **The PDFs are set in a font whose `ti`, `tt` and `ff` ligatures are mapped to
  codepoints that are not those letters.** Extracted naively, Rotterdam is
  "RoƩerdam" and Argentina "ArgenƟna". The build undoes that from a closed set
  and *aborts* on a character not in it, rather than shipping a misspelt port
  into a Bill of Entry.
- **The port list has one genuine typo of its own.** It prints Qingdao as
  "Ingdao" — every PDF extractor agrees, because the page is wrong. It was found
  by sorting: the list is alphabetical by intended name, so a misspelling lands
  out of order, and over 372 rows that check turns up exactly one real
  violation. `NAME_CORRECTIONS` fixes it and keeps the printed spelling as an
  alias, so a document repeating the same mistake still resolves.

`packages/core/test/reference-masters.test.ts` pins the four lists;
`packages/core/test/duty-notifications.test.ts` pins the two notifications.

### The two duty notifications

Both are the whole rate structure, not amendments to one:

- **9/2025-Integrated Tax (Rate)**, in force 22 September 2025, supersedes
  1/2017-IT(R). Seven schedules, one IGST rate each.
- **45/2025-Customs**, in force 1 November 2025, supersedes 31 notifications
  going back to 1957. Four tables of effective BCD (and where stated IGST and
  compensation cess) rates, most of them conditional, plus the condition
  annexures and 29 appended goods Lists.

Before them the tariff master had three rows — the CTHs the two reference jobs
used — so every other item merged with `igstRate: 0` and a flag telling the
reviewer to type the rates in. What the lookups do with them:

- `igstRateForCth(cth)` answers for any code. Column (2) of a notification is a
  little language rather than a code (`0207 25 00, 0207 27 00`, `5004 to 5006`,
  `0910 [other than 0910 11 10, 0910 30 10]`, `Any Chapter`), which the build
  flattens into digit prefixes; the longest prefix that matches wins. A CTH no
  entry names is 18% by Schedule II's own residual entry — returned with
  `residual: true`, because goods that are *nil*-rated are exempted by a
  companion notification that is not in these masters, so a residual answer is
  a prompt to check rather than a conclusion.
- `bcdExemptionMatches(cth)` returns candidates only. Every entry is bound to a
  description and most to a condition, so nothing is auto-applied; "Any
  Chapter" entries (diplomatic baggage, defence stores) are left out unless
  asked for, or they bury the entries that name the chapter.
- The rate often turns on the description, not the code: heading 1702 is 5% as
  jaggery and 18% as lactose. Where equally specific entries disagree the
  lookup hands back all of them, `mergeToDraft` flags it, and
  `enrichDraftFromNotifications` (`packages/extraction`) asks the model which
  entry describes the goods — choosing only between entries the masters
  produced, and flagging whatever it chose.

### A notification is not a document

It is a document plus everything issued against it since. 45/2025 was published
on 24 October 2025 and amended six times in the following nine months. Read from
the base PDF alone it is **wrong about a third of its entries**:

| | entries | if we trusted the base text |
|---|---|---|
| sunsets 02/2026 extended to 2028 | **93** | deny a concession that is live |
| serials 02/2026 omitted | **85** | grant one that no longer exists |

So the build reads the amendments too, from `masters-source/bcd-amendment-*.pdf`,
in the order they were issued.

Two properties make that safe to automate. Instructions are **numbered 1..n**,
so none can be skipped — the build asserts the numbering and stops if a
classified count disagrees. And each **cites the serial it acts on**, so it can
be applied to exactly one entry, after asserting the entry exists and the text
being replaced is really there. An amendment that does not match what we hold
means our parse of the base notification is wrong, which is worth stopping for.

Three forms are applied — a sunset date substituted in column (3), a serial
omitted, a rate substituted in column (4). Everything else is **recorded, not
applied**: an inserted serial or a substituted row carries new text only a
person can read, a corrigendum edits a printed page and cannot be located by
serial at all, and one amendment revises an appended List we do not parse.

```
45/2025 amendments: 100 applied, 85 serials omitted,
                    31 instructions left for a human (25 entries marked stale)
```

An entry those 31 touch is marked `staleBy`, and **its rate is never applied** —
`enrichDraftFromNotifications` proposes it and says which amendment it has not
caught up with. `BCD_UNAPPLIED_AMENDMENTS` publishes the whole list, because the
gap between what CBIC has notified and what these masters hold should be visible
rather than assumed away.

One trap worth knowing: an instruction can be **compound**. Instruction 62 of
02/2026 moves S.No. 140's sunset *and* rewrites its conditions. Read as a single
action it would apply the first and silently drop the second, leaving an entry
that looks current and states the wrong conditions — so lettered clauses are
split and classified one by one.

`validUntil` is read out of the proviso as a date, because whether a concession
has lapsed depends on the filing date, and `mergeToDraft` now drops a lapsed
entry from the candidates rather than offering it. 02/2026 amended Table I only,
so a few Table II provisos really did expire on 31 March 2026 — those entries
stay in the master, and `isInForce(entry, date)` decides.

### What a concession demands

An exemption entry grants a rate, and **286 of the 539 in 45/2025 attach a
condition to it** — an end-use undertaking, a registration, a certificate. Those
conditions used to survive only as prose inside one flag message, so nothing
downstream could act on them.

They are now classified at build time by *what they demand*, because that is
what decides who has to do something:

| kind | conditions | entries it reaches |
|---|---|---|
| `igcr` — follow the IGCR Rules 2022 | 2 | **120** |
| `certificate` — produce one from a named authority | 65 | 70 |
| `importer-type` — only Defence, Government, a registered exporter… | 14 | 55 |
| ten more (`bond`, `time-limit`, `export-obligation`, …) | 22 | 60 |
| `other` — the long tail, read by a person | 32 | 34 |

Three kinds cover 80% of everything conditional. `igcr` is worth naming on its
own: Table I condition 3 and Table II condition 1 are the *same sentence*, so
matching it is exact rather than fuzzy, and between them they gate 120 entries.
What it means in practice is that the importer must already hold an IIN and a
continuity bond, and **both must be declared on the Bill of Entry** — rule 5(1)
of the Customs (Import of Goods at Concessional Rate of Duty or for Specified
End Use) Rules, 2022 (74/2022-Cus(N.T.), amended by 07/2025 which moved the
returns from monthly to quarterly). Both notifications are in `masters-source/`.

`bcdConditions(entry)` returns the whole condition — number, kinds and text —
where `bcdConditionTexts()` returned bare prose with no handle to record
against. `requiresIgcr(entry, subEntry?)` answers the question that blocks a
filing.

### One serial, several end uses

A serial can enumerate end uses and give each its own rate and conditions.
S.No. 160 is the shape:

```
160.  Chapter 47   Pulp of wood … when used for the manufacture of:
      (i)   newsprint                      Nil    conditions 3 and 19
      (ii)  paper and paperboard           Nil    condition 3
      (iii) adult diapers                  Nil    condition 3
      (iv)  ch. 9619, other                2.5%   condition 3
```

Read as one row that is `bcdRateText: "Nil Nil Nil 2.5%"` and
`condition: "3 and 19 3 3 3"` — no rate at all, so the concession cannot be
claimed. `subEntries` now carries the four apart, and
`bcdSubEntryConditions(entry, 'ii')` answers `[3]` rather than `[3, 19]`,
because condition 19 — supply the newsprint to a newspaper registered with the
Registrar of Newspapers for India — binds the newsprint branch alone.

Column (6) is positional in these rows, and the dashes matter: S.No. 260 reads
`- - - - - 3`, five unconditional looms and one conditional line of parts. A
parser that only looked for digits would attach the 3 to the first loom.

**The split refuses more often than it succeeds, and that is the design.** Of
the 23 entries that stack rates, 9 reconcile. S.No. 130 has five rates against
fifteen enumerated items; S.No. 103 has three rates against two, because the
second nests `a.` and `b.` beneath it. Where rate count, sub-item count and
condition slots disagree there is no honest correspondence, so no split is
emitted and the entry keeps the null rate it has today, for a human. A wrong
duty rate on a Bill of Entry is far worse than a flagged one.

The parse is checked by serial number: a notification numbers its entries 1..n
with no gaps, so a missing or duplicated serial means a row was dropped or
split and the build aborts. Every condition an entry cites must also resolve in
that table's annexure. Both PDFs are additionally in the RAG library
(`notn-9-2025-igst-rate`, `notn-45-2025-customs`) for the parts no table
carries — the appended Lists of goods.

### The customs corpus

The two notifications above were supplied by hand. The rest of the source data
is now fetched from CBIC and ICEGATE directly, into `data/customs-corpus/`:

```bash
python3 packages/core/scripts/fetch-corpus.py     # tariff, notifications, masters
```

It resumes: a document already on disk is not fetched again, so a re-run costs
only the tree walk.


| | |
|---|---|
| `tariff/` | The Customs Tariff, three volumes, 370 PDFs — the **First Schedule** (98 chapters of CTH, description, standard UQC, standard and preferential BCD), 233 **General Exemptions**, and **anti-dumping duty by chapter** |
| `notifications/` | 8,951 PDFs from a 10,706-record index — 3,924 Tariff, 4,089 Non Tariff (362 of them the fortnightly exchange rates), 715 Anti Dumping, 38 CVD, 22 Safeguards, 23 Compensation Cess |
| `icegate-specs/` | 68 documents — the BE declaration JSON schema, the ICES 1.5 message formats, the 668-row BE error-code table, the SWIFT/PGA advisories |
| `index/` | The parsed output, **committed** — 11,864 tariff rows, the notification index, 16,024 DGFT ITC-HS codes, 586 ICES locations, UN/LOCODE |

Only `index/` is versioned; the PDFs are gitignored and come back in one
command. `data/customs-corpus/README.md` describes each set.

Why it is fetched the way it is: **CBIC rebuilt cbic.gov.in as an SPA and the
old static repository paths all 404** — which is what broke the tariff fetcher
in `packages/library`. The documents are still published, but addressed through
the site's own JSON API, and the id in that URL is base64 of the decimal id.
A chapter node often points at an *older* edition folder than its parent,
because CBIC republishes a chapter only when it changes, so the path is taken
from the node rather than built from an edition string. That was the old
scraper's mistake and it is worth not repeating.

The First Schedule parse is checked against goods we have already filed:
`39021000` → Polypropylene, kg, 7.5% is job I-13844, and `29171400` → Maleic
anhydride, 7.5% is job I-10793. It also reproduces all three rows of the
hand-typed `TARIFF` seed exactly, which is why it is trusted to replace it.

### The printed tariff

CBIC publishes the *statutory* schedule. What a Bill of Entry needs is the
*effective* rate — what is left after the exemption notifications — together
with IGST, the surcharge, and the DGFT policy for the line. No one sells that:
BDP and CENTAX are print-only, and the global trade-content vendors carry MFN
and go silent on Indian notification serials. So it is read off the page.

```bash
python3 packages/core/scripts/build-tariff-book.py
```

reads BDP's *Customs Tariff with IGST and Foreign Trade Policy* 2026-27 — three
scanned volumes, 3,218 pages, bought rather than fetched, gitignored in
`data/tariff-books/` and pinned by digest in
`packages/core/masters-source/bdp-2026-27.sha256` — into
`src/masters/generated/tariff-book/`:

| | |
|---|---|
| `schedule.json` | ~11,990 tariff items: statutory and effective BCD, IGST, SWS, preferential rate, import and export policy, the notifications the REMARKS column cites, and the concessions printed beneath a row |
| `product-index.json` | 13,253 product names against the headings they classify under — the only thing in the three volumes that answers "what code is this?" |
| `drawback.json` | 2,224 All Industry Rates, **unverified** |
| `chapter-notes.json` | 278 Chapter Notes over 71 chapters — what the General Interpretative Rules classify by, given to the classifier |
| `notifications.json` | Where each of Volume II's 286 notifications sits, built from its Contents |

Volume II's **text** is not committed: the page map is a fact derived from the
book, a thousand pages of its prose is the book. The build writes it to
`data/tariff-books/vol2-text.jsonl` beside the PDFs, and
`npm run library:index-tariff-book` embeds it into the library as one document
per notification, each chunk tagged with its notification number. That tag is
the point — the printed tariff names the notification for most lines, so a
duty question can read `045/2025` alone instead of searching 1,456 pages for
text that merely looks similar.

**Why an OCR'd scan can be trusted at all.** The books are copier scans, and OCR
mis-reads digits silently — a wrong duty rate is not a typo, it is a short
payment. But the printed row is over-determined: `TOTAL` is a function of the
other four cells, so every row carries its own checksum. 91.9% reconcile
outright, and where one cell is garbled the rest pin it — page 390 reads BASIC
as "750" while EFFECTIVE 7.50, SWS 0.75 and TOTAL 27.735 each independently say
7.50. Rows that reconcile ship as `verified`, rows recovered from the others as
`repaired`, and rows that do neither as `unverified` — kept, listed, and never
applied silently.

The ~980 rows the arithmetic could not settle are read again from the rendered
page by `pnpm --filter @checklist/extraction repair-tariff-book`, which shows
the model the image and asks only what is printed. Its answers go through the
same checksum; one that still does not reconcile is discarded. The model is a
second pair of eyes, the arithmetic is the judge.

**The book is the second source, not the first.** `tariff-cross-check.ts` reads
every parsed row against 9/2025-IT(R): 98.3% agree wherever both genuinely state
a rate. Most of the rest are not conflicts at all — 9/2025 is indexed by code
while the book is written against the goods, so for heading 0203 a code lookup
returns the 5% entry whose description reads "all goods, *other than* fresh or
chilled", and fresh pork legitimately differs from it. Read naively that is
3,106 disagreements, nearly all false. What is left is ~87 real ones,
concentrated in demerit goods where the 40% slab is the question, and CBIC wins
each of them with the book's reading recorded beside it.

Two traps worth stating once:

- **The printed SWS column is not a rate.** It is the surcharge already
  expressed as a percentage of assessable value — 0.75 against a 7.5% BCD.
  `duty.ts` wants 10. Copying the column through understates it by 92.5%.
- **`bcdRate` carries BASIC, not EFFECTIVE.** A concession sits on top of the
  tariff rate and `packages/extraction` applies 45/2025 itself; seeding the
  post-exemption figure would apply it twice.

## The organization repository

Logi-Sys resolves the parties on a Bill of Entry from its own repository, keyed
on the name plus the branch — `GENERAL.Importer` / `Branch Name` / `AD_Code`,
`INVOICES.Supplier_Name` / `Supplier_Branch`. There is no IEC or GSTIN column on
those sheets to fall back on, so a party name that is merely correct is not
enough: it has to be the exact string Logi-Sys holds. Job EP061126-1 went out
saying `M/S. ELITE POLYPLUS` and `ASIA SHIGEN INTERNATIONAL`, where the
repository says `ELITE POLYPLUS` and `ASIA SHIGEN INTERNATIONAL CO., LTD`.

So each company exports **Organization Repository → XLSX** out of Logi-Sys and
uploads it at `/settings/organizations`. It lands in `public.organizations` —
one row per name × branch × branch serial, which is what makes SIEMENS LIMITED
52 rows rather than one — and everything the workbook says about a party is read
back out of it.

- **Parsing**: `apps/web/lib/org-repository.ts`. The header row is found, not
  assumed; `NULL`, `.` and `NA` are read as absent; the whole spreadsheet row is
  kept in `raw`.
- **Matching**: `partyNameKey()` in `packages/core/src/masters/party-name.ts`
  strips honorifics, punctuation and legal suffixes so a document name and a
  repository name reduce to the same string. It is stored on
  `organizations.name_key`, computed only there, so there is no SQL copy to
  drift. A near miss falls through to a `pg_trgm` search
  (`public.search_organizations`).
- **Binding**: `apps/web/lib/parties.ts`, run after the extraction pipeline
  rather than inside it — the merge is synchronous and knows nothing about a
  company. Several branches sharing a name resolve to *ambiguous*, never to a
  guess; a Bill of Entry is not the place for a coin toss. The Parties card on
  the job screen shows what was bound and lets someone pick a different row,
  which marks it `manual` and survives a re-read of the documents.
- **Re-upload** replaces the snapshot: rows in the file are upserted, rows no
  longer in it are deactivated rather than deleted, so a job filed last month
  still resolves. The two fields Logi-Sys does not hold — the marine
  open-policy rate and the default end-use code — are ours, editable on the row
  and never overwritten by an upload.

An unbound party is a warning, not a blocker: the workbook still downloads and
the operator is told which name Logi-Sys may not recognise.

`apps/web/e2e-organizations.mjs` drives the whole thing against a throwaway
company it creates and deletes.

## Scrutiny

A job leaves the documents branch when the checklist comes back from Logi-Sys
and is uploaded together with its branch, job number and ETA. From there
scrutiny owns it: the HS codes read off the invoice suggest which compliance
requirements (CCRs) apply, and one model call works out which documents those
requirements call for that the job does not already hold.

CCRs are a tenant master at `/settings/ccr`, imported as CSV
(`hs_code,code,title,requirement_text`). The HS code is a **prefix** — `3304`
covers everything under that heading — so requirements can be filed at whatever
level they actually apply.

Whatever is missing is requested from the shipper (`/settings/shippers`) in one
email, **sent as a reply on the job's original thread through the connected
Outlook mailbox**. Replying rather than composing preserves Graph's
`conversationId`, which is what the ingest matcher keys on — so the shipper's
answer and its attachments come back to the right job by themselves.

Requests are never closed automatically. "Check what has arrived" proposes which
documents satisfy which request; a human confirms. A job reaching noting while
believing it holds a document it does not is the failure this exists to prevent.

Sending needs the `Mail.Send` scope. Mailboxes connected before it was requested
keep reading fine but cannot send, and `/settings/mailbox` says so and offers
Reconnect. Set `GRAPH_TRANSPORT=console` to print outgoing mail instead of
sending it.

Once nothing is outstanding the job goes back to the documents branch for a
revised checklist — a new `job_documents` row, so revisions are versioned rather
than overwritten — and then a closing note goes to the shipper with the final
checklist attached. **That note must never mention noting, the bill of entry, or
any internal next step**; the constraint is in the prompt and asserted in
`e2e-phase-c.mjs`. Sending it marks scrutiny done and moves the job to `noting`.

Scrutiny hands the job to the clearance desk, which owns it from there.

## Customs clearance

`jobs.stage = 'noting'` no longer means "parked" — it means the clearance desk
has it. The detail lives on `job_clearance`, a side table with its own status,
for the same reason the delivery order does: two tracks run at once and one
linear enum cannot describe both.

Entry Inwards → **noting** (a token: a BE number, a date, done) → **RMS** routes
the Bill of Entry → **passing** (appraiser, then AC) → the assessed duty is
**compared against the checklist** → duty paid → goods registered → examined →
any NOC → **out of charge** → a delivery day agreed with the CFS → delivered,
which sets `jobs.stage = 'closed'`.

**The duty comparison is what this exists for.** The figure customs assessed is
checked against the one printed on the Logi-Sys checklist the documents desk
uploaded (`jobs.checklist_duty`, keyed at upload — the PDF is stored but never
parsed). They agree, it proceeds. They differ, and customs has re-classified or
re-valued the consignment: the job goes **back to scrutiny**
(`noting → scrutiny`, the only backwards stage move in the app), nothing can be
paid, and it only comes forward when someone records what happened. A revised
checklist may carry a new duty, so the upload route accepts the figure on the
revision path too — otherwise the re-check compares against a stale number and
the loop never closes.

Tolerance is one rupee (`DUTY_MATCH_TOLERANCE`). Both figures are exact amounts
keyed off documents, not estimates, so anything past rounding is real.

A pending NOC — Pollution Control Board and anything shaped like it — blocks out
of charge, and out of charge with no duty payment behind it raises an alert
rather than being silently allowed.

**Delivery planning is in-app, not email.** A day is put to the station, and the
CFS answers in their own queue at `/delivery-planning`, scoped to their
`profiles.cfs_id`. Refusing tells customer support by Resend and keeps the
refused day on the record, so "why was this not delivered on Tuesday" has an
answer. The email is a nudge only: **a plain-text reply is never ingested** —
`apps/worker/src/poll.ts` selects pending messages with
`.eq('has_attachments', true)`, so "yes, approved" would be filed in
`mail_messages` and never reach the job. Nothing claims a notification that did
not go out; when no one on support could be reached, it says so.

Three teams joined `scrutiny` and `do`: `customs`, `cfs` and `customer_support`.
Team was write-once at invite, which was survivable with two and is not with
five, so `updateMemberTeam` exists. Note the trap: `team_kind` is restated in
four places, and the one in `packages/db/src/claims.ts` fails **silently** — a
value missing there becomes `team: null` and the user loses their queue.

## Delivery orders

The DO desk runs **beside** scrutiny, not after it, so it cannot live on
`jobs.stage` — that enum is a single linear path. Each job gets a `job_do` row
with its own status, opened lazily the first time someone visits the tab and
seeded from documents already ingested. `/jobs/[id]` and `/jobs/[id]/do` are
sibling tabs under a shared layout; the split also stops the DO tab paying for
the CCR and shipper read models the scrutiny page runs on every render.

The order of work is the order the shipping line asks for it: is the B/L
surrendered or the original collected → how many detention free days and from
when → loaded out or de-stuffed, and does a bond cover the container deposit →
the line's papers → its proforma invoice, scrutinised and paid → the DO itself →
delivery → the deposit back within 15 days.

**Every deadline is derived, never stored** (`apps/web/lib/do.ts`). A last free
day computed from a stale ETA is the one that costs money, so `doAlerts()` is a
pure function over the current row and `apps/web/test/do.test.ts` pins it. The
DO tab, the job list and the dashboard all call it, which is what stops a job
reading amber on one screen and clear on another.

Two masters feed it: `/settings/shipping-lines` (agent, DO address, whether the
line issues by mail or on ODeX, default free days, and a deposit matrix of mode
× container size) and `/settings/securities` (a yearly bond or standing deposit,
held per importer per line). Both prefill; nothing they set is read-only on the
job.

A bond is still matched on `jobs.importer_name` plus aliases rather than on an
organization id — which means a misspelled importer looks exactly like a
genuinely uncovered job. The UI therefore says *which* it found: "no bond is
recorded for this importer" reads differently from "a bond exists but does not
cover this mode", and both differ from silence. Now that `/settings/organizations`
exists, `importer_line_securities` should gain an `organization_id`.

Detention only. Demurrage — the terminal's ground rent — runs on a separate free
period and is not modelled.

The four B/L facts the desk needs (surrender wording, free days, the carrier,
FCL/LCL) are read at ingest by `TriageSchema` and stored on
`job_documents.classification`, like everything else: **documents are never sent
to the model twice**. Jobs ingested before those fields existed fall back to
`job_drafts`, then to the line master, then to a human. Nothing is re-read.

"Notify accounts" is a stamp and a timeline entry and nothing else, until there
is an accounts module to hand off to. ODeX is not integrated either; a line set
to `odex` swaps the compose panel for a record-what-you-did form.

**Documents are never sent to the model twice.** Each attachment is read once at
ingest, and that call also returns a digest (summary, goods description, HS
codes) stored on `job_documents.classification`. Every scrutiny step afterwards
runs on that text. The missing-document list, the remarks and the draft shipper
email all come out of a single `structuredTextCall`.

## Checks

```bash
pnpm -r typecheck                   # every package
pnpm -r test                        # duty engine, matching, HS prefixes, CSV import
pnpm db:check:claims                # proves the JWT access-token hook runs
pnpm db:test:rls                    # cross-tenant isolation (needs the local stack)
pnpm worker:test:claim              # mailbox claim lock under concurrency
pnpm ingest:test                    # ingest against the real example PDFs *
pnpm --filter @checklist/library exec tsx cli/check-tariff-source.ts
                                    # CBIC still publishes the tariff where we look
node apps/web/e2e-phase-a.mjs       # auth + tenancy UI walkthrough (needs pnpm dev)
node apps/web/e2e-phase-b.mjs       # ingest → export → checklist upload *
node apps/web/e2e-phase-c.mjs       # branches → scrutiny → CCRs → missing documents *
node apps/web/e2e-phase-d.mjs       # delivery order: B/L → free time → DO → deposit back *
node apps/web/e2e-phase-e.mjs       # clearance: noting → duty variance → out of charge → delivery
```

`*` makes real OpenAI calls — a handful per run.

`db:test:rls` is the regression net for the tenancy model: it creates two
throwaway companies and asserts that neither can read, rename, or re-parent the
other's rows, that a user cannot promote themselves to platform admin, and that
stored OAuth state is unreadable by anyone.

## Deployment

The web app deploys anywhere Next.js runs. The worker is a long-lived process,
so it needs its own service — `render.yaml` describes it as a Render
background worker. Point Supabase at a hosted project with
`supabase link` + `supabase db push`, and **remember to enable the access-token
hook in Dashboard → Authentication → Hooks**; the `config.toml` setting only
applies locally, and without it RLS returns nothing for everyone.

## Database

Migrations live in `supabase/migrations`. After changing one:

```bash
pnpm db:reset                       # re-runs every migration from scratch
pnpm db:types                       # regenerates packages/db/src/database.types.ts
```

Two things every new table needs, both easy to miss:

- `grant select, insert, update, delete on <table> to service_role;` — on
  current Supabase versions a freshly created table gives `service_role` only
  `REFERENCES/TRIGGER/TRUNCATE`, so service-role writes fail with
  "permission denied for table" without this.
- RLS policies with **both** `using` and `with check` on `update`. With only
  `using`, a member can re-parent a row into another tenant.

Tenancy is enforced by RLS reading `company_id` from the JWT, which is stamped
by `public.custom_access_token_hook`. Policy helpers read the token only and
never query a table — that is what keeps them free of recursion.
