# Running the mailbox watcher on Windows

The worker is outbound-only — it claims a mailbox, polls Graph, writes to Supabase. Nothing ever connects *to* it, so an on-prem box needs no public IP, no port forwarding and no tunnel.

## Setup

1. Install **Node 24** and **[NSSM](https://nssm.cc/download)**, both on `PATH`.
2. Clone the repo to a path **without spaces** — `C:\erp\checklist-app`.
3. `corepack enable` then `corepack pnpm install --filter "@checklist/worker..."`
   (the filter excludes `@checklist/web`, so playwright never downloads browsers here)
4. `copy deploy\windows\env.local.template .env.local` and fill it in (it goes at the **repo root**, not in this directory).
5. Lock the env file down — it holds a full RLS-bypass key:
   ```bat
   icacls "C:\erp\checklist-app\.env.local" /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)"
   ```
6. From an **Administrator** prompt: `deploy\windows\install-service.bat`

To deploy new code later: `deploy\windows\update.bat` (also Administrator).

## Windows has no SIGTERM

`apps/worker/src/index.ts:57` registers a SIGTERM handler and the comment above it refers to Render's SIGTERM-then-SIGKILL. On Windows that handler is dead code — Node lets you listen for SIGTERM but never delivers it. Only SIGINT arrives, and only from a real console Ctrl+C.

Two things follow:

- **Node must be invoked directly**, not via `corepack pnpm --filter ... start`. Wrapper processes sit between NSSM and Node and swallow the Ctrl+C. `install-service.bat` points NSSM straight at `node.exe` running `tsx/dist/cli.mjs` for exactly this reason.
- **`AppStopMethodConsole` must exceed the drain window.** It defaults to 1500ms; `index.ts:52` drains for up to 25s. The script sets 30000.

**Verify it actually works** — `nssm stop ErpMailWatcher`, then look for `"shutting down"` in `logs\worker.log`. If that line is missing, every stop is a hard kill.

The blast radius if it is: `tick.ts` claims mailboxes one at a time (`claim_mail_connection` has `limit 1`), so a hard kill strands exactly one mailbox, and the 10-minute staleness window in the migration reclaims it automatically. One mailbox polling late after a restart — worth fixing, not worth losing sleep over.

## Keeping the box actually always-on

These are what break on-prem Windows hosts in practice:

- **Windows Update auto-restart.** Set active hours and disable automatic restart. The service is `SERVICE_AUTO_START` so it returns on boot — but confirm that by rebooting once, deliberately.
- **Sleep.** Set the power plan to never sleep and never turn off disks. A sleeping box stops the loop with nothing in the log.
- **Power loss.** Set the BIOS/UEFI to power on automatically after AC restore.
- **No auto-login needed.** A Windows Service runs with nobody logged in — the main reason to use one over a scheduled task.

## Two-host consequences

`TOKEN_ENCRYPTION_KEY` must be byte-identical here and in Vercel. The web app encrypts OAuth refresh tokens at connect time, this worker decrypts them on every poll. Nothing tests that they match until a real mailbox poll runs — see the smoke test in [`../VERCEL_ENV.md`](../VERCEL_ENV.md).

Deploys are two-step: Vercel updates on push, this box does not. Run `update.bat` after any change to `apps/worker`, `packages/graph`, `packages/ingest` or `packages/extraction`.

Don't run `pnpm dev` on this box — the root script starts the web app *and* a second worker in parallel. The `for update skip locked` claim keeps that safe rather than corrupting anything, but the two will fight over mailboxes. Use `pnpm dev:web` if you need to develop here, and keep `WORKER_INSTANCE_ID` unique per worker.

## Security

This machine holds `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS across every tenant), `MS_CLIENT_SECRET` and `OPENAI_API_KEY`. Enable BitLocker, don't share the login, and keep the `icacls` restriction above in place.
