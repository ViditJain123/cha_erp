/**
 * Phase E walkthrough: customs clearance, from noting to delivery.
 *
 *   pnpm db:start && pnpm dev        # in another shell
 *   node apps/web/e2e-phase-e.mjs
 *
 * Unlike the other phases this seeds its own fixture with SQL rather than
 * through ingest, so it makes no OpenAI calls: clearance starts after scrutiny
 * has finished, and nothing here reads a document.
 *
 * Drives the loop that matters — customs assessing a different duty from the
 * checklist, the job going back to scrutiny, and coming forward again — then
 * out of charge and a delivery day the CFS first refuses and then approves.
 */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3040';
const DB = process.env.E2E_DB_CONTAINER ?? 'supabase_db_checklist-app';

let failures = 0;
const step = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Case-insensitive: innerText applies CSS text-transform, so headers shout. */
async function bodyText(page) {
  return (await page.locator('body').innerText()).toLowerCase();
}

async function has(page, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const wanted = needle.toLowerCase();
  while (Date.now() < deadline) {
    if ((await bodyText(page)).includes(wanted)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** `today + n` as yyyy-mm-dd, in the UTC frame the app counts calendar days in. */
function day(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);
}

/**
 * First line only: psql prints the command tag ("INSERT 0 1") after a
 * RETURNING value, which would otherwise be spliced into the next statement.
 */
function sql(statement) {
  const out = execFileSync(
    'docker',
    ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', statement],
    { encoding: 'utf8' },
  );
  return out.trim().split('\n')[0]?.trim() ?? '';
}

const CHECKLIST_DUTY = 452318;
const ASSESSED_DUTY = 460000;

console.log('\nSeeding a job that has finished scrutiny…');
const stamp = Date.now();
const slug = `e2e-clearance-${stamp}`;
const companyId = sql(
  `insert into public.companies (name, slug) values ('E2E Clearance ${stamp}', '${slug}') returning id`,
);
const cfsId = sql(
  `insert into public.cfs_master (company_id, name, code, port) values ('${companyId}', 'E2E CFS', 'INNSA6', 'Nhava Sheva') returning id`,
);
const jobId = sql(
  `insert into public.jobs (company_id, title, importer_name, job_number, stage, checklist_duty, eta)
   values ('${companyId}', 'E2E consignment', 'M/S. Elite Polyplus', 'I-${stamp}', 'noting', ${CHECKLIST_DUTY}, '${day(0)}')
   returning id`,
);

const users = [
  ['customs', 'company_owner', null],
  ['cfs', 'member', cfsId],
  ['customer_support', 'member', null],
];
const passwords = {};
for (const [team, role, station] of users) {
  const email = `${team}-${stamp}@example.test`;
  const password = `E2ePass!${stamp}`;
  passwords[team] = { email, password };
  const userId = execFileSync(
    'curl',
    [
      '-s',
      `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/auth/v1/admin/users`,
      '-H', `apikey: ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      '-H', `Authorization: Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ email, password, email_confirm: true }),
    ],
    { encoding: 'utf8' },
  );
  const id = JSON.parse(userId).id;
  sql(
    `insert into public.profiles (id, company_id, email, full_name, role, team, status, must_change_password, cfs_id)
     values ('${id}', '${companyId}', '${email}', '${team}', '${role}', '${team}', 'active', false, ${station ? `'${station}'` : 'null'})`,
  );
}
console.log(`  company ${companyId}, job ${jobId}\n`);

