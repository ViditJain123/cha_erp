/**
 * Creates (or repairs) the platform administrator — the account that can create
 * company accounts. Run with `pnpm db:seed:admin`.
 *
 * Deliberately a script rather than `seed.sql`: hand-inserting into auth.users
 * produces rows that exist but cannot sign in, because GoTrue's internal
 * columns change between versions. The admin API is the only supported path.
 */
import '@checklist/config/load-env';
import { serviceClient } from '../src/service.js';
import { generateTempPassword } from '../src/temp-password.js';

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test';
const password = process.env.SEED_ADMIN_PASSWORD ?? generateTempPassword();

async function main() {
  const db = serviceClient();

  // The admin API has no get-by-email, so page through until we find them.
  let userId: string | undefined;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    if (data.users.length === 0) break;
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  }

  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(`updateUserById failed: ${error.message}`);
    console.log(`Reset password for existing user ${email}`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Platform Admin' },
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    userId = data.user.id;
    console.log(`Created auth user ${email}`);
  }

  const { error: profileError } = await db.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: 'Platform Admin',
      role: 'platform_admin',
      company_id: null,
      team: null,
      is_platform_admin: true,
      // The seeded admin is not forced through the change-password screen —
      // whoever runs this script chose the password.
      must_change_password: false,
      status: 'active',
    },
    { onConflict: 'id' },
  );
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`);

  console.log('');
  console.log('  Platform admin ready');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log('');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
