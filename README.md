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

There is no importer master, so a bond is matched on `jobs.importer_name` plus
aliases — which means a misspelled importer looks exactly like a genuinely
uncovered job. The UI therefore says *which* it found: "no bond is recorded for
this importer" reads differently from "a bond exists but does not cover this
mode", and both differ from silence.

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
