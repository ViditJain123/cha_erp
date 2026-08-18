# Vercel deployment — `apps/web`

Architecture this assumes:

| Piece | Host |
| --- | --- |
| `apps/web` | Vercel |
| `apps/worker` | Windows box on-prem, as a service (`deploy/windows/`) |
| Postgres / Auth / Storage | Supabase (hosted) |

## Project settings

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | Next.js |
| Install Command | *(leave default — Vercel detects the pnpm workspace at the repo root)* |
| Build Command | *(default `next build`)* |
| Node version | 24 if offered; otherwise the highest available — see note below |

**Node version.** The repo pins Node 24 (`render.yaml`, and `packageManager: pnpm@11.20.0` via corepack). If Vercel's project settings don't offer 24, the build will run on their latest LTS. Nothing in `apps/web` is known to require 24 specifically, but confirm the build succeeds rather than assuming.

## Environment variables

Set all of these for **Production** (and Preview, if you use preview deploys).

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ypgvlhzwjfaquxsxzous.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(from Supabase dashboard)* | |
| `NEXT_PUBLIC_APP_URL` | production URL | See chicken-and-egg note below |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase dashboard)* | **Not** `NEXT_PUBLIC_` — bypasses RLS |
| `MS_CLIENT_ID` | *(Azure AD)* | |
| `MS_CLIENT_SECRET` | *(Azure AD)* | |
| `MS_REDIRECT_URI` | `<prod URL>/api/integrations/microsoft/callback` | Must be registered in Azure AD |
| `MS_TENANT_ID` | `common` | Kept as `common` by decision — see below |
| `TOKEN_ENCRYPTION_KEY` | **same value as the worker box** | See below |
| `GRAPH_TRANSPORT` | `graph` | Your dev env had `console` |
| `OPENAI_API_KEY` | *(OpenAI)* | |
| `RESEND_API_KEY` | *(Resend)* | Web-only: invites, password resets |
| `MAIL_FROM` | `ERP <noreply@munafaapp.in>` | Must be a verified Resend sender |
| `MAIL_TRANSPORT` | `resend` | |

Do **not** set on Vercel: `WORKER_*` (worker only), `SEED_ADMIN_*` (one-off script).

### `TOKEN_ENCRYPTION_KEY` must match the worker

`apps/web/app/api/integrations/microsoft/callback/route.ts:87` encrypts the OAuth refresh token set when a mailbox is connected; `apps/worker/src/poll.ts` decrypts it on every poll. Since those now run on different hosts, a mismatch means the worker can read no mailbox at all.

Copy the existing key from your current `.env.local`. Regenerating it orphans every mailbox already connected — they'd each need to be re-authorised.

### `NEXT_PUBLIC_APP_URL` chicken-and-egg

`NEXT_PUBLIC_*` values are inlined into the client bundle **at build time**, so changing this requires a redeploy, not just a settings save. And the value must be known before the first build that you actually use.

Cleanest order: deploy once with a placeholder, attach the real custom domain, set `NEXT_PUBLIC_APP_URL` and `MS_REDIRECT_URI` to it, then redeploy. Avoid the per-deployment `*-git-*.vercel.app` URLs — they change per branch and would silently break the OAuth redirect.

### `MS_TENANT_ID`

Kept as `common`. Note that `.env.example` and the code comments say `organizations` (work/school accounts only), because personal Microsoft accounts have different Graph delta semantics than the accounts a CHA actually uses. If mailbox polling ever behaves oddly for a personal account, this is the first thing to look at.

Whatever it is, it must match the worker box's `.env.local` — the web app obtains the token and the worker refreshes it.

## Before the first deploy

1. **Commit and push.** There are ~20 modified files on `main`; Vercel builds what's pushed.
2. **`supabase db push`** against the hosted project.
3. **Enable the access-token hook** — Supabase Dashboard → Authentication → Hooks → `custom_access_token_hook`. The `config.toml` setting is local-only. Without it, RLS returns nothing for every user and the app looks completely broken with no useful error.
4. **Create the Storage buckets** the upload routes write to (`api/jobs/[id]/export`, `.../checklist`, `.../do/documents`, `.../requests/[requestId]/document`).
5. **Register the production redirect URI** in the Azure AD app registration.
6. **Decide what to do about `/legacy`** — see below.

## The `/legacy` problem

`apps/web/app/api/legacy/jobs/[id]/approve/route.ts:17` calls `chromium.launch()`, and `playwright` is a full dependency of `@checklist/web`.

On Vercel this builds fine — `serverExternalPackages: ['playwright']` keeps it unbundled — but it throws at runtime, because no browser binaries exist in the function. The `playwright` install also adds significant weight to every build.

Two other legacy-only issues point the same way:

- `apps/web/lib/store.ts` writes job files to `apps/web/data/jobs` with `mkdir`/`writeFile`. Vercel's filesystem is ephemeral.
- `apps/web/data/` is gitignored, so the masters and the 23MB library index won't exist in production at all.

The live pipeline is unaffected — it uses Supabase Storage throughout, and `proposeTariffFromLibrary` / `enrichDraftFromLibrary` have no non-legacy callers. So the clean move is to drop `app/legacy` and `app/api/legacy` from the deployed app and remove `playwright` from `apps/web/package.json`.

If you need the legacy checklist generator to keep working in production, it can't be on Vercel — it would need the same on-prem box as the worker, or a container host.

## Smoke test after deploy

1. Sign in — proves the access-token hook is stamping `company_id` (this is the step that fails if you skipped it).
2. Upload a document to a job — proves Storage buckets and keys.
3. Connect a mailbox — proves Azure AD redirect + `TOKEN_ENCRYPTION_KEY` on the web side.
4. Watch `logs\worker.log` on the Windows box for a `polled mailbox` line — proves `TOKEN_ENCRYPTION_KEY` matches across hosts, which nothing before this step tests.
