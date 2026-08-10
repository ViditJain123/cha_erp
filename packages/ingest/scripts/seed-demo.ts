/**
 * Seeds a company, a signed-in-able owner, and one job ingested from the real
 * example PDFs — so the UI can be exercised without a live mailbox.
 *
 *   pnpm demo:seed
 *
 * Prints a JSON summary on the final line for scripts to consume.
 */
import '@checklist/config/load-env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serviceClient } from '@checklist/db';
import { processMessage } from '../src/index.js';

// Resolved from this file, not the working directory, so the script runs
// the same however it is invoked.
const EXAMPLES = path.resolve(import.meta.dirname, '../../../..');
const db = serviceClient();

function pdf(relative: string) {
  return {
    fileName: path.basename(relative),
    contentType: 'application/pdf',
    data: readFileSync(path.join(EXAMPLES, relative)),
  };
}

async function main() {
  const stamp = Date.now().toString().slice(-6);
  const email = `demo-owner-${stamp}@example.test`;
  const password = 'DemoOwner2026x';

  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name: `Demo Co ${stamp}`, slug: `demo-co-${stamp}` })
    .select('id, name')
    .single();
  if (companyError || !company) throw new Error(companyError?.message ?? 'no company');

  const { data: user, error: userError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(userError?.message ?? 'no user');

  await db.from('profiles').insert({
    id: user.user.id,
    email,
    full_name: 'Demo Owner',
    company_id: company.id,
    role: 'company_owner',
    team: 'scrutiny',
    // Skip the forced-change screen; this account exists to test other things.
    must_change_password: false,
    status: 'active',
  });

  const { data: connection } = await db
    .from('mail_connections')
    .insert({
      company_id: company.id,
      profile_id: user.user.id,
      provider: 'microsoft',
      provider_account_id: `demo-${stamp}`,
      email_address: email,
      // Active with the full scope set so the shipper-request flow is
      // reachable, but with no tokens and next_poll_at far out so the watcher
      // never actually tries to poll it.
      status: 'active',
      scopes: ['offline_access', 'Mail.Read', 'Mail.Send', 'User.Read'],
      next_poll_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single();

  const { data: mail } = await db
    .from('mail_messages')
    .insert({
      company_id: company.id,
      connection_id: connection!.id,
      provider_message_id: `demo-msg-${stamp}`,
      conversation_id: `demo-conv-${stamp}`,
      subject: 'Documents for shipment 14075',
      from_address: 'forwarder@example.test',
      has_attachments: true,
      received_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const result = await processMessage(db, {
    companyId: company.id,
    connectionId: connection!.id,
    mailMessageId: mail!.id,
    conversationId: `demo-conv-${stamp}`,
    subject: 'Documents for shipment 14075',
    fromAddress: 'forwarder@example.test',
    attachments: [pdf('ex_job4/14075 BL.pdf'), pdf('ex_job4/14075 INV AND PACK.pdf')],
  });

  console.log(
    JSON.stringify({
      companyId: company.id,
      companyName: company.name,
      email,
      password,
      jobId: result.jobId,
      documentsAdded: result.documentsAdded,
      supplierName: (await db.from('jobs').select('supplier_name').eq('id', result.jobId!).single())
        .data?.supplier_name,
    }),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
