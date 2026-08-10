/**
 * Phase B walkthrough: an ingested job seen through the UI, exported to a
 * Logi-Sys spreadsheet, and closed out with the checklist PDF.
 *
 *   pnpm db:start && pnpm dev        # in another shell
 *   node apps/web/e2e-phase-b.mjs
 *
 * Seeds its fixture through the real ingest pipeline, so this makes a few
 * OpenAI calls.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

async function waitForText(page, needle, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.locator('body').innerText()).includes(needle)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

console.log('\nSeeding a job through the real ingest pipeline…');
const seedOutput = execFileSync(
  'corepack',
  ['pnpm', '--filter', '@checklist/ingest', 'demo:seed'],
  { cwd: ROOT, encoding: 'utf8' },
);
const seed = JSON.parse(seedOutput.trim().split('\n').at(-1));
console.log(`  company ${seed.companyName}, job ${seed.jobId}, ${seed.documentsAdded} documents\n`);

const browser = await chromium.launch();

try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  console.log('Job screens\n');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', seed.email);
  await page.fill('#password', seed.password);
  await page.locator('form:has(#password) button[type=submit]').click();
  step('owner signs in', (await waitForPath(page, '/')) === '/', page.url());

  await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
  const listBody = await page.locator('body').innerText();
  step('the ingested job is listed', listBody.includes('MEDU') || listBody.includes('BL '));
  step('its stage is documents received', listBody.includes('Documents received'));

  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });
  const detailBody = await page.locator('body').innerText();
  step('both documents are shown', detailBody.includes('14075 BL.pdf') && detailBody.includes('14075 INV AND PACK.pdf'));
  step('the classifier result is shown', detailBody.includes('Bill of Lading'));
  step('extracted identifiers are shown', detailBody.includes('B/L'));
  step('the timeline records the ingest', detailBody.includes('Job opened from an email'));

  console.log('\nDocument access\n');
  const docStatus = await page.evaluate(async (jobId) => {
    const res = await fetch(`/api/jobs/${jobId}/documents/00000000-0000-0000-0000-000000000000`);
    return res.status;
  }, seed.jobId);
  step('an unknown document id is refused', docStatus === 404, `status ${docStatus}`);

  console.log('\nExport to Logi-Sys\n');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('text=Download spreadsheet'),
  ]);
  const downloadPath = await download.path();
  const bytes = readFileSync(downloadPath);
  step('a file is downloaded', bytes.byteLength > 0, `${bytes.byteLength} bytes`);
  // PK zip magic — an xlsx is a zip container.
  step('it is a real xlsx', bytes.subarray(0, 2).toString('latin1') === 'PK');
  step('it is named for the job', /^logisys-.*\.xlsx$/.test(download.suggestedFilename()),
    download.suggestedFilename());

  await page.reload({ waitUntil: 'networkidle' });
  step('the stage advances to exported', await waitForText(page, 'Exported to Logi-Sys'));
  step('the export is on the timeline', await waitForText(page, 'Logi-Sys spreadsheet exported'));

  console.log('\nChecklist upload\n');

  // Since Phase C the upload also captures the job details, so a branch must
  // exist before the documents branch can hand over.
  await page.goto(`${BASE}/settings/branches`, { waitUntil: 'networkidle' });
  await page.fill('#name', 'Nhava Sheva');
  await page.locator('form:has(#code) button[type=submit]').click();
  await waitForText(page, 'Nhava Sheva');
  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });

  // A non-PDF must be refused on its content, not its declared type.
  await page.selectOption('#branchId', { label: 'Nhava Sheva' });
  await page.fill('#jobNumber', '14075');
  await page.fill('#eta', '2026-09-15');
  await page.setInputFiles('#file', {
    name: 'not-a-checklist.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('this is plainly not a pdf'),
  });
  await page.click('text=Upload and start scrutiny');
  step('a file that is not really a PDF is rejected', await waitForText(page, 'not a PDF'));

  // The genuine Logi-Sys checklist for this shipment.
  await page.setInputFiles(
    '#file',
    path.join(ROOT, '..', 'ex_job4', 'Import CheckList-I-1407526-27-27-JUL-2026_11_36_AM.pdf'),
  );
  await page.click('text=Upload and start scrutiny');
  step('the checklist uploads and scrutiny starts', await waitForText(page, 'In scrutiny'));
  step('the upload is on the timeline', await waitForText(page, 'Checklist PDF uploaded'));

  await context.close();
} finally {
  await browser.close();
}

console.log('');
if (failures) {
  console.error(`${failures} step(s) failed.\n`);
  process.exit(1);
}
console.log('Phase B walkthrough passed.\n');
