import '@checklist/config/load-env';
import { serviceClient } from '@checklist/db';
import { workerEnv } from '@checklist/config/env';
import { errorFields, log } from './logger.js';
import { tick } from './tick.js';

/**
 * The mailbox watcher.
 *
 * A self-rescheduling timeout rather than setInterval or node-cron: the next
 * tick is scheduled only after the current one finishes, so a slow poll can
 * never overlap the one behind it.
 */

const db = serviceClient();
let running = true;
let inFlight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(): Promise<void> {
  const intervalMs = workerEnv().WORKER_TICK_SECONDS * 1000;

  while (running) {
    const startedAt = Date.now();
    try {
      inFlight = tick(db);
      await inFlight;
    } catch (err) {
      // A failed tick must never end the process; the next one may succeed.
      log.error('tick failed', errorFields(err));
    } finally {
      inFlight = null;
    }

    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, intervalMs - elapsed);
    // Wake early on shutdown rather than sitting out the whole interval.
    for (let waited = 0; running && waited < wait; waited += 250) {
      await sleep(Math.min(250, wait - waited));
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (!running) return;
  log.info('shutting down', { signal });
  running = false;

  // Render sends SIGTERM and follows with SIGKILL after 30s. Finishing the
  // in-flight poll releases its claim lock; being killed mid-poll leaves the
  // mailbox locked until the 10-minute staleness window expires.
  await Promise.race([inFlight ?? Promise.resolve(), sleep(25_000)]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const once = process.argv.includes('--once');

if (once) {
  // Single pass for local testing and for running as a scheduled job.
  tick(db)
    .then(() => {
      log.info('single tick complete');
      process.exit(0);
    })
    .catch((err: unknown) => {
      log.error('single tick failed', errorFields(err));
      process.exit(1);
    });
} else {
  log.info('watcher started', {
    tickSeconds: workerEnv().WORKER_TICK_SECONDS,
    mailboxIntervalSeconds: workerEnv().WORKER_MAILBOX_INTERVAL_SECONDS,
    instance: workerEnv().WORKER_INSTANCE_ID,
  });
  void loop();
}
