# Running the mailbox watcher on EC2

The worker is outbound-only — it claims a mailbox, polls Graph, writes to Supabase. Nothing connects *to* it, so the security group needs **no inbound rules at all** except your SSH access (and even that is better handled by SSM Session Manager, which needs none).

## Why Linux beats the Windows box here

`apps/worker/src/index.ts:57` registers a SIGTERM handler and drains the in-flight poll for up to 25 seconds before exiting. **Windows never delivers SIGTERM**, so that path only works there via an NSSM Ctrl+C hack that has to be configured and verified by hand.

On Linux it just works: systemd sends SIGTERM natively, and `TimeoutStopSec=45` in the unit comfortably covers the drain. That's one less thing to get wrong, and it means restarts never strand a mailbox behind the 10-minute staleness window.

You also lose Windows Update auto-reboots, sleep, and power-loss as failure modes.

## Instance sizing

**Testing / free tier: `t3.micro`** (2 vCPU, 1 GB) if your account still has the classic 12-month free tier — that covers 750 hours/month of `t2.micro` or `t3.micro`, i.e. one instance running continuously. `setup.sh` detects under 2 GB of RAM and adds a 2 GB swapfile, which matters here (see below).

Set the instance to **standard** CPU-credit mode, not unlimited. `t3` defaults to unlimited, which bills for surplus credits. A poll loop that wakes every 60s will never exhaust its baseline, so standard mode just removes the possibility of a surprise line item.

**Production: `t4g.small`** (2 vCPU ARM, 2 GB) — roughly $12/month in ap-south-1, less with a Savings Plan.

Attachments are held fully in memory: `packages/ingest/src/process.ts` passes `attachment.data` around as Buffers for hashing, triage and upload, and there is no inbound size cap in the ingest path. A tick can process up to 20 mailboxes (`MAX_CONNECTIONS_PER_TICK`) sequentially, each with several PDFs. Customs documents are usually small, but 1 GB is tighter than it looks once tsx's transpile cache and the Node heap are in there too.

That is why the swapfile matters on 1 GB. It is a safety net, not a plan: if you see the worker actually swapping under real mail volume, move up rather than living on it.

Note that the `t4g.micro` free trial ended on 31 Dec 2025, so ARM is not a free-tier option any more — `t3.micro` (x86) is.

Graviton/ARM is fine — Node and tsx both ship arm64 builds.

**Region:** latency is irrelevant here (the loop polls every 300s), so pick on data residency and cost. ap-south-1 (Mumbai) is the obvious choice for an Indian CHA.

## Setup

```bash
# Ubuntu 24.04 LTS AMI, then:
sudo bash deploy/ec2/setup.sh
```

The script installs Node 24 via NodeSource, creates an `erp` system user, clones to `/opt/erp/checklist-app`, runs a **filtered** install (`--filter "@checklist/worker..."`, which excludes `@checklist/web` so playwright never downloads browsers), installs the systemd unit with the correct node path, and seeds `.env.local` at mode 600.

Then fill in `/opt/erp/checklist-app/.env.local` — the template at `deploy/windows/env.local.template` documents every field — and:

```bash
sudo systemctl enable --now erp-mail-watcher
journalctl -u erp-mail-watcher -f -o cat
```

`logger.ts` writes single-line JSON to stdout, which journald captures. `-o cat` strips journald's prefix so the JSON stays greppable; rotation is journald's job, so there is nothing to configure.

Set `WORKER_INSTANCE_ID` to something unique for the box (`ec2-mumbai-1`). It lands in `claim_mail_connection`'s `locked_by` column and in every log line.

## Secrets

The setup above keeps `.env.local` on disk at mode 600, owned by `erp`. That is fine, but EC2 gives you something better.

`packages/config/src/load-env.ts` states that real environment variables win over the file. So you can drop the file entirely and inject secrets from **SSM Parameter Store** or **Secrets Manager** with no code change — attach an instance role, then add a `ExecStartPre` that writes them into the environment, or use a `systemd` drop-in with `EnvironmentFile=` pointing at a tmpfs file the pre-start step populates.

Worth doing if this ever holds another tenant's data: an instance role scoped to specific parameters is revocable and auditable in a way a file on a disk is not.

The one value that must be byte-identical to Vercel is `TOKEN_ENCRYPTION_KEY` — the web app encrypts OAuth refresh tokens, this worker decrypts them.

## Updates

```bash
sudo bash /opt/erp/checklist-app/deploy/ec2/update.sh
```

Stop → `git pull` → filtered install → start. Run it after changes to `apps/worker`, `packages/graph`, `packages/ingest` or `packages/extraction`. Vercel updates itself on push; this box does not.

## Alternatives considered

**Lambda + EventBridge.** `index.ts:62` supports `--once` explicitly "for running as a scheduled job", and the worker is stateless — the claim lock and `next_poll_at` both live in Postgres. So a scheduled Lambda is genuinely viable and removes the box entirely.

Two things make it awkward: tsx isn't a natural Lambda runtime (you'd bundle or precompile), and a tick that processes 20 mailboxes with OpenAI calls on each PDF can run long against the 15-minute ceiling. Worth revisiting if the box becomes a maintenance burden; not worth it as the first move.

**ECS Fargate.** No instance to patch, but you need a container image, ECR, and a task definition — more moving parts than a single systemd unit for one always-on process.

**Keeping the on-prem Windows box.** Still legitimate — it's free, and the failure mode (a stranded mailbox for 10 minutes) is mild. The EC2 case is about eliminating the Windows-specific footguns, not about capability.
