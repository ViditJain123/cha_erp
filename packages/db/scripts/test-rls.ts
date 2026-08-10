/**
 * Cross-tenant isolation test.
 *
 * Builds two throwaway companies with one user each, signs both in with the
 * *anon* key (so RLS is in force), and asserts that neither can see or touch
 * the other's data. Run against a local stack:
 *
 *   pnpm db:test:rls
 *
 * This is the regression net for every future migration — a policy that forgets
 * `with check`, or a table that ships without RLS enabled, fails here.
 */
import '@checklist/config/load-env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@checklist/config/env';
import { serviceClient } from '../src/service.js';
import { generateTempPassword } from '../src/temp-password.js';
import type { Database } from '../src/types.js';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail?: string) {
  checks++;
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Tenant {
  companyId: string;
  companyName: string;
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient<Database>;
}

const db = serviceClient();

async function makeTenant(label: string): Promise<Tenant> {
  const stamp = Math.abs(Number(process.hrtime.bigint() % 100000n));
  const slug = `rls-${label}-${stamp}`;
  const email = `${slug}@example.test`;
  const password = generateTempPassword();

  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name: `RLS ${label} ${stamp}`, slug })
    .select('id, name')
    .single();
  if (companyError || !company) throw new Error(`company insert: ${companyError?.message}`);

  const { data: created, error: userError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !created.user) throw new Error(`createUser: ${userError?.message}`);

  const { error: profileError } = await db.from('profiles').insert({
    id: created.user.id,
    email,
    company_id: company.id,
    role: 'company_owner',
    team: 'scrutiny',
    is_platform_admin: false,
    must_change_password: false,
    status: 'active',
  });
  if (profileError) throw new Error(`profile insert: ${profileError.message}`);

  const env = supabaseEnv();
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in: ${signInError.message}`);

  return {
    companyId: company.id,
    companyName: company.name,
    userId: created.user.id,
    email,
    password,
    client,
  };
}

async function cleanup(tenants: Tenant[]) {
  for (const t of tenants) {
    await db.auth.admin.deleteUser(t.userId).catch(() => undefined);
    await db.from('companies').delete().eq('id', t.companyId);
  }
}

async function main() {
  const a = await makeTenant('a');
  const b = await makeTenant('b');

  try {
    console.log('\nTenant isolation\n');

    // A must see its own company and only its own.
    const ownCompanies = await a.client.from('companies').select('id, name');
    check(
      'company list is scoped to the caller',
      ownCompanies.data?.length === 1 && ownCompanies.data[0]?.id === a.companyId,
      `saw ${ownCompanies.data?.length ?? 0} companies`,
    );

    // Fetching B's company by id returns zero rows — RLS filters, it does not
    // raise. Asserting on an error here is the test everyone writes wrong.
    const crossCompany = await a.client.from('companies').select('id').eq('id', b.companyId);
    check(
      "reading another tenant's company returns no rows",
      crossCompany.error === null && (crossCompany.data?.length ?? 0) === 0,
      crossCompany.error ? `errored: ${crossCompany.error.message}` : undefined,
    );

    const crossProfile = await a.client.from('profiles').select('id').eq('id', b.userId);
    check(
      "reading another tenant's user returns no rows",
      crossProfile.error === null && (crossProfile.data?.length ?? 0) === 0,
    );

    const ownProfiles = await a.client.from('profiles').select('id, email');
    check(
      'profile list shows only colleagues',
      ownProfiles.data?.length === 1 && ownProfiles.data[0]?.id === a.userId,
      `saw ${ownProfiles.data?.length ?? 0} profiles`,
    );

    console.log('\nWrite protection\n');

    // The `with check` clause on companies_update. Without it this succeeds and
    // a member can rename another tenant's company.
    const crossUpdate = await a.client
      .from('companies')
      .update({ name: 'pwned' })
      .eq('id', b.companyId)
      .select('id');
    check(
      "cannot rename another tenant's company",
      (crossUpdate.data?.length ?? 0) === 0,
      crossUpdate.data?.length ? 'the update went through' : undefined,
    );
    const bStillNamed = await db
      .from('companies')
      .select('name')
      .eq('id', b.companyId)
      .single();
    check("other tenant's company name is unchanged", bStillNamed.data?.name === b.companyName);

    // Column grants, not RLS, are what stop this one.
    const escalate = await a.client
      .from('profiles')
      .update({ is_platform_admin: true })
      .eq('id', a.userId)
      .select('id');
    check(
      'cannot promote self to platform admin',
      escalate.error !== null || (escalate.data?.length ?? 0) === 0,
      escalate.error ? undefined : 'the update went through',
    );
    const stillNotAdmin = await db
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', a.userId)
      .single();
    check('platform admin flag is still false', stillNotAdmin.data?.is_platform_admin === false);

    // Re-parenting a row into another tenant.
    const reparent = await a.client
      .from('profiles')
      .update({ company_id: b.companyId })
      .eq('id', a.userId)
      .select('id');
    const reparented = await db
      .from('profiles')
      .select('company_id')
      .eq('id', a.userId)
      .single();
    check(
      'cannot move own profile into another company',
      reparented.data?.company_id === a.companyId,
      reparent.error ? undefined : 'company_id changed',
    );

    // Creating companies is service-role only.
    const insertCompany = await a.client
      .from('companies')
      .insert({ name: 'rogue', slug: `rogue-${Date.now()}` })
      .select('id');
    check(
      'cannot create a company as an ordinary user',
      insertCompany.error !== null,
      insertCompany.error ? undefined : 'the insert went through',
    );

    console.log('\nJob data\n');

    // Seed a job in B and confirm A cannot see or touch it.
    const { data: bJob } = await db
      .from('jobs')
      .insert({ company_id: b.companyId, title: 'B private shipment', stage: 'documents_received' })
      .select('id')
      .single();

    const crossJob = await a.client.from('jobs').select('id').eq('id', bJob!.id);
    check(
      "another tenant's job is invisible",
      crossJob.error === null && (crossJob.data?.length ?? 0) === 0,
    );

    const crossJobUpdate = await a.client
      .from('jobs')
      .update({ title: 'pwned' })
      .eq('id', bJob!.id)
      .select('id');
    const bJobAfter = await db.from('jobs').select('title').eq('id', bJob!.id).single();
    check(
      "cannot rename another tenant's job",
      bJobAfter.data?.title === 'B private shipment',
      crossJobUpdate.data?.length ? 'the update went through' : undefined,
    );

    // The `with check` clause on jobs_update: without it a member could move a
    // job into another tenant.
    const { data: aJob } = await db
      .from('jobs')
      .insert({ company_id: a.companyId, title: 'A shipment' })
      .select('id')
      .single();
    await a.client.from('jobs').update({ company_id: b.companyId }).eq('id', aJob!.id);
    const aJobAfter = await db.from('jobs').select('company_id').eq('id', aJob!.id).single();
    check('cannot move a job into another company', aJobAfter.data?.company_id === a.companyId);

    // Mailbox rows carry OAuth tokens; they must never cross a tenant boundary.
    const crossConnections = await a.client.from('mail_connections').select('id');
    check('sees no mailbox connections from other tenants', (crossConnections.data?.length ?? 0) === 0);

    // oauth_states has no authenticated policy at all.
    const states = await a.client.from('oauth_states').select('state');
    check(
      'OAuth PKCE state is unreadable by any signed-in user',
      states.error !== null || (states.data?.length ?? 0) === 0,
    );

    console.log('\nMasters\n');

    const { data: bBranch } = await db
      .from('branches')
      .insert({ company_id: b.companyId, name: 'B private branch' })
      .select('id')
      .single();

    const ownBranches = await a.client.from('branches').select('id');
    check("another tenant's branches are invisible", (ownBranches.data?.length ?? 0) === 0);

    const crossBranch = await a.client.from('branches').select('id').eq('id', bBranch!.id);
    check('a branch cannot be fetched by id across tenants', (crossBranch.data?.length ?? 0) === 0);

    // Masters are service-role writes only; the UI goes through server actions.
    const insertBranch = await a.client
      .from('branches')
      .insert({ company_id: a.companyId, name: 'rogue' })
      .select('id');
    check(
      'an ordinary user cannot write the branch master directly',
      insertBranch.error !== null,
      insertBranch.error ? undefined : 'the insert went through',
    );

    // A curated compliance master is competitive information, not just data.
    await db.from('ccr_master').insert({
      company_id: b.companyId,
      hs_code: '3304',
      code: 'B-SECRET',
      title: "B's requirement",
      requirement_text: 'Private to B.',
    });
    const crossCcr = await a.client.from('ccr_master').select('id, code');
    check(
      "another tenant's compliance master is invisible",
      (crossCcr.data?.length ?? 0) === 0,
      crossCcr.data?.length ? 'leaked' : undefined,
    );

    const insertCcr = await a.client
      .from('ccr_master')
      .insert({
        company_id: a.companyId,
        hs_code: '3304',
        code: 'ROGUE',
        title: 'x',
        requirement_text: 'x',
      })
      .select('id');
    check('an ordinary user cannot write the compliance master directly', insertCcr.error !== null);

    // Document requests carry what a shipment is missing — commercially sensitive.
    const { data: bJob2 } = await db
      .from('jobs')
      .insert({ company_id: b.companyId, title: 'B second job' })
      .select('id')
      .single();
    await db.from('job_document_requests').insert({
      company_id: b.companyId,
      job_id: bJob2!.id,
      name: "B's missing licence",
    });
    const crossRequests = await a.client.from('job_document_requests').select('id');
    check("another tenant's document requests are invisible", (crossRequests.data?.length ?? 0) === 0);

    // Shipper addresses are a customer list.
    await db.from('shippers').insert({
      company_id: b.companyId,
      name: "B's shipper",
      email: 'b-shipper@example.test',
    });
    const crossShippers = await a.client.from('shippers').select('id, email');
    check("another tenant's shipper list is invisible", (crossShippers.data?.length ?? 0) === 0);

    const insertShipper = await a.client
      .from('shippers')
      .insert({ company_id: a.companyId, name: 'rogue', email: 'r@example.test' })
      .select('id');
    check('an ordinary user cannot write the shipper master directly', insertShipper.error !== null);

    // A checklist draft is the whole Bill of Entry: values, supplier, tariff
    // codes, origin. It is the most commercially sensitive row we hold.
    await db.from('job_drafts').insert({
      company_id: b.companyId,
      job_id: bJob2!.id,
      draft: { supplier: { name: "B's supplier" }, invoice: { invoiceValue: 999999 } } as never,
    });
    const crossDrafts = await a.client.from('job_drafts').select('id, draft');
    check("another tenant's checklist drafts are invisible", (crossDrafts.data?.length ?? 0) === 0);

    const insertDraft = await a.client
      .from('job_drafts')
      .insert({ company_id: a.companyId, job_id: bJob2!.id, draft: {} as never })
      .select('id');
    check('an ordinary user cannot write a checklist draft directly', insertDraft.error !== null);

    const crossJobCcrs = await a.client.from('job_ccrs').select('id');
    check("another tenant's applied requirements are invisible", (crossJobCcrs.data?.length ?? 0) === 0);

    console.log('\nAnonymous access\n');

    const env = supabaseEnv();
    const anon = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false } },
    );
    const anonCompanies = await anon.from('companies').select('id');
    check(
      'signed-out callers see no companies',
      anonCompanies.error !== null || (anonCompanies.data?.length ?? 0) === 0,
    );
    const anonProfiles = await anon.from('profiles').select('id');
    check(
      'signed-out callers see no profiles',
      anonProfiles.error !== null || (anonProfiles.data?.length ?? 0) === 0,
    );

    console.log('');
    if (failures > 0) {
      console.error(`${failures} of ${checks} checks failed.\n`);
      process.exitCode = 1;
    } else {
      console.log(`All ${checks} checks passed.\n`);
    }
  } finally {
    await cleanup([a, b]);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
