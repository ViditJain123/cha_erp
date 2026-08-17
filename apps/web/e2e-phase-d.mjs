/**
 * Phase D walkthrough: the delivery order, which runs beside scrutiny.
 *
 *   pnpm db:start && pnpm dev        # in another shell
 *   node apps/web/e2e-phase-d.mjs
 *
 * Seeds its fixture through the real ingest pipeline, so this makes a few
 * OpenAI calls. Drives one job from an unopened DO through to a closed one:
 * B/L check, free time, delivery mode against a bond, the line's papers, both
 * invoice rounds, the DO itself, delivery, and the deposit back.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3040';
const ROOT = path.resolve(import.meta.dirname, '../..');

let failures = 0;
const step = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function waitForPath(page, expected, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let seen = new URL(page.url()).pathname;
  while (Date.now() < deadline) {
    seen = new URL(page.url()).pathname;
    if (seen === expected) return seen;
    await page.waitForTimeout(150);
  }
  return seen;
}

/**
 * Case-insensitive on purpose: innerText applies CSS text-transform, so table
 * headers and stat labels come back shouting and an exact match on "Delivery
 * order" fails against the "DELIVERY ORDER" the browser reports.
 */
async function waitForText(page, needle, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const wanted = needle.toLowerCase();
  while (Date.now() < deadline) {
    const body = (await page.locator('body').innerText()).toLowerCase();
    if (body.includes(wanted)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function bodyText(page) {
  return (await page.locator('body').innerText()).toLowerCase();
}

/** `today + n` as a yyyy-mm-dd string, in the same UTC frame the app counts in. */
function day(offset) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset),
  )
    .toISOString()
    .slice(0, 10);
}

console.log('\nSeeding a job through the real ingest pipeline…');
const seedOutput = execFileSync(
  'corepack',
  ['pnpm', '--filter', '@checklist/ingest', 'demo:seed'],
  { cwd: ROOT, encoding: 'utf8' },
);
const seed = JSON.parse(seedOutput.trim().split('\n').at(-1));
console.log(`  company ${seed.companyName}, job ${seed.jobId}\n`);

