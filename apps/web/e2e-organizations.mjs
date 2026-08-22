/**
 * End-to-end walkthrough of the organization repository.
 *
 *   set -a && . .env.local && set +a
 *   node apps/web/e2e-organizations.mjs
 *
 * Starts nothing: point it at a running dev server (`pnpm dev:web`) on 3040.
 *
 * Creates its own throwaway company and owner, drives the real UI to upload
 * the Logi-Sys export the customer gave us, and checks the counts, the
 * snapshot semantics of a second upload, the search, and the resolver that
 * binds a job's parties. Deletes the company on the way out — every row it
 * wrote hangs off `companies` by `on delete cascade`.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3040';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_FILE = path.join(ROOT, 'OrganizationRepository_78_20260811_194754.xlsx');

// apps/web has no direct supabase-js dependency — it reaches the client through
// @checklist/db, which is TypeScript and so not loadable from a plain .mjs.
const { createClient } = createRequire(import.meta.url)(
  createRequire(import.meta.url).resolve('@supabase/supabase-js', {
    paths: [path.join(ROOT, 'packages', 'db')],
  }),
);

const PASSWORD = 'OrgRepoE2E!2026';
const stamp = Date.now();
const SLUG = `orgrepo-e2e-${stamp}`;
const EMAIL = `orgrepo-e2e-${stamp}@example.test`;

let failures = 0;
const step = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function seed() {
  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name: `Org Repo E2E ${stamp}`, slug: SLUG })
    .select('id')
    .single();
  if (companyError) throw new Error(`company: ${companyError.message}`);

  const { data: auth, error: authError } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (authError) throw new Error(`auth user: ${authError.message}`);

  const { error: profileError } = await db.from('profiles').insert({
    id: auth.user.id,
    company_id: company.id,
    email: EMAIL,
    full_name: 'Org Repo E2E',
    role: 'company_owner',
    status: 'active',
    must_change_password: false,
  });
  if (profileError) throw new Error(`profile: ${profileError.message}`);

  return { companyId: company.id, userId: auth.user.id };
}

async function teardown({ companyId, userId }) {
  // profiles.id references auth.users on delete cascade, and every table this
  // touched references companies the same way, so two deletes clear it all.
  await db.from('companies').delete().eq('id', companyId);
  await db.auth.admin.deleteUser(userId);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('button[type=submit]')]);
}

/** The result banner the upload form renders, once it has one. */
async function upload(page) {
  await page.setInputFiles('input[type=file]', REPO_FILE);
  await page.click('button:has-text("Upload")');
  const banner = page.locator('.bg-emerald-50, .bg-red-50').first();
  await banner.waitFor({ timeout: 180_000 });
  return (await banner.innerText()).replace(/\s+/g, ' ').trim();
}

function counts(text) {
  const read = /Read ([\d,]+) organizations/.exec(text);
  const rest = /([\d,]+) added, ([\d,]+) updated, ([\d,]+) retired/.exec(text);
  const n = (s) => Number((s ?? '0').replace(/,/g, ''));
  return {
    read: n(read?.[1]),
    added: n(rest?.[1]),
    updated: n(rest?.[2]),
    retired: n(rest?.[3]),
  };
}

const seeded = await seed();
const browser = await chromium.launch();
const page = await browser.newPage();

try {
  console.log(`\nOrganization repository — ${SLUG}`);

  await login(page);
  await page.goto(`${BASE}/settings/organizations`, { waitUntil: 'networkidle' });
  step('the page is reachable', page.url().endsWith('/settings/organizations'), page.url());
  step(
    'it says the repository is empty',
    (await page.content()).includes('No organizations yet'),
  );

  console.log('\n  first upload');
  const first = counts(await upload(page));
  step('reads every row of the export', first.read === 5091, `read ${first.read}`);
  step('adds them all', first.added === 5091, `added ${first.added}`);
  step('retires nothing', first.retired === 0, `retired ${first.retired}`);

  console.log('\n  snapshot semantics');
  // A party deleted in Logi-Sys is not in the next export. It has to be
  // deactivated rather than deleted: a job filed against it last month still
  // has to resolve.
  const { data: ghost } = await db
    .from('organizations')
    .insert({
      company_id: seeded.companyId,
      name: 'GONE FROM LOGISYS PVT LTD',
      name_key: 'GONE FROM LOGISYS',
      branch_name: 'MAIN',
      branch_sr_no: '',
      is_consignee: true,
    })
    .select('id')
    .single();

  await page.reload({ waitUntil: 'networkidle' });
  const second = counts(await upload(page));
  step('adds nothing on a re-upload of the same file', second.added === 0, `added ${second.added}`);
  step('updates every row', second.updated === 5091, `updated ${second.updated}`);
  step('retires the row the file no longer has', second.retired === 1, `retired ${second.retired}`);

  const { data: after } = await db
    .from('organizations')
    .select('is_active')
    .eq('id', ghost.id)
    .single();
  step('and deactivates it rather than deleting it', after?.is_active === false);

  console.log('\n  search');
  await page.goto(`${BASE}/settings/organizations?q=SIEMENS`, { waitUntil: 'networkidle' });
  const siemens = await page.content();
  step('finds the party', siemens.includes('SIEMENS LIMITED'));
  step('shows its branches apart', siemens.includes('Bangalore 2'));

  await page.goto(`${BASE}/settings/organizations?q=ELITE`, { waitUntil: 'networkidle' });
  const elite = await page.content();
  step('finds ELITE POLYPLUS', elite.includes('ELITE POLYPLUS'));
  step('with the AD code from the repository', elite.includes('0410002'));

  console.log('\n  resolving a party by the name a document would print');
  const { data: byKey } = await db.rpc('search_organizations', {
    p_company: seeded.companyId,
    p_query: 'M/S. ELITE POLYPLUS',
    p_role: 'consignee',
    p_limit: 5,
  });
  step(
    'the trigram search reaches ELITE POLYPLUS from "M/S. ELITE POLYPLUS"',
    (byKey ?? []).some((r) => r.name === 'ELITE POLYPLUS'),
    (byKey ?? [])
      .slice(0, 3)
      .map((r) => r.name)
      .join(' | '),
  );

  const { data: exactKey } = await db
    .from('organizations')
    .select('name, ad_code, gstin')
    .eq('company_id', seeded.companyId)
    .eq('name_key', 'ELITE POLYPLUS')
    .eq('is_consignee', true)
    .eq('is_active', true);
  step('and the normalised key finds exactly one row', exactKey?.length === 1, JSON.stringify(exactKey));

  const { data: shigen } = await db.rpc('search_organizations', {
    p_company: seeded.companyId,
    p_query: 'ASIA SHIGEN INTERNATIONAL',
    p_role: 'shipper',
    p_limit: 5,
  });
  step(
    'the supplier the invoice abbreviates is found in full',
    (shigen ?? [])[0]?.name === 'ASIA SHIGEN INTERNATIONAL CO., LTD',
    (shigen ?? [])[0]?.name,
  );
} finally {
  await browser.close();
  await teardown(seeded);
  console.log(`\n  cleaned up ${SLUG}`);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
