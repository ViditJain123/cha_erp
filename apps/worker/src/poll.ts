import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@checklist/db';
import {
  DeltaExpiredError,
  ReauthRequiredError,
  ensureAccessToken,
  fetchAttachments,
  mailBodyToText,
  pollDelta,
  primeDelta,
  type GraphMessage,
} from '@checklist/graph';
import { processMessage } from '@checklist/ingest';
import { workerEnv } from '@checklist/config/env';
import { errorFields, log } from './logger.js';

type Db = SupabaseClient<Database>;
type Connection = Tables<'mail_connections'>;

/** Bounded so one busy mailbox cannot monopolise a tick. */
const MAX_MESSAGES_PER_POLL = 25;
const MAX_ATTEMPTS = 5;

export interface PollSummary {
  connectionId: string;
  email: string;
  discovered: number;
  processed: number;
  createdJobs: number;
  attached: number;
  skipped: number;
  failed: number;
}

/** Backoff on repeated failure, capped at roughly two and a half hours. */
function nextPollAfterFailure(failures: number): string {
  const base = workerEnv().WORKER_MAILBOX_INTERVAL_SECONDS;
  const factor = Math.min(2 ** failures, 32);
  return new Date(Date.now() + base * factor * 1000).toISOString();
}

function normalPollTime(): string {
  return new Date(Date.now() + workerEnv().WORKER_MAILBOX_INTERVAL_SECONDS * 1000).toISOString();
}

async function release(db: Db, connectionId: string, patch: Partial<Connection>): Promise<void> {
  await db
    .from('mail_connections')
    .update({ ...patch, locked_at: null, locked_by: null })
    .eq('id', connectionId);
}

/** Records everything the delta returned. The unique index makes replays free. */
async function recordMessages(
  db: Db,
  connection: Connection,
  messages: GraphMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  await db.from('mail_messages').upsert(
    messages.map((m) => ({
      company_id: connection.company_id,
      connection_id: connection.id,
      provider_message_id: m.id,
      internet_message_id: m.internetMessageId,
      conversation_id: m.conversationId,
      subject: m.subject,
      from_address: m.from?.emailAddress?.address ?? null,
      from_name: m.from?.emailAddress?.name ?? null,
      received_at: m.receivedDateTime,
      has_attachments: m.hasAttachments,
      // Stored as text whatever Graph sent. The instruction extractor reads
      // this; a mail whose body never landed is a job whose custom house and
      // BE type have no source at all.
      body_text: m.body?.content ? mailBodyToText(m.body.content) : (m.bodyPreview ?? null),
      body_preview: m.bodyPreview ?? null,
    })),
    { onConflict: 'connection_id,provider_message_id', ignoreDuplicates: true },
  );
}

/**
 * Polls one mailbox end to end: refresh the token, read the delta, store the
 * messages, then work through whatever is still unprocessed.
 *
 * Every stage is idempotent. A crash mid-poll leaves rows that the next tick
 * picks up, and re-running against the same delta page inserts nothing new.
 */