const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });

  async function signIn(team) {
    // Clear the session first: /login redirects away for an authenticated one.
    await page.context().clearCookies();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', passwords[team].email);
    await page.fill('#password', passwords[team].password);
    await page.locator('form:has(#password) button[type=submit]').click();
    await page.waitForTimeout(2500);
  }

  await signIn('customs');
  step('the customs desk signs in', new URL(page.url()).pathname === '/');

  console.log('\nThe clearance tab\n');
  await page.goto(`${BASE}/jobs/${jobId}`, { waitUntil: 'networkidle' });
  step('the job has a clearance tab', await has(page, 'clearance'));
  step('the stage reads as with clearance', await has(page, 'with clearance'));

  await page.goto(`${BASE}/jobs/${jobId}/clearance`, { waitUntil: 'networkidle' });
  step('clearance opens itself on first visit', await has(page, 'noting'));
  step(
    'the checklist duty is carried through',
    await has(page, CHECKLIST_DUTY.toLocaleString('en-IN')),
  );

  console.log('\nNoting and RMS\n');
  await page.fill('#beNumber', `BE-${stamp}`);
  await page.fill('#beDate', day(0));
  await page.locator('form:has(#beNumber) button[type=submit]').click();
  step('the bill of entry is noted', await has(page, 'noted.'));

  await page.selectOption('#rmsRoute', 'assessment');
  await page.locator('form:has(#rmsRoute) button[type=submit]').click();
  step('the RMS route records', await has(page, 'route recorded'));
  step('it moves to passing', await has(page, 'with the appraiser'));

  console.log('\nThe duty check — the control this exists for\n');
  await page.fill('#entryInwardsDate', day(-1));
  await page.locator('form:has(#entryInwardsDate) button[type=submit]').click();
  step('passing records', await has(page, 'passing saved'));

  await page.fill('#assessedDuty', String(ASSESSED_DUTY));
  await page.locator('form:has(#assessedDuty) button[type=submit]').click();
  step('a mismatch is caught', await has(page, 'back with scrutiny'));
  step(
    'the difference is stated',
    await has(page, (ASSESSED_DUTY - CHECKLIST_DUTY).toLocaleString('en-IN')),
  );
  step('duty payment is refused while it is open', await has(page, 'open duty variance'));

  await page.goto(`${BASE}/jobs/${jobId}`, { waitUntil: 'networkidle' });
  step('the job really went back to scrutiny', await has(page, 'in scrutiny'));

  await page.goto(`${BASE}/jobs/${jobId}/clearance`, { waitUntil: 'networkidle' });
  await page.locator('input[name=varianceNote]').fill('Customs reclassified; checklist revised');
  await page.locator('form:has(input[name=varianceNote]) button[type=submit]').click();
  // Assert on what survives, not the transient message: closing the variance
  // removes the red panel that carried it, and leaves the note on the record.
  step('the variance can be closed', await has(page, 'earlier variance closed'));
  step('the note is kept', await has(page, 'customs reclassified'));
  step('payment is unblocked', !(await bodyText(page)).includes('open duty variance'));

  console.log('\nDuty, the shed, and a blocking NOC\n');
  await page.fill('#dutyPaidOn', day(0));
  await page.fill('#dutyChallanNo', `CH-${stamp}`);
  await page.locator('form:has(#dutyChallanNo) button[type=submit]').click();
  step('the duty payment records', await has(page, 'duty payment recorded'));

  await page.locator('input[name=authority]').last().fill('Pollution Control Board');
  await page.locator('form:has(input[name=authority]) button[type=submit]').last().click();
  step('a pollution board NOC can be raised', await has(page, 'pollution control board'));

  await page.fill('#goodsRegisteredOn', day(0));
  await page.fill('#examinedOn', day(0));
  await page.locator('form:has(#goodsRegisteredOn) button[type=submit]').click();
  step('registration and examination record', await has(page, 'saved.'));

  step('the pending NOC is called out', await has(page, 'still waiting on'));
  step(
    'out of charge is refused while the NOC is pending',
    await page.locator('form:has(#outOfChargeOn) button[type=submit]').isDisabled(),
  );

  await page.goto(`${BASE}/jobs/${jobId}/clearance`, { waitUntil: 'networkidle' });
  const noc = page.locator('li:has(form input[name=authority][type=hidden])').first();
  await noc.locator('select[name=status]').selectOption('received');
  await noc.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1200);

  await page.goto(`${BASE}/jobs/${jobId}/clearance`, { waitUntil: 'networkidle' });
  await page.fill('#outOfChargeOn', day(0));
  await page.locator('form:has(#outOfChargeOn) button[type=submit]').click();
  step('out of charge records once the NOC is in', await has(page, 'out of charge recorded'));

  console.log('\nDelivery planning, refused then agreed\n');
  await page.fill('#plannedFor', day(1));
  await page.locator('form:has(#plannedFor) button[type=submit]').click();
  step('a day is put to the CFS', await has(page, 'put to e2e cfs'));

  await signIn('cfs');
  await page.goto(`${BASE}/delivery-planning`, { waitUntil: 'networkidle' });
  step('the CFS sees the day in their queue', await has(page, 'awaiting an answer'));

  await page.getByRole('button', { name: 'No' }).click();
  await page.locator('input[name=decisionNote]').fill('Labour strike at the station');
  await page.getByRole('button', { name: 'Confirm refusal' }).click();
  step('a refusal is confirmed back', await has(page, 'answered in the last day'));
  step('customer support was reached', !(await bodyText(page)).includes('could not be reached'));

  await signIn('customs');
  await page.goto(`${BASE}/jobs/${jobId}/clearance`, { waitUntil: 'networkidle' });
  step('the refused day stays on the record', await has(page, 'labour strike'));
  await page.fill('#plannedFor', day(3));
  await page.locator('form:has(#plannedFor) button[type=submit]').click();
  step('a second day can be proposed', await has(page, 'put to e2e cfs'));

  await signIn('cfs');
  await page.goto(`${BASE}/delivery-planning`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Yes/ }).click();
  step('approval is confirmed back', await has(page, 'approved'));

  console.log('\nClosing out\n');
  await signIn('customs');
  await page.goto(`${BASE}/jobs/${jobId}/clearance`, { waitUntil: 'networkidle' });
  await page.fill('#deliveredOn', day(3));
  await page.locator('form:has(#deliveredOn) button[type=submit]').click();
  step('delivery closes the job', await has(page, 'the job is closed'));

  await page.goto(`${BASE}/jobs/${jobId}`, { waitUntil: 'networkidle' });
  step('the job stage is closed', await has(page, 'closed'));
  step('the timeline reads in prose', await has(page, 'goods delivered'));
  step('no raw event keys leak', !(await bodyText(page)).includes('clearance.delivered'));

  step('no runtime errors on any page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  // Cascades through clearance, plans, queries and NOCs.
  sql(`delete from public.companies where id = '${companyId}'`);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} check(s) failed.\n`);
  process.exitCode = 1;
} else {
  console.log('Phase E walkthrough passed.\n');
}
