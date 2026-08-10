/**
 * Phase A end-to-end walkthrough against a running dev server.
 *
 *   pnpm db:start && pnpm db:seed:admin && pnpm dev     # in another shell
 *   SEED_ADMIN_PASSWORD=... node apps/web/e2e-phase-a.mjs
 *
 * Drives the real UI: platform admin creates a company, the owner signs in with
 * the emailed temporary password, is forced to choose a new one, invites a
 * scrutiny team member, and neither can reach the platform console or the
 * legacy tools.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3040';
const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'LocalAdmin2026',
};

let failures = 0;
const step = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Polls until the pathname settles on `expected`. Returns the final pathname. */
async function waitForPath(page, expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let seen = new URL(page.url()).pathname;
  while (Date.now() < deadline) {
    seen = new URL(page.url()).pathname;
    if (seen === expected) return seen;
    await page.waitForTimeout(150);
  }
  return seen;
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.locator('form:has(#password) button[type=submit]').click();
}

async function body(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  return page.locator('body').innerText();
}

/** Polls the rendered text until `needle` appears. Server-action round trips
 *  update state asynchronously, so a single read races the response. */
async function waitForText(page, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.locator('body').innerText()).includes(needle)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

const browser = await chromium.launch();
const stamp = Date.now().toString().slice(-6);
const company = `Kuberr Test ${stamp}`;
const ownerEmail = `owner-${stamp}@example.test`;
const memberEmail = `scrutiny-${stamp}@example.test`;
const OWNER_PASSWORD = 'OwnerChosen2026x';
const MEMBER_PASSWORD = 'MemberChosen2026x';

try {
  // ---------------------------------------------------------------- admin --
  console.log('\nPlatform admin\n');
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();

  await login(admin, ADMIN.email, ADMIN.password);
  step('platform admin lands on /admin', (await waitForPath(admin, '/admin')) === '/admin', admin.url());

  // Scope to the create form: the layout header also has a submit button
  // (sign out), and a bare button[type=submit] would match that one first.
  await admin.fill('#name', company);
  await admin.fill('#ownerEmail', ownerEmail);
  await admin.fill('#ownerName', 'Test Owner');
  await admin.locator('form:has(#ownerEmail) button[type=submit]').click();
  await admin.waitForSelector('.font-mono', { timeout: 30000 });

  const tempPassword = (await admin.locator('.font-mono').first().innerText()).trim();
  step('company created with a 16-character temp password', /^[A-Za-z0-9]{16}$/.test(tempPassword));
  step('company appears in the list', (await body(admin)).includes(company));

  await admin.goto(`${BASE}/legacy`, { waitUntil: 'networkidle' });
  step('platform admin can open /legacy', (await waitForPath(admin, '/legacy')) === '/legacy');
  const legacyBody = await body(admin);
  step('legacy banner is shown', legacyBody.includes('LEGACY') || legacyBody.includes('Legacy'));
  step('legacy checklist UI still renders', legacyBody.includes('Import Jobs'));

  await adminCtx.close();

  // ---------------------------------------------------------------- owner --
  console.log('\nCompany owner first sign-in\n');
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();

  await login(owner, ownerEmail, tempPassword);
  step('temporary password forces /set-password',
    (await waitForPath(owner, '/set-password')) === '/set-password', owner.url());

  await owner.fill('#password', 'short1A');
  await owner.fill('#confirm', 'short1A');
  await owner.locator('form:has(#confirm) button[type=submit]').click();
  step('weak password rejected', await waitForText(owner, 'at least 10 characters'));

  await owner.fill('#password', OWNER_PASSWORD);
  await owner.fill('#confirm', 'Mismatched2026x');
  await owner.locator('form:has(#confirm) button[type=submit]').click();
  step('mismatched confirmation rejected', await waitForText(owner, 'do not match'));

  await owner.fill('#password', OWNER_PASSWORD);
  await owner.fill('#confirm', OWNER_PASSWORD);
  await owner.locator('form:has(#confirm) button[type=submit]').click();
  step('password change lands on the dashboard', (await waitForPath(owner, '/')) === '/', owner.url());
  step('dashboard shows the company name', (await body(owner)).includes(company));

  await owner.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  step('owner is bounced from /admin', (await waitForPath(owner, '/')) === '/', owner.url());
  await owner.goto(`${BASE}/legacy`, { waitUntil: 'networkidle' });
  step('owner is bounced from /legacy', (await waitForPath(owner, '/')) === '/', owner.url());

  const apiStatus = await owner.evaluate(async (base) => {
    const r = await fetch(`${base}/api/legacy/masters`, { redirect: 'manual' });
    return r.status;
  }, BASE);
  step('owner cannot call the legacy API', apiStatus !== 200, `status ${apiStatus}`);

  // ------------------------------------------------------------- invites --
  console.log('\nTeam invitation\n');
  await owner.goto(`${BASE}/settings/team`, { waitUntil: 'networkidle' });
  await owner.fill('#email', memberEmail);
  await owner.fill('#fullName', 'Scrutiny Person');
  await owner.selectOption('#team', 'scrutiny');
  await owner.locator('form:has(#fullName) button[type=submit]').click();
  await owner.waitForSelector('.font-mono', { timeout: 30000 });

  const memberPassword = (await owner.locator('.font-mono').first().innerText()).trim();
  step('team member invited with a temp password', /^[A-Za-z0-9]{16}$/.test(memberPassword));
  const teamBody = await body(owner);
  step('member listed on the team page', teamBody.includes(memberEmail));
  step('member is on the Scrutiny team', teamBody.includes('Scrutiny'));

  // Re-inviting the same address must be refused, not silently duplicated.
  await owner.fill('#email', memberEmail);
  await owner.locator('form:has(#fullName) button[type=submit]').click();
  step('duplicate invite refused', await waitForText(owner, 'already has an account'));

  // ------------------------------------------------------------- member --
  console.log('\nTeam member\n');
  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();

  await login(member, memberEmail, memberPassword);
  step('member also forced to /set-password',
    (await waitForPath(member, '/set-password')) === '/set-password', member.url());

  await member.fill('#password', MEMBER_PASSWORD);
  await member.fill('#confirm', MEMBER_PASSWORD);
  await member.locator('form:has(#confirm) button[type=submit]').click();
  step('member reaches the dashboard', (await waitForPath(member, '/')) === '/', member.url());
  step('member sees the same company', (await body(member)).includes(company));

  await member.goto(`${BASE}/settings/mailbox`, { waitUntil: 'networkidle' });
  const mailboxBody = await body(member);
  step('scrutiny member sees the mailbox page', mailboxBody.includes('Outlook mailbox'));
  // Either state is correct — which one depends on whether the Azure app
  // credentials are present in this environment.
  const configured = mailboxBody.includes('Connect Outlook');
  step(
    'mailbox offers the right next step for this environment',
    configured || mailboxBody.includes('Not configured yet'),
    configured ? 'Graph configured' : 'Graph not configured',
  );

  // A plain member must not be able to invite anyone.
  await member.goto(`${BASE}/settings/team`, { waitUntil: 'networkidle' });
  step('member cannot see the invite form', (await member.locator('#fullName').count()) === 0);

  await memberCtx.close();
  await ownerCtx.close();
} finally {
  await browser.close();
}

console.log('');
if (failures) {
  console.error(`${failures} step(s) failed.\n`);
  process.exit(1);
}
console.log('Phase A walkthrough passed.\n');
