/**
 * Verifies the mailbox claim lock, which is what makes two workers safe to run
 * at once. Needs the local Supabase stack.
 *
 *   pnpm --filter @checklist/worker test:claim
 */
import '@checklist/config/load-env';
import { serviceClient } from '@checklist/db';

const db = serviceClient();

let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function claim(worker: string, staleAfter = '10 minutes') {
  const { data, error } = await db.rpc('claim_mail_connection', {
    p_worker: worker,
    p_stale_after: staleAfter,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; locked_by: string | null }[];
}

async function main() {
  const stamp = Date.now().toString().slice(-6);

  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name: `Claim Test ${stamp}`, slug: `claim-test-${stamp}` })
    .select('id')
    .single();
  if (companyError || !company) throw new Error(companyError?.message ?? 'no company');

  const { data: user } = await db.auth.admin.createUser({
    email: `claim-${stamp}@example.test`,
    password: 'ClaimTest2026x',
    email_confirm: true,
  });
  const userId = user!.user!.id;
  await db.from('profiles').insert({
    id: userId,
    email: `claim-${stamp}@example.test`,
    company_id: company.id,
    role: 'member',
    team: 'scrutiny',
    must_change_password: false,
    status: 'active',
  });

  const { data: conn, error: connError } = await db
    .from('mail_connections')
    .insert({
      company_id: company.id,
      profile_id: userId,
      provider: 'microsoft',
      provider_account_id: `probe-${stamp}`,
      email_address: `claim-${stamp}@example.test`,
      status: 'active',
      next_poll_at: new Date(Date.now() - 1000).toISOString(),
    })
    .select('id')
    .single();
  if (connError || !conn) throw new Error(connError?.message ?? 'no connection');

  try {
    console.log('\nClaim lock\n');

    const first = await claim('worker-a');
    check('a due mailbox is claimed', first.length === 1 && first[0]?.id === conn.id);
    check('the claim records which worker holds it', first[0]?.locked_by === 'worker-a');

    const second = await claim('worker-b');
    check(
      'a second worker does not get the same mailbox',
      second.every((c) => c.id !== conn.id),
      second.some((c) => c.id === conn.id) ? 'both workers claimed it' : undefined,
    );

    // A worker killed mid-poll leaves the lock behind; it must be reclaimable.
    await db
      .from('mail_connections')
      .update({ locked_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
      .eq('id', conn.id);
    const reclaimed = await claim('worker-b');
    check('a stale lock is reclaimed', reclaimed.some((c) => c.id === conn.id));

    // Released and not yet due again.
    await db
      .from('mail_connections')
      .update({
        locked_at: null,
        locked_by: null,
        next_poll_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      .eq('id', conn.id);
    const notDue = await claim('worker-a');
    check('a mailbox that is not due yet is skipped', notDue.every((c) => c.id !== conn.id));

    // Disabled mailboxes are never polled.
    await db
      .from('mail_connections')
      .update({ status: 'disabled', next_poll_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', conn.id);
    const disabled = await claim('worker-a');
    check('a disabled mailbox is never claimed', disabled.every((c) => c.id !== conn.id));

    console.log('');
    if (failures) {
      console.error(`${failures} check(s) failed.\n`);
      process.exitCode = 1;
    } else {
      console.log('Claim lock behaves correctly.\n');
    }
  } finally {
    await db.auth.admin.deleteUser(userId).catch(() => undefined);
    await db.from('companies').delete().eq('id', company.id);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
