import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@checklist/db';
import { workerEnv } from '@checklist/config/env';
import { errorFields, log } from './logger.js';
import { pollConnection } from './poll.js';

type Db = SupabaseClient<Database>;

/** Safety valve: never poll more than this many mailboxes in one tick. */
const MAX_CONNECTIONS_PER_TICK = 20;

/**
 * Claims mailboxes that are due and polls them one at a time.
 *
 * Per-connection cadence lives on the row (`next_poll_at`), not in the loop, so
 * many mailboxes stagger naturally across the interval instead of all firing
 * together on the minute.
 */
export async function tick(db: Db): Promise<void> {
  const worker = workerEnv().WORKER_INSTANCE_ID;
  let claimed = 0;

  for (let i = 0; i < MAX_CONNECTIONS_PER_TICK; i++) {
    const { data, error } = await db.rpc('claim_mail_connection', { p_worker: worker });
    if (error) {
      log.error('could not claim a mailbox', errorFields(error));
      return;
    }

    const connection = (data as Tables<'mail_connections'>[] | null)?.[0];
    if (!connection) break; // nothing else is due

    claimed++;
    const summary = await pollConnection(db, connection);
    log.info('polled mailbox', { ...summary });
  }

  if (claimed > 0) log.debug('tick complete', { claimed });
}
