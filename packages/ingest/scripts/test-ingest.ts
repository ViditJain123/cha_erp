/**
 * End-to-end ingest check against the local stack, using the real example job
 * PDFs instead of a mailbox. Exercises triage, identifier extraction, job
 * matching, storage and deduplication.
 *
 *   pnpm ingest:test
 *
 * Makes real OpenAI calls — a handful per run.
 */
import '@checklist/config/load-env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serviceClient } from '@checklist/db';
import { processMessage, type IncomingAttachment } from '../src/index.js';

// Resolved from this file, not the working directory, so the script runs
// the same however it is invoked.
const EXAMPLES = path.resolve(import.meta.dirname, '../../../..');
const db = serviceClient();

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function pdf(relative: string): IncomingAttachment {
  const full = path.join(EXAMPLES, relative);
  return {
    fileName: path.basename(relative),
    contentType: 'application/pdf',
    data: readFileSync(full),
  };
}

async function recordMail(
  companyId: string,
  connectionId: string,
  opts: { subject: string; conversationId: string; providerId: string },
): Promise<string> {
  const { data, error } = await db
    .from('mail_messages')
    .insert({
      company_id: companyId,
      connection_id: connectionId,
      provider_message_id: opts.providerId,
      conversation_id: opts.conversationId,
      subject: opts.subject,
      from_address: 'forwarder@example.test',
      has_attachments: true,
      received_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'could not record mail');
  return data.id;
}

async function main() {
  const stamp = Date.now().toString().slice(-6);

  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name: `Ingest Test ${stamp}`, slug: `ingest-test-${stamp}` })
    .select('id')
    .single();
  if (companyError || !company) throw new Error(companyError?.message ?? 'no company');

  const email = `ingest-${stamp}@example.test`;
  const { data: user } = await db.auth.admin.createUser({
    email,
    password: 'IngestTest2026x',
    email_confirm: true,
  });
  const userId = user!.user!.id;
  await db.from('profiles').insert({
    id: userId,
    email,
    company_id: company.id,
    role: 'company_owner',
    team: 'scrutiny',
    must_change_password: false,
    status: 'active',
  });

  const { data: connection, error: connError } = await db
    .from('mail_connections')
    .insert({
      company_id: company.id,
      profile_id: userId,
      provider: 'microsoft',
      provider_account_id: `ingest-${stamp}`,
      email_address: email,
      // Disabled on purpose: this fixture has no OAuth tokens, so the watcher
      // must not try to poll it. It exists to satisfy the mail_messages FK.
      status: 'disabled',
    })
    .select('id')
    .single();
  if (connError || !connection) throw new Error(connError?.message ?? 'no connection');

  const base = { companyId: company.id, connectionId: connection.id };

  try {
    // ------------------------------------------------- a new shipment ----
    console.log('\nFirst email opens a job\n');
    const mail1 = await recordMail(company.id, connection.id, {
      subject: 'Docs for shipment 14075',
      conversationId: `conv-a-${stamp}`,
      providerId: `msg-1-${stamp}`,
    });
    const first = await processMessage(db, {
      ...base,
      mailMessageId: mail1,
      conversationId: `conv-a-${stamp}`,
      subject: 'Docs for shipment 14075',
      fromAddress: 'forwarder@example.test',
      attachments: [pdf('ex_job4/14075 BL.pdf'), pdf('ex_job4/14075 INV AND PACK.pdf')],
    });
    check('a job is created', first.outcome === 'created_job', first.outcome);
    check('both documents are stored', first.documentsAdded === 2, `${first.documentsAdded} added`);

    const jobA = first.jobId as string;
    const { data: docsA } = await db.from('job_documents').select('doc_type, file_name').eq('job_id', jobA);
    const types = (docsA ?? []).map((d) => d.doc_type);
    console.log(`      classified as: ${types.join(', ')}`);
    check('at least one document is recognised as a trade document',
      types.some((t) => t !== 'unknown'));

    // The digest is what makes every later scrutiny step text-only. If it stops
    // being captured, the CCR analysis silently degrades to guessing.
    const { data: digests } = await db
      .from('job_documents')
      .select('file_name, classification')
      .eq('job_id', jobA);
    const withSummary = (digests ?? []).filter((d) => {
      const c = (d.classification ?? {}) as Record<string, unknown>;
      return typeof c.summary === 'string' && c.summary.length > 20;
    });
    check(
      'every document carries a digest for later scrutiny',
      withSummary.length === (digests ?? []).length,
      `${withSummary.length}/${(digests ?? []).length}`,
    );

    const { data: jobRow } = await db.from('jobs').select('hs_codes').eq('id', jobA).single();
    console.log(`      hs codes: ${(jobRow?.hs_codes ?? []).join(', ') || 'none found'}`);
    check('HS codes were read off the invoice', (jobRow?.hs_codes ?? []).length > 0);

    const { data: idsA } = await db.from('job_identifiers').select('kind, value_raw').eq('job_id', jobA);
    console.log(`      identifiers: ${(idsA ?? []).map((i) => `${i.kind}=${i.value_raw}`).join(', ') || 'none'}`);
    check('identifiers were extracted', (idsA ?? []).some((i) => i.kind !== 'conversation'));

    // ------------------------------------------- a reply on the thread ----
    console.log('\nA reply carrying the same shipment attaches\n');
    const mail2 = await recordMail(company.id, connection.id, {
      subject: 'RE: Docs for shipment 14075',
      conversationId: `conv-a-${stamp}`,
      providerId: `msg-2-${stamp}`,
    });
    const second = await processMessage(db, {
      ...base,
      mailMessageId: mail2,
      conversationId: `conv-a-${stamp}`,
      subject: 'RE: Docs for shipment 14075',
      fromAddress: 'forwarder@example.test',
      // The same B/L resent on the thread: recognised by its number, not by
      // the thread, and already stored so nothing is added twice.
      attachments: [pdf('ex_job4/14075 BL.pdf')],
    });
    check('attaches to the existing job', second.outcome === 'attached', second.outcome);
    check('attaches to the same job', second.jobId === jobA);
    check('the duplicate document is not stored again', second.documentsDuplicate === 1);

    const { count: jobCount } = await db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id);
    check('no second job was created', jobCount === 1, `${jobCount} jobs`);

    // ------------------------- a different shipment on the same thread ----
    console.log('\nA different shipment on the same thread opens its own job\n');
    const mail2b = await recordMail(company.id, connection.id, {
      subject: 'RE: Docs for shipment 14075 (and 13592)',
      conversationId: `conv-a-${stamp}`,
      providerId: `msg-2b-${stamp}`,
    });
    const drifted = await processMessage(db, {
      ...base,
      mailMessageId: mail2b,
      conversationId: `conv-a-${stamp}`,
      subject: 'RE: Docs for shipment 14075 (and 13592)',
      fromAddress: 'forwarder@example.test',
      // Another shipment's packing list, forwarded on the same thread. The
      // identifiers must win over the thread, or two shipments get merged.
      attachments: [pdf('ex_job3/13592 PL.pdf')],
    });
    check(
      'the thread does not drag an unrelated shipment into the job',
      drifted.jobId !== jobA,
      drifted.outcome,
    );

    // ------------------------------------------------ an unrelated one ----
    console.log('\nAn unrelated shipment opens its own job\n');
    const mail3 = await recordMail(company.id, connection.id, {
      subject: 'Air shipment 30239',
      conversationId: `conv-b-${stamp}`,
      providerId: `msg-3-${stamp}`,
    });
    const third = await processMessage(db, {
      ...base,
      mailMessageId: mail3,
      conversationId: `conv-b-${stamp}`,
      subject: 'Air shipment 30239',
      fromAddress: 'airline@example.test',
      attachments: [pdf('ex_job5/30239 AWB.pdf'), pdf('ex_job5/30239 INVOICE AND PACKING LIST.pdf')],
    });
    check('a separate job is created', third.outcome === 'created_job', third.outcome);
    check('it is a different job', third.jobId !== jobA);

    // -------------------------------------------------------- replays ----
    console.log('\nReplaying the first email changes nothing\n');
    const replay = await processMessage(db, {
      ...base,
      mailMessageId: mail1,
      conversationId: `conv-a-${stamp}`,
      subject: 'Docs for shipment 14075',
      fromAddress: 'forwarder@example.test',
      attachments: [pdf('ex_job4/14075 BL.pdf'), pdf('ex_job4/14075 INV AND PACK.pdf')],
    });
    check('recognised as the same job', replay.jobId === jobA, replay.outcome);
    check('no documents are added again', replay.documentsAdded === 0);
    check('both are reported as duplicates', replay.documentsDuplicate === 2);

    // ------------------------------------------------------- skipping ----
    console.log('\nAn email with nothing useful is skipped\n');
    const mail4 = await recordMail(company.id, connection.id, {
      subject: 'Lunch?',
      conversationId: `conv-c-${stamp}`,
      providerId: `msg-4-${stamp}`,
    });
    const skipped = await processMessage(db, {
      ...base,
      mailMessageId: mail4,
      conversationId: `conv-c-${stamp}`,
      subject: 'Lunch?',
      fromAddress: 'colleague@example.test',
      attachments: [],
    });
    check('no job is created', skipped.outcome === 'skipped', skipped.outcome);
    check('the reason is recorded', skipped.skipReason === 'no_attachments', skipped.skipReason);

    const { count: finalJobs } = await db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id);
    check('exactly three jobs exist in total', finalJobs === 3, `${finalJobs} jobs`);

    // ---------------------------------------------------- audit trail ----
    const { data: events } = await db
      .from('job_events')
      .select('type')
      .eq('company_id', company.id);
    check('every decision is on the timeline', (events ?? []).length >= 3,
      `${(events ?? []).length} events`);

    console.log('');
    if (failures) {
      console.error(`${failures} check(s) failed.\n`);
      process.exitCode = 1;
    } else {
      console.log('Ingest pipeline behaves correctly.\n');
    }
  } finally {
    const { data: docs } = await db
      .from('job_documents')
      .select('storage_bucket, storage_path')
      .eq('company_id', company.id);
    for (const d of docs ?? []) {
      await db.storage.from(d.storage_bucket).remove([d.storage_path]).catch(() => undefined);
    }
    await db.auth.admin.deleteUser(userId).catch(() => undefined);
    await db.from('companies').delete().eq('id', company.id);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