export async function pollConnection(db: Db, connection: Connection): Promise<PollSummary> {
  const summary: PollSummary = {
    connectionId: connection.id,
    email: connection.email_address,
    discovered: 0,
    processed: 0,
    createdJobs: 0,
    attached: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const accessToken = await ensureAccessToken(connection, async (tokens) => {
      // Persist before use: Microsoft rotates the refresh token on every
      // exchange, and losing the new one kills the connection within the hour.
      const { error } = await db.from('mail_connections').update(tokens).eq('id', connection.id);
      if (error) throw new Error(`Could not persist refreshed tokens: ${error.message}`);
    });

    let deltaLink = connection.delta_link;
    let messages: GraphMessage[] = [];

    if (!deltaLink) {
      // Never read history: prime a cursor at "now" and start from there.
      deltaLink = await primeDelta(accessToken);
    } else {
      try {
        const result = await pollDelta(accessToken, deltaLink);
        messages = result.messages;
        deltaLink = result.deltaLink;
      } catch (err) {
        if (!(err instanceof DeltaExpiredError)) throw err;
        // The cursor aged out. Re-prime rather than full-resync, which would
        // classify the entire mailbox.
        log.warn('delta cursor expired; re-priming', { connectionId: connection.id });
        deltaLink = await primeDelta(accessToken);
      }
    }

    summary.discovered = messages.length;
    await recordMessages(db, connection, messages);

    const { data: pending } = await db
      .from('mail_messages')
      .select('*')
      .eq('connection_id', connection.id)
      .is('processed_at', null)
      .eq('has_attachments', true)
      .lt('attempts', MAX_ATTEMPTS)
      .order('received_at', { ascending: true })
      .limit(MAX_MESSAGES_PER_POLL);

    for (const row of pending ?? []) {
      await db
        .from('mail_messages')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id);

      try {
        const { files, skipped } = await fetchAttachments(accessToken, row.provider_message_id);

        const result = await processMessage(db, {
          companyId: connection.company_id,
          connectionId: connection.id,
          mailMessageId: row.id,
          conversationId: row.conversation_id,
          subject: row.subject,
          fromAddress: row.from_address,
          attachments: files.map((f) => ({
            fileName: f.fileName,
            contentType: f.contentType,
            data: f.data,
          })),
        });

        // Distinguish "nothing we could read" from "nothing worth a job".
        const skipReason =
          result.skipReason === 'no_attachments' && skipped.length > 0
            ? `unsupported_attachments:${skipped.map((s) => s.reason).join(',')}`
            : result.skipReason;

        await db
          .from('mail_messages')
          .update({
            outcome: result.outcome,
            skip_reason: skipReason ?? null,
            job_id: result.jobId ?? null,
            match_score: result.matchScore ?? null,
            processed_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', row.id);

        summary.processed++;
        if (result.outcome === 'created_job') summary.createdJobs++;
        if (result.outcome === 'attached') summary.attached++;
        if (result.outcome === 'skipped') summary.skipped++;
      } catch (err) {
        if (err instanceof ReauthRequiredError) throw err;
        summary.failed++;
        log.error('message processing failed', {
          connectionId: connection.id,
          mailMessageId: row.id,
          ...errorFields(err),
        });
        await db
          .from('mail_messages')
          .update({
            outcome: 'error',
            last_error: err instanceof Error ? err.message.slice(0, 2000) : String(err),
            // processed_at stays null so the next tick retries, up to MAX_ATTEMPTS.
          })
          .eq('id', row.id);
      }
    }

    await release(db, connection.id, {
      delta_link: deltaLink,
      delta_updated_at: new Date().toISOString(),
      last_polled_at: new Date().toISOString(),
      next_poll_at: normalPollTime(),
      consecutive_failures: 0,
      last_error: null,
    });

    return summary;
  } catch (err) {
    const failures = connection.consecutive_failures + 1;

    if (err instanceof ReauthRequiredError) {
      // No amount of retrying fixes a revoked grant; only the user reconnecting.
      log.warn('mailbox needs reauthentication', {
        connectionId: connection.id,
        email: connection.email_address,
      });
      await release(db, connection.id, {
        status: 'needs_reauth',
        last_error: err.message.slice(0, 2000),
        consecutive_failures: failures,
      });
      return summary;
    }

    log.error('poll failed', { connectionId: connection.id, failures, ...errorFields(err) });
    await release(db, connection.id, {
      consecutive_failures: failures,
      last_error: err instanceof Error ? err.message.slice(0, 2000) : String(err),
      next_poll_at: nextPollAfterFailure(failures),
      // Stop hammering a mailbox that has been failing all day.
      ...(failures >= 10 ? { status: 'disabled' as const } : {}),
    });
    return summary;
  }
}