const browser = await chromium.launch();

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', seed.email);
  await page.fill('#password', seed.password);
  await page.locator('form:has(#password) button[type=submit]').click();
  await waitForPath(page, '/');

  console.log('Masters\n');

  await page.goto(`${BASE}/settings/shipping-lines`, { waitUntil: 'networkidle' });
  step('the shipping line master starts empty', await waitForText(page, 'No shipping lines yet'));

  await page.fill('#name', 'Interasia Lines');
  await page.fill('#agentName', 'Interasia Agencies India');
  await page.fill('#doEmail', 'do@interasia.test');
  await page.fill('#defaultFreeDays', '14');
  await page.fill('#aliases', 'INTERASIA LINES, IAL');
  await page.locator('form:has(#aliases) button[type=submit]').click();
  step('a shipping line can be added', await waitForText(page, 'Interasia Lines'));
  step('its default free days are shown', await waitForText(page, '14 d'));

  await page.getByRole('button', { name: /^Deposits/ }).click();
  await page.locator('input[name=containerSize]').fill('40');
  await page.locator('input[name=amount]').fill('30000');
  await page.getByRole('button', { name: 'Set rate' }).click();
  step('a deposit rate can be set', await waitForText(page, 'Loaded 40'));

  console.log('\nThe DO tab opens itself\n');

  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });
  step('the job page has tabs', await waitForText(page, 'Delivery order'));
  step('the scrutiny tab still shows its own content', await waitForText(page, 'Documents'));

  await page.getByRole('link', { name: 'Delivery order' }).click();
  await waitForPath(page, `/jobs/${seed.jobId}/do`);
  step('the DO opens on first visit', await waitForText(page, 'Bill of lading'));
  step('it starts as not started', await waitForText(page, 'Not started'));

  console.log('\nStep 1 — the bill of lading\n');

  await page.getByText('Original in circulation').click();
  await page.locator('form:has([name=blSurrendered]) button[type=submit]').click();
  step('the B/L check saves', await waitForText(page, 'B/L status saved.'));
  step(
    'an uncollected original is called out',
    await waitForText(page, 'The line will not release against a B/L nobody holds'),
  );

  console.log('\nStep 2 — detention free time\n');

  await page.fill('#freeDays', '7');
  await page.fill('#freeTimeFrom', day(-5));
  await page.locator('form:has(#freeDays) button[type=submit]').click();
  step('the free period saves', await waitForText(page, 'Free period saved.'));
  step('the last free day is derived', await waitForText(page, 'Last free day'));
  step(
    'a container about to run into detention is flagged',
    await waitForText(page, 'free time ends'),
  );

  console.log('\nStep 3 — delivery mode and security\n');

  await page.selectOption('#deliveryMode', 'loaded');
  await page.selectOption('#shippingLineId', { label: 'Interasia Lines' });
  await page.locator('form:has(#deliveryMode) button[type=submit]').click();
  step('the mode saves and prices the deposit', await waitForText(page, 'Deposit expected'));
  step(
    'no-bond-found is distinguishable from no-bond-exists',
    await waitForText(page, 'Check the importer name matches the master'),
  );

  console.log('\nStep 4 — the papers the line wants\n');

  await page.locator('input[name=name]').fill('Delivery order request letter');
  await page.locator('form:has(input[name=requiredFor]) button[type=submit], form:has(select[name=requiredFor]) button[type=submit]').click();
  step('a required document can be listed', await waitForText(page, 'Delivery order request letter'));

  await page.getByRole('button', { name: 'Received' }).first().click();
  step('it can be settled', await waitForText(page, '1 of 1 settled'));

  console.log('\nSteps 5 and 6 — the invoices\n');

  const proforma = page.locator('form:has(input[name=invoiceNumber])').first();
  await proforma.locator('input[name=invoiceNumber]').fill('PI-2026-001');
  await proforma.locator('input[name=amount]').fill('48500');
  await proforma.getByRole('button', { name: 'Save invoice' }).click();
  step('the proforma invoice records', await waitForText(page, 'Invoice saved.'));

  await page.getByRole('button', { name: 'Mark scrutinised' }).first().click();
  step('it can be marked scrutinised', await waitForText(page, 'Marked as scrutinised.'));
  step(
    'the invoice call alert clears once scrutinised',
    !(await bodyText(page)).includes('invoice call is due'),
  );

  await page.getByRole('button', { name: 'Record that accounts were told' }).first().click();
  step('accounts can be recorded as told', await waitForText(page, 'accounts have been told'));

  const paidForm = page.locator('form:has(input[name=paidOn])').first();
  await paidForm.locator('input[name=paidOn]').fill(day(0));
  await paidForm.locator('input[name=paymentAmount]').fill('48500');
  await paidForm.locator('input[name=paymentReference]').fill('NEFT-0099');
  await paidForm.getByRole('button', { name: 'Record payment' }).click();
  step('the payment records', await waitForText(page, 'Payment recorded'));

  console.log('\nThe note to the shipping line\n');

  step('a send panel appears once something is paid', await waitForText(page, 'Send the payment details'));
  await page.getByRole('button', { name: 'Draft the email' }).click();
  step('the draft carries the payment reference', await waitForText(page, 'NEFT-0099'));
  step('it is addressed to the line from the master', await waitForText(page, 'do@interasia.test'));

  console.log('\nSteps 7 and 8 — the DO and delivery\n');

  await page.fill('#doNumber', 'DO-778812');
  await page.fill('#doReceivedAt', day(0));
  await page.fill('#doValidUntil', day(7));
  await page.locator('form:has(#doNumber) button[type=submit]').click();
  step('the DO records', await waitForText(page, 'DO recorded'));
  step('operations are told', await waitForText(page, 'Operations told'));

  await page.fill('#deliveredAt', day(0));
  await page.locator('form:has(#deliveredAt) button[type=submit]').click();
  step('delivery records', await waitForText(page, 'Delivery recorded'));
  step('the 15-day deposit clock starts', await waitForText(page, 'within 15 days'));

  console.log('\nStep 9 — the deposit back\n');

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.locator('select[name=depositStatus]').first().selectOption('refunded');
  await page.locator('input[name=depositRefundedOn]').first().fill(day(0));
  await page.getByRole('button', { name: 'Save deposit' }).first().click();
  step('the deposit can be marked refunded', await waitForText(page, 'Deposit saved.'));

  console.log('\nWhere it shows up\n');

  await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
  step('the job list has a delivery order column', await waitForText(page, 'Delivery order'));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  step('the dashboard counts open DOs', await waitForText(page, 'DOs open'));

  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });
  step(
    'the DO writes to the job timeline',
    await waitForText(page, 'Delivery order tracking started'),
  );
  step('the timeline names the steps in prose', await waitForText(page, 'Delivery taken'));
} finally {
  await browser.close();
}

console.log('');
if (failures > 0) {
  console.error(`${failures} check(s) failed.\n`);
  process.exitCode = 1;
} else {
  console.log('Phase D walkthrough passed.\n');
}
