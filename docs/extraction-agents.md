# Multi-agent extraction

A design for replacing the one-prompt-per-document reader in
`packages/extraction` with a set of narrow agents, split by document family
and by field group, with verification and reconciliation between them. The
goal is stated by the person who asked for it: **an agent that cannot
hallucinate a value onto a Bill of Entry.**

## What is built (2026-09-26): the job agent

The first piece is not the family readers below but the step after them: one
agentic loop per job, over **all** the documents at once, that decides what
the four one-shot enrichment calls used to decide alone — the tariff item,
the BCD concession, the IGST and cess serials, the Exim scheme behind a
licence, and whether the documents contradict each other. It lives in
`packages/extraction/src/agent/` and is switched by `JOB_AGENT=off|shadow|on`
(default `shadow`: it runs and is recorded in `job_agent_runs`, and the
one-shot path still decides).

| Module | Does |
|---|---|
| `loop.ts` | The Responses API tool loop: function tools + built-in `web_search`, `previous_response_id` chaining, a budget (turns, tool calls, web searches, output tokens, deadline), one forced final turn with no tools. |
| `tools.ts` | Twelve tools over the masters, the library and the job files: `lookup_tariff`, `resolve_tariff_prefix`, `search_product_index`, `chapter_notes`, `bcd_candidates`, `igst_candidates`, `comp_cess_candidates`, `read_notification_text`, `lookup_notification` (the CBIC index), `exim_scheme_for_licence`, `fta_check`, `read_document`. Every output is trimmed; every filable value is registered. |
| `registry.ts` | What the tools returned this run. The answer is validated against it. |
| `output.ts` | The final schema: reason before value, evidence beside every decision, `conditionEstablishedBy` for a conditioned entry. |
| `apply.ts` | Writes the answer to the draft and says no: unregistered values, web-only evidence, a reason that argues against its value, a condition nobody quoted, IGCR, List and stale entries — each a flag, not a value. Operator decisions are never overwritten. |
| `context.ts` | The first turn, four to eight thousand tokens: the consignment, the document table (with ingest's `license` label on files extraction typed `other`), the lines, the open flags. |
| `notification-index.ts` | `data/customs-corpus/index/cbic-notifications.json` as a number/title lookup. |
| `job-agent.ts` | The instructions and the orchestration; returns the draft and a `JobAgentRun` for `job_agent_runs`. |

The rules the loop is held to are the invariants listed further down, with
two of them now code: *models pick, masters name* is `CandidateRegistry`, and
*the web never files* is `apply.ts` refusing any decision whose evidence is
all `web:`.

Alongside it, three deterministic fixes that do not need the agent: the IGST
and BCD lookups are dated (`igstRateForCth(cth, {onIsoDate})`,
`bcdExemptionMatches(cth, {onIsoDate})`; a filing before 2025-09-22 is under
1/2017-IT(R) with no serial, before 2025-11-01 under 50/2017 with no
concession), the one-shot chooser refuses an entry whose own reason says the
condition is not met (`bcdReasonRefuses`), and a licence's notification files
in the Exim slot with its serial and IGST exemption (`EXIM_SCHEME_ENTRIES`).
The product master no longer remembers a line's notification choices unless
the operator ticks the box for it.

Measured on the corpus with `JOB_AGENT=shadow` then `on` over
`corpus-export.mts --only ex_job20,ex_job21,ex_job25,ex_job26,ex_job28,liv_job1`
and `corpus-compare.py` — the six jobs whose Basic_Notn, IGST or Exim columns
the one-shot path got wrong.

---

The rest of this document is the wider design: the per-document readers, split
by family and field group. Not built.


## What exists today, and where it is one agent

`runPipeline` (`src/pipeline.ts`) does four things:

1. `classifyDoc` — one call per file, returning every document type the file
   contains.
2. `extractDoc` — one call per (file, type). The **whole file** is sent each
   time with the type's prompt and the type's full schema. An invoice call asks
   for ~45 fields plus every line item plus charges plus batches in one answer.
3. `verifyContainers` — a second, narrow read of a bill of lading that asks for
   nothing but the container list, triggered when the first read looks thin.
4. `mergeToDraft` — deterministic reconciliation into a `ChecklistDraft`.

Then `apps/web/lib/draft-pipeline.ts` runs four model-backed enrichments
(classification, library, description, notification choice), each of which
already follows the right discipline: **the masters build a candidate list, the
model returns an index into it, and it cannot emit a code of its own.**

So "the single agent doing all the heavy lifting" is step 2. Everything a
document says reaches the draft through one large structured-output call, and
that call has three ways to be wrong that no downstream step can see:

- **The file is not the document.** A bundle of thirteen pages gets sent to
  the invoice reader, the packing-list reader and the certificate reader in
  turn, each told to find its own document. The invoice reader is looking at a
  licence's item table, a packing list's weights and a certificate's HS codes
  while it reads the invoice, and every one of those is a plausible source for
  a field it is asked to fill. This is how a licence's numbers reach an
  invoice line.
- **The schema is too wide for the attention.** The container list "is the one
  field on a B/L that has come back wrong on every job we hold" — because it
  is one of forty fields in the same answer. `verifyContainers` fixed that one
  field by asking for it alone. The same shape of bug exists for every other
  list on every other document (invoice lines, packing rows, certificate
  items, shipping-bill items) and for every long tail field (net weight in the
  description block, the house AWB in a corner).
- **A value is not tied to the page.** The extract returns `blNumber:
  "A07GX14312"` and nothing says where on the page that string is. A verifier
  cannot check it; an operator cannot click through to it; and a model that
  produced it from pattern rather than from print looks identical to one that
  read it.

`uncertainFields` and the placeholder scrub in `openai.ts` are the current
defences. They catch a model that *says* it is unsure; they cannot catch one
that is confidently wrong.

## The design

Five stages. Each stage's agents see less than the one before, and every value
that reaches the merge carries its evidence.

```
 file ─▶ ①segment ─▶ ②family agents ─▶ ③field-group agents ─▶ ④verify ─▶ ⑤reconcile ─▶ mergeToDraft
              │             │                 │                    │            │
           page ranges   one family        one schema,          read-back    cross-document
           per document  per segment       one segment          per value    arithmetic + arbiter
```

### ① Segment: pages, not files

Replace `classifyDoc(file) → DocType[]` with `segment(file) → Segment[]`, where
a segment is a document type **and the page range it occupies**:

```ts
interface Segment {
  fileName: string;
  docType: DocType;
  pages: number[];          // 1-based, contiguous or not (a B/L rider on page 9)
  confidence: number;
  reason: string;           // "commercial invoice header on p.1, continuation on p.2"
}
```

Implementation: render each page (`pdftoppm`/`pdf-lib` at a modest DPI),
classify pages in batches of eight with a per-page label, and collapse runs
into segments. A page that continues the previous document ("continuation",
no header, same invoice number in the footer) inherits its label. Text-layer
PDFs get their text alongside the image, which is what makes stage ④ cheap.

From here on, **no agent is ever handed a page outside its segment.** The
invoice reader cannot see the licence because the licence is not in its
input. This alone removes the failure mode behind "notification numbers from
the licences" at the source rather than at the sink.

### ② Family agents: grouped by document similarity

Documents that share a vocabulary and a layout share an agent. The families,
and what each one owns:

| Family | Document types | Owns |
|---|---|---|
| **Commercial** | invoice, proforma, purchase order, contract, high-seas agreement | parties, currency, terms, values, payment, the goods lines |
| **Transport** | bill of lading, air waybill, freight certificate | conveyance, dates, ports, packages, weights, containers, freight |
| **Origin & compliance** | certificate of origin, certificate of analysis, insurance certificate, bank certificate | origin claims, batches and dates, premium, exchange rate |
| **Regulatory** | shipping bill, into-bond BE, GST tax invoice | ICES-shaped documents: serials, port codes, scheme flags, warehouse codes |
| **Licence** | DGFT authorisation, scrip, TRQ, FSSAI/WPC/drug licence | licence number, date, issuing port, item table, validity — *for the licence master only, never for the ITEMS sheet* |

A family agent is a **coordinator, not a reader**: it decides which field
groups apply to its segment (an invoice with no batch column does not get a
batches reader), runs them, and assembles the family's `ExtractedDoc`. Its
prompt knows the family's conventions — that a B/L prints the carrier in the
signature block, that an ICES document has a fixed header block — and nothing
about the other families.

The licence family is new and is the direct answer to the request. Today a
licence is `other` and its data is null; the licence master is filled by hand.
With a reader of its own it feeds `licences` / `licence_import_items`, and its
output is **typed so that it cannot reach an item**: `LicenceExtract` has no
`hsCode`, no `unitPrice`, no `notification` field, only `issuedUnder` (the
scheme notification, for `eximSchemeForNotification`) and the import-item table
keyed by the licence's own serials.

### ③ Field-group agents: one schema each

Inside a family, the reading is done by agents with **small schemas** — six to
twelve fields — each with a prompt written for exactly those fields, following
the `verifyContainers` pattern. For the invoice:

| Group | Fields | Why it is its own agent |
|---|---|---|
| header | number, date, currency, delivery terms, payment terms, PO/contract/LC refs | short, high-stakes identifiers |
| parties | seller, seller city/country, buyer, manufacturer | address blocks confuse a reader that is also counting lines |
| lines | description, HS as printed, quantity + unit, unit price, amount, per-line origin, NCV | the list; asked to count its rows and to sum them |
| charges | freight, insurance, handling, other; which are inside the price | the C&F/CIF gate depends on it alone |
| batches | batch, mfg, expiry, best-before, per line | only run when the header agent reports a batch column |

Every group agent returns, for every value, **where it read it**:

```ts
interface Evidence { page: number; quote: string }        // verbatim, ≤ 200 chars
type Read<T> = { value: T; evidence: Evidence } | { value: null; reason: 'absent' | 'illegible' };
```

`Read<T>` is what the schema types every field as. A value with no quote is
not a value; the zod schema refuses it and the call is retried once with the
refusal in the prompt, then escalated to `MODELS.escalate`, then left null with
`uncertainFields` naming it. The merge continues to receive plain values —
`toExtractedDoc()` strips the evidence into a side table keyed by JSON path —
so `mergeToDraft` does not change.

Numbers are re-parsed from the quote, not trusted from the value. The
`49.500,000 KGS` separator rule in `EXTRACT_COMMON` becomes code: given the
quote and the value, `parseQuotedNumber(quote)` must reproduce the value under
one of the two conventions, or the field is flagged. A quantity a thousand
times too large cannot pass this.

### ④ Verify: read-back on every high-stakes value

A verifier is a second call, on a **different model** from the reader
(`MODELS.classify` reads back what `MODELS.extract` read; a disagreement
escalates to `MODELS.escalate`), that is shown the evidence page and one
candidate value and asked one question:

> Does this page state that the {field} is {value}? Answer `yes`, `no`, or
> `not on this page`, and quote the text that decides it.

Which fields: everything that lands on the Bill of Entry as a number, a date,
a code or an identifier — B/L and AWB numbers, container numbers and seals,
invoice numbers and dates, currencies, every quantity, unit price and amount,
every weight, every HS code as printed, certificate numbers, shipping bill
serials. Free text (descriptions, addresses, marks) is not verified; it is
displayed with its quote for a person.

Cheap, because the verifier sees one page and one value, and because with a
text layer the first check is not a model call at all: `quote` must be found
in the page text (whitespace-insensitive, ≥ 0.9 similarity) or the value is
rejected before any verifier runs. Scans without a text layer go straight to
the model verifier.

`verifyContainers` is the existing instance of this stage. It stays, and
becomes the template: `verify(kind, segment, candidates)` with `kind` one of
`list`, `number`, `identifier`, `date`.

### ⑤ Reconcile: deterministic first, arbiter last

Cross-document checks that are arithmetic run in code and need no model:

- Σ line amounts = invoice total; Σ invoice values = B/L or AWB declared value
  where stated.
- Σ packing rows = packing total = B/L package count; Σ packing net weights =
  B/L net weight (± 0.5%).
- container list length = stated count, on the B/L and on the packing list.
- certificate-of-origin items ⊆ invoice lines by HS prefix and description
  similarity; each COO item's quantity ≤ the matched line's.
- shipping-bill invoice/item serials exist on the shipping bill for every
  re-import line; into-bond BE serials exist for every ex-bond line.
- freight certificate's B/L or invoice reference matches the job's.

Each check produces a **conflict** when it fails, naming both documents, both
values and both quotes. Conflicts are resolved in this order:

1. **Precedence rule** in `mergeToDraft`, as today (the certificate's producer
   over the invoice's manufacturer, the B/L's net weight over the packing
   list's when both are stated).
2. **Arbiter agent**, only for a conflict no rule settles: it is shown the two
   quotes and the two pages, nothing else, and asked which document states the
   fact directly and which restates it. It returns an index and a reason.
3. **Operator**, as a `DraftFlag` with `severity: 'error'`, when the arbiter
   is not confident. A conflict is never silently averaged or defaulted.

## The invariants

These are the properties the design exists to hold, stated so a reviewer can
check a change against them:

1. **Segment isolation.** An agent's input is exactly the pages of its
   segment. There is no code path that sends a whole file to a family reader.
2. **Evidence or null.** Every leaf value in an `ExtractedDoc` has a page and a
   quote, or is null with a reason. The schema enforces it; the merge sees only
   values that passed.
3. **Numbers come from quotes.** A numeric value that the quote does not
   reproduce under a recognised separator convention is rejected.
4. **Models pick, masters name.** No agent emits a tariff code, a station code,
   a notification number, a scheme code, a currency code or a country code. It
   returns text as printed or an index into a candidate list the masters built.
   (Already the rule for the four enrichments; this extends it to extraction.)
5. **Two readers for anything that files.** Every value on the verify list has
   been read by one model and confirmed by another, or is flagged.
6. **Conflicts surface; they are never resolved by default.** A disagreement
   between documents ends in a precedence rule, an arbiter's reasoned pick, or
   an operator's decision — each recorded on the draft.
7. **The licence family cannot write to ITEMS.** Its output type has no field
   the ITEMS mapper reads. What a licence says about duty reaches the line only
   through `applyLicenceResolution` and `resolveItems`, which is where the
   guard added on 2026-09-26 lives.
8. **Every agent is replayable.** Inputs (segment pages, prompt, schema) and
   outputs are stored per call on the job, so a prompt change can be measured
   on the corpus without paying for a full re-read (`corpus-replay.mts` does
   this for the mappers today; it extends to each stage).

## Where it lives

```
packages/extraction/src/
  agents/
    segment.ts          ① page classification → Segment[]
    evidence.ts         Read<T>, Evidence, quote grounding, parseQuotedNumber
    families/
      commercial.ts     ② coordinator + ③ header/parties/lines/charges/batches
      transport.ts      ② + ③ conveyance/packages/containers/freight
      origin.ts         ② + ③ coo/coa/insurance/bank
      regulatory.ts     ② + ③ shipping-bill/into-bond/gst
      licence.ts        ② + ③ licence header + item table
    verify.ts           ④ read-back; verifyContainers moves here as verify('list')
    reconcile.ts        ⑤ arithmetic checks, conflict type, arbiter
  pipeline.ts           orchestration only: segment → families → verify → reconcile → merge
  merge.ts              unchanged
```

`ExtractedDoc` gains `segment: Segment` and `evidence: Record<jsonPath,
Evidence>`; `docs` stored on `job_drafts` carry both, and the job screen shows
the quote beside every value that has one.

Model budget per job, for the corpus median (a five-document job): today
≈ 6 calls; this design ≈ 1 segment + 5 family × ~3 groups + ~25 verifier
read-backs ≈ 40 calls, most of them small and on the cheap model. The
verifier read-backs on text-layer PDFs are mostly free. Measured, not
estimated, in phase 3 below.

## What to build first, and how to know it worked

Each phase is measurable on the corpus before the next starts. The scorecard
is `apps/web/scripts/corpus-compare.py` against the vendor's own exports; the
extraction eval is `packages/extraction/eval/run.ts`.

**Phase 1 — segmentation and evidence (foundation).** Build `segment.ts` and
`evidence.ts`; convert the existing per-type prompts to receive a segment and
return `Read<T>`. No new agents yet. *Measure:* every value on every corpus
draft has a quote; the number of values whose quote is not found in the page
text (the grounding failures) — that count is the hallucination rate this
whole design is chasing, and it has never been measured.

**Phase 2 — split the invoice reader.** Commercial family with the five field
groups. The invoice is the document with the most fields, the most lines and
the most downstream consequence. *Measure:* invoice-line count and Σ amount
against the vendor's ITEMS rows on all 26 exporting jobs; ex_job5's twelve
invoices in one file is the acceptance case.

**Phase 3 — verifiers.** `verify.ts` with the read-back list; `verifyContainers`
becomes its first client. *Measure:* verifier disagreement rate by field; cost
per job; the set of values the verifier rejected that the vendor also filed
differently (true catches) versus rejected and the vendor agreed with us
(false alarms).

**Phase 4 — the remaining families and the licence reader.** Transport,
origin, regulatory as families; licence as a new one feeding the licence
master. *Measure:* LICENSE sheet fill rate on ex_job20/25/26/28 (0% today).

**Phase 5 — reconciliation and the arbiter.** *Measure:* conflicts found per
job; how many end in a rule, an arbiter pick, or an operator flag; and whether
the operator overturns arbiter picks.

Phase 1 changes no behaviour and produces the one number nobody has. Start
there.
