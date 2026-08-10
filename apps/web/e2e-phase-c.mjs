/**
 * Phase C walkthrough: the handover from documents to scrutiny.
 *
 *   pnpm db:start && pnpm dev        # in another shell
 *   node apps/web/e2e-phase-c.mjs
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
console.log(`  company ${seed.companyName}, job ${seed.jobId}\n`);

const browser = await chromium.launch();

try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', seed.email);
  await page.fill('#password', seed.password);
  await page.locator('form:has(#password) button[type=submit]').click();
  await waitForPath(page, '/');

  console.log('Branch master\n');
  await page.goto(`${BASE}/settings/branches`, { waitUntil: 'networkidle' });
  step('the branches page is empty to begin with', await waitForText(page, 'No branches yet'));

  await page.fill('#name', 'Nhava Sheva');
  await page.fill('#code', 'INNSA1');
  await page.locator('form:has(#code) button[type=submit]').click();
  step('a branch can be added', await waitForText(page, 'Nhava Sheva'));
  step('it is active', await waitForText(page, 'active'));

  console.log('\nThe documents branch still owns the job\n');
  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });
  let body = await page.locator('body').innerText();
  step('the export card is shown', body.includes('Export to Logi-Sys'));
  step('the checklist upload asks for the job details', body.includes('Job number') && body.includes('ETA'));
  step('the scrutiny card is not shown yet', !body.includes('Apply the compliance requirements'));

  console.log('\nBulk download\n');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('link', { name: 'Download all' }).click(),
  ]);
  const zip = readFileSync(await download.path());
  step('a zip is produced', zip.subarray(0, 2).toString('latin1') === 'PK', `${zip.byteLength} bytes`);
  step('it is named for the job', /\.zip$/.test(download.suggestedFilename()), download.suggestedFilename());

  console.log('\nHandover to scrutiny\n');

  // The browser blocks the submit itself, since branch/job number/ETA are
  // `required`. Confirm that, then confirm the server refuses it too — the
  // client-side check is a convenience, not the guard.
  await page.setInputFiles(
    '#file',
    path.join(ROOT, '..', 'ex_job4', 'Import CheckList-I-1407526-27-27-JUL-2026_11_36_AM.pdf'),
  );
  await page.getByRole('button', { name: 'Upload and start scrutiny' }).click();
  await page.waitForTimeout(500);
  step(
    'the form will not submit without the job details',
    await page.locator('#branchId:invalid').count() === 1,
  );

  const guarded = await page.evaluate(async (jobId) => {
    const body = new FormData();
    body.append('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'x.pdf'));
    const res = await fetch(`/api/jobs/${jobId}/checklist`, { method: 'POST', body });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  }, seed.jobId);
  step(
    'the server refuses a checklist with no branch',
    guarded.status === 400 && String(guarded.error).includes('branch'),
    `${guarded.status} ${guarded.error ?? ''}`,
  );

  await page.selectOption('#branchId', { label: 'Nhava Sheva' });
  await page.fill('#jobNumber', '14075');
  await page.fill('#eta', '2026-09-15');
  await page.setInputFiles(
    '#file',
    path.join(ROOT, '..', 'ex_job4', 'Import CheckList-I-1407526-27-27-JUL-2026_11_36_AM.pdf'),
  );
  await page.getByRole('button', { name: 'Upload and start scrutiny' }).click();
  step('the job enters scrutiny', await waitForText(page, 'In scrutiny'));

  body = await page.locator('body').innerText();
  step('the job number is shown', body.includes('14075'));
  step('the branch is shown', body.includes('Nhava Sheva'));
  step('the ETA is shown', /15\/09\/2026|9\/15\/2026|15 Sept|Sep 15/.test(body), 'date rendering');
  step('the details are on the timeline', body.includes('Branch, job number and ETA recorded'));

  console.log('\nOwnership moves with the stage\n');
  step('the export card is gone', !body.includes('Export to Logi-Sys'));
  step('the checklist upload is gone', !body.includes('Upload and start scrutiny'));
  step('the scrutiny panel has taken over',
    body.includes('HS codes') && body.includes('Compliance requirements'));

  await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
  step('the list shows the new stage', await waitForText(page, 'In scrutiny'));

  // ------------------------------------------------------------- C2 ----
  console.log('\nCompliance requirements master\n');
  await page.goto(`${BASE}/settings/ccr`, { waitUntil: 'networkidle' });
  step('the requirements master starts empty', await waitForText(page, 'Nothing here yet'));

  // 3304 is the heading for the cosmetics in the example invoice; 0902 is tea,
  // deliberately unrelated, so we can prove prefix matching does not overreach.
  await page.fill(
    '#csv',
    [
      'hs_code,code,title,requirement_text',
      '3304,FSSAI-01,FSSAI registration,"Cosmetic and personal care imports require a valid FSSAI import registration plus a certificate of analysis for each batch."',
      '3304,BIS-02,BIS certification,"Goods under this heading require a BIS certificate of conformity issued before shipment."',
      '0902,PQ-01,Phytosanitary certificate,"Tea imports require a phytosanitary certificate from the country of origin."',
    ].join('\n'),
  );
  await page.locator('form:has(#csv) button[type=submit]').click();
  step('requirements import', await waitForText(page, 'Imported 3 requirement(s)'));
  body = await page.locator('body').innerText();
  step('all three are listed', body.includes('FSSAI-01') && body.includes('BIS-02') && body.includes('PQ-01'));

  console.log('\nScrutiny assessment\n');
  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('the HS code editor is shown', body.includes('HS codes'));

  // Set the codes explicitly rather than relying on what the classifier read
  // off this particular invoice.
  await page.fill('#hsCodes', '33049990');
  await page.locator('form:has(#hsCodes) button[type=submit]').click();
  step('HS codes save', await waitForText(page, 'HS code(s) saved'));

  await page.reload({ waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('requirements under the same heading are suggested',
    body.includes('FSSAI-01') && body.includes('BIS-02'));
  step('an unrelated heading is not suggested', !body.includes('PQ-01'));

  await page.locator('form:has(input[name=ccrId]) button[type=submit]').click();
  step('the assessment runs', await waitForText(page, 'Assessed', 90000));

  await page.reload({ waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('the requirements are recorded as applied', body.includes('2 applied'));
  step('remarks were written', body.includes('Remarks'));
  step('the assessment is on the timeline', body.includes('Compliance requirements assessed'));

  const requestCount = await page.locator('text=Documents to obtain').count();
  step('missing documents were identified', requestCount === 1,
    requestCount === 0 ? 'no requests raised' : undefined);
  if (requestCount === 1) {
    body = await page.locator('body').innerText();
    console.log('      requested:', body.split('Documents to obtain')[1]?.split('Timeline')[0]?.trim().split('\n').slice(0, 8).join(' | '));
  }

  // ------------------------------------------------------------- C3 ----
  console.log('\nShipper master\n');
  await page.goto(`${BASE}/settings/shippers`, { waitUntil: 'networkidle' });
  await page.fill('#name', seed.supplierName || 'Test Supplier');
  await page.fill('#email', 'shipper@example.test');
  await page.fill('#aliases', 'Test Supplier Ltd');
  await page.locator('form:has(#aliases) button[type=submit]').click();
  step('a shipper can be added', await waitForText(page, 'shipper@example.test'));

  console.log('\nRequest to the shipper\n');
  await page.goto(`${BASE}/jobs/${seed.jobId}`, { waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('the drafted email is offered for approval', body.includes('Approve and send to shipper'));
  step('the draft has a body', (await page.locator('#body').inputValue()).length > 40);

  const subject = await page.locator('#subject').inputValue();
  step('the draft has a subject', subject.length > 5, subject);

  await page.fill('#to', 'shipper@example.test');
  await page.locator('form:has(#body) button[type=submit]').click();
  step('the request sends', await waitForText(page, 'Sent to shipper@example.test', 60000));

  await page.reload({ waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('the job is awaiting the shipper', body.includes('Awaiting shipper'));
  step('the send is on the timeline', body.includes('Documents requested from the shipper'));

  console.log('\nReconciling what comes back\n');
  await page.getByRole('button', { name: 'Check what has arrived' }).click();
  step('the reconcile pass runs', await waitForText(page, 'match', 90000));

  // Requests must not close themselves; a human ticks them.
  body = await page.locator('body').innerText();
  step('nothing was closed automatically', body.includes('0 of 3 settled'));

  await page.getByRole('button', { name: 'Received' }).first().click();
  step('a request can be marked received', await waitForText(page, '1 of 3 settled'));

  // ------------------------------------------------------------- C4 ----
  console.log('\nClosing out\n');
  body = await page.locator('body').innerText();
  step('closing out is blocked while documents are outstanding',
    body.includes('still outstanding'));

  // Settle the rest so the job can close out.
  for (let i = 0; i < 4; i++) {
    const next = page.getByRole('button', { name: 'Not needed' }).first();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(1200);
  }
  await page.reload({ waitUntil: 'networkidle' });
  step('everything is settled', await waitForText(page, '3 of 3 settled'));

  body = await page.locator('body').innerText();
  step('closing out is now offered', body.includes('Ask for a revised checklist'));

  await page.getByRole('button', { name: 'Ask for a revised checklist' }).click();
  step('the job goes back for a revision', await waitForText(page, 'Checklist being revised'));

  body = await page.locator('body').innerText();
  step('the documents branch gets the upload back', body.includes('Upload revised checklist'));
  step('scrutiny controls step aside', !body.includes('Ask for a revised checklist'));

  await page.setInputFiles(
    '#file',
    path.join(ROOT, '..', 'ex_job5', 'Import CheckList-I-3023926-27-09-JUN-2026_03_34_PM.pdf'),
  );
  await page.getByRole('button', { name: 'Upload revised checklist' }).click();
  step('the revision returns it to scrutiny', await waitForText(page, 'In scrutiny'));

  console.log('\nFinal notice and hand-off\n');
  await page.getByRole('button', { name: 'Tell the shipper it is final' }).click();
  step('the closing note is drafted', await waitForText(page, 'Attach the latest checklist', 90000));

  const finalBody = await page.locator('#finalBody').inputValue();
  console.log('      draft:', finalBody.replace(/\n+/g, ' ').slice(0, 160));

  // The one hard content rule: the shipper is never told what happens next
  // internally.
  const leaks = ['noting', 'bill of entry', 'assessment', 'filing', 'customs procedure'];
  const leaked = leaks.filter((w) => finalBody.toLowerCase().includes(w));
  step('the closing note does not mention internal next steps', leaked.length === 0,
    leaked.join(', '));

  await page.locator('form:has(#finalBody) button[type=submit]').click();
  // The success note is transient: once the job leaves scrutiny the whole panel
  // unmounts, so assert on the outcome rather than racing the message.
  step('scrutiny finishes', await waitForText(page, 'At noting', 60000));

  await page.reload({ waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('the job is at noting', body.includes('At noting'));
  step('the hand-off is on the timeline', body.includes('scrutiny done'));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  step('the dashboard reports it at noting', body.includes('Scrutiny done — at noting'));

  await context.close();
} finally {
  await browser.close();
}

console.log('');
if (failures) {
  console.error(`${failures} step(s) failed.\n`);
  process.exit(1);
}
console.log('Phase C walkthrough passed.\n');
