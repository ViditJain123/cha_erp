/**
 * Run the job agent on a corpus folder, with no database.
 *
 * Reads the folder's PDFs (answer keys excluded), runs the per-document
 * pipeline, then the agent, and prints every tool call, decision and flag.
 * The cheapest way to watch the agent think about one job.
 *
 * Usage:
 *   OPENAI_API_KEY=… LIBRARY_DIR=…/apps/web/data/library \
 *     ./node_modules/.bin/tsx cli/job-agent-smoke.ts ex_job26 2026-08-13
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { enrichDraftDescriptions, runJobAgent, runPipeline } from '../src/index.js';

const folder = process.argv[2] ?? 'ex_job26';
const filingDate = process.argv[3] ?? '2026-08-13';
const dir = path.resolve('/Users/viditjain/Desktop/ERP', folder);
const names = readdirSync(dir).filter((n) => /\.(pdf|jpe?g|png)$/i.test(n) && !/Processed BE|CheckList|JobData/i.test(n));
const files = names.map((n) => ({
  fileName: n,
  pdf: readFileSync(path.join(dir, n)),
  ...(/\.jpe?g$/i.test(n) ? { mimeType: 'image/jpeg' } : /\.png$/i.test(n) ? { mimeType: 'image/png' } : {}),
  ...(/LIC|EPCG|AUTHORI|SCRIP/i.test(n) ? { hint: 'license' } : {}),
}));
console.log(`${folder}: ${files.length} file(s), filing ${filingDate}`);
const t0 = Date.now();
const { draft, docs } = await runPipeline(files, { today: filingDate });
console.log(`pipeline: ${draft.items.length} item(s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
const described = await enrichDraftDescriptions(draft);
const t1 = Date.now();
const out = await runJobAgent({ draft: structuredClone(described), docs, files, filingDate, filingDateSource: 'smoke' });
console.log(`agent: ${out.status} in ${((Date.now() - t1) / 1000).toFixed(0)}s, ${out.run.turns} turn(s), ${out.run.toolCalls.length} tool call(s), ${out.run.webSources.length} web search(es)`);
console.log('usage', out.run.usage, out.run.error ?? '');
for (const c of out.run.toolCalls) console.log(`  tool ${c.name} ${JSON.stringify(c.args)} → ${c.resultDigest.slice(0, 100).replace(/\n/g, ' ')}${c.error ? ` [${c.error}]` : ''}`);
for (const w of out.run.webSources) console.log(`  web ${w.queries.join(' | ')} → ${w.urls.join(', ')}`);
for (const d of out.run.decisions) console.log(`  ${d.applied ? '✔' : '✗'} ${d.field} ${d.value ?? '-'} [${d.confidence}] ${d.reason}${d.evidence.length ? ` | ${d.evidence[0]}` : ''}`);
for (const it of out.draft.items) console.log(`  line ${it.invoiceSrNo}/${it.slNo}: CTH ${it.ritc} [${it.sources?.ritc ?? ''}] BCD ${it.bcdRate}% ${it.bcdNotification ?? ''} ${it.notificationSerials?.basic ?? ''} | IGST ${it.igstRate}% ${it.igstNotification ?? ''} ${it.notificationSerials?.igst ?? ''} | exim ${JSON.stringify(it.eximScheme ?? null)} | igstEx ${JSON.stringify(it.igstExemption ?? null)}`);
for (const f of out.draft.flags.filter((f) => /^Agent/.test(f.message))) console.log(`  flag [${f.severity}] ${f.path}: ${f.message.slice(0, 300)}`);
writeFileSync(path.join(process.env.SMOKE_OUT ?? '.', `smoke-${folder}.json`), JSON.stringify({ run: out.run, items: out.draft.items, flags: out.draft.flags }, null, 2));
