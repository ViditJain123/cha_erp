/**
 * Proves the custom access token hook is running.
 *
 * Signs in as a real user with the anon key and prints the claims on the issued
 * JWT. If `company_id` is missing here, every RLS policy in the app will match
 * nothing — check that the hook is enabled in supabase/config.toml and that
 * supabase_auth_admin can read public.profiles.
 *
 *   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm --filter @checklist/db check:claims
 */
import '@checklist/config/load-env';
import { createClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@checklist/config/env';
import type { Database } from '../src/types.js';

const email = process.env.CHECK_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test';
const password = process.env.CHECK_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

async function main() {
  if (!password) throw new Error('Set CHECK_PASSWORD (or SEED_ADMIN_PASSWORD).');
  const env = supabaseEnv();

  const anon = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );

  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);

  const payload = JSON.parse(
    Buffer.from(data.session.access_token.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  const custom = [
    'company_id',
    'user_role',
    'user_team',
    'is_platform_admin',
    'must_change_password',
    'user_status',
  ];

  console.log(`\nSigned in as ${email}\n`);
  let missing = 0;
  for (const key of custom) {
    const present = key in payload;
    if (!present) missing++;
    console.log(`  ${present ? '✓' : '✗'} ${key.padEnd(22)} ${JSON.stringify(payload[key])}`);
  }
  console.log('');

  if (missing > 0) {
    console.error(`${missing} claim(s) missing — the access token hook is not running.`);
    process.exit(1);
  }
  console.log('Access token hook is working.\n');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
