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

Noting itself has no system. The dashboard reports jobs sitting there and
nothing more.

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
```

`*` makes real OpenAI calls — a handful per run.

`db:test:rls` is the regression net for the tenancy model: it creates two
throwaway companies and asserts that neither can read, rename, or re-parent the
other's rows, that a user cannot promote themselves to platform admin, and that
stored OAuth state is unreadable by anyone.

## Deployment

The web app deploys anywhere Next.js runs. The worker is a long-lived process,
so it needs its own service — `apps/worker/render.yaml` describes it as a Render
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
