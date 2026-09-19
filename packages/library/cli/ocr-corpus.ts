/**
 * Scanned corpus documents -> page text, by reading the page images.
 *
 *   pnpm --filter @checklist/library ocr-corpus [type ...] [--yes] [--max-pages=N] [--model=M]
 *
 * extract-corpus lists every document with no text layer in text/_report.json
 * (`noText`) -- mostly old gazette scans, and anti-dumping notifications whose
 * duty tables are images. This renders each page with poppler's pdftoppm,
 * has the model transcribe it, and replaces that document's rows in
 * text/<type>.jsonl, marked `ocr: true`. index-corpus then embeds them like any
 * other page, since their text hash has changed.
 *
 * The rows keep the source file's byte size, so a later extract-corpus run
 * keeps the transcription instead of re-reading an empty text layer.
 *
 * Without --yes it lists what it would read and stops. Run it after
 * extract-corpus, never alongside it: both rewrite the same files.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { CORPUS_TYPES, corpusDir, textPath, type CorpusPage, type CorpusType } from '../src/corpus.js';
import { loadRepoEnv } from '../src/reference.js';

loadRepoEnv();

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const maxPages = Number(args.find((a) => a.startsWith('--max-pages='))?.split('=')[1] ?? 2000);
// The extraction workhorse: the scans are dense tables, where a cheaper model
// drops digits, and a wrong duty figure is worse than no text at all.
const model = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'gpt-5.6-terra';
const requested = args.filter((a) => !a.startsWith('--')) as CorpusType[];
const types = requested.length ? requested : CORPUS_TYPES.filter((t) => t !== 'form');

const SYSTEM = `You transcribe scanned pages of Indian Customs notifications and circulars (CBIC) into plain text for a search index.
- Transcribe the English text exactly as printed, in reading order. Skip Hindi text entirely.
- Keep notification numbers, dates, tariff codes, rates and amounts character-for-character.
- Render a table one row per line, cells separated by " | ".
- Write [illegible] where you cannot read something. Never guess or complete a figure.
- Output only the transcription, with no commentary. If the page has no English text, output nothing.`;

interface NoText {
  id: number;
  number: string | null;
  file: string;
  pages: number;
}

type OcrPage = CorpusPage & { ocr?: boolean };

// pgrep exits 0 only when something matches.
if (spawnSync('pgrep', ['-f', 'cli/extract-corpus']).status === 0) {
  console.error('extract-corpus is running; run this after it finishes.');
  process.exit(1);
}

function readRows(type: CorpusType): Map<number, OcrPage[]> {
  const byId = new Map<number, OcrPage[]>();
  const p = textPath(type);
  if (!existsSync(p)) return byId;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as OcrPage;
    byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  }
  return byId;
}

function writeRows(type: CorpusType, rows: Map<number, OcrPage[]>): void {
  const p = textPath(type);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, [...rows.values()].flat().map((r) => JSON.stringify(r)).join('\n') + '\n');
  renameSync(tmp, p);
}

/** Page images, in page order, in a fresh directory the caller removes. */
function renderPages(pdf: string): { dir: string; images: string[] } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  // 150 dpi keeps small print legible while an A4 page stays well under the image limit.
  execFileSync('pdftoppm', ['-r', '150', '-png', pdf, path.join(dir, 'p')], { stdio: 'ignore' });
  const images = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => Number(a.match(/(\d+)\.png$/)![1]) - Number(b.match(/(\d+)\.png$/)![1]))
    .map((f) => path.join(dir, f));
  return { dir, images };
}

const openai = new OpenAI();
let inputTokens = 0;
let outputTokens = 0;

async function transcribe(png: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await openai.responses.create({
        model,
        instructions: SYSTEM,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Transcribe this page.' },
              {
                type: 'input_image',
                detail: 'high',
                image_url: `data:image/png;base64,${readFileSync(png).toString('base64')}`,
              },
            ],
          },
        ],
      });
      inputTokens += res.usage?.input_tokens ?? 0;
      outputTokens += res.usage?.output_tokens ?? 0;
      return res.output_text.trim();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (!(status === 429 || (status ?? 0) >= 500) || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
    }
  }
}

const report = JSON.parse(readFileSync(path.join(corpusDir(), 'text', '_report.json'), 'utf8')) as Record<
  string,
  { noText?: NoText[] }
>;

let budget = maxPages;
const plan: { type: CorpusType; docs: NoText[] }[] = [];
for (const type of types) {
  const docs: NoText[] = [];
  const done = readRows(type);
  for (const doc of report[type]?.noText ?? []) {
    // Already read once: a page that came back empty is a Hindi-only page, and
    // reading it again would cost the same and say the same.
    if (done.get(doc.id)?.some((r) => r.ocr)) continue;
    if (budget - doc.pages < 0) break;
    budget -= doc.pages;
    docs.push(doc);
  }
  if (docs.length) plan.push({ type, docs });
}

const totalPages = plan.reduce((n, p) => n + p.docs.reduce((m, d) => m + d.pages, 0), 0);
for (const p of plan) {
  console.log(`  ${p.type.padEnd(12)} ${p.docs.length} scanned docs, ${p.docs.reduce((m, d) => m + d.pages, 0)} pages`);
}
console.log(`total ${totalPages} pages with ${model} (cap --max-pages=${maxPages})`);
if (!yes) {
  console.log('dry run: pass --yes to transcribe.');
  process.exit(0);
}

for (const { type, docs } of plan) {
  const rows = readRows(type);
  let done = 0;
  let empty = 0;
  const queue = [...docs];
  const worker = async () => {
    for (;;) {
      const doc = queue.shift();
      if (!doc) return;
      const existing = rows.get(doc.id);
      const pdf = path.join(corpusDir(), `${type}s`, doc.file);
      if (!existing?.length || !existsSync(pdf) || !pdf.endsWith('.pdf')) continue;
      const { dir, images } = renderPages(pdf);
      try {
        const texts: string[] = [];
        for (const png of images) texts.push(await transcribe(png));
        const base = existing[0]!;
        rows.set(
          doc.id,
          texts.map((text, i) => ({ ...base, page: i + 1, text, ocr: true })),
        );
        if (texts.every((t) => t.length < 40)) empty++;
      } catch (err) {
        console.error(`  ${type} ${doc.number ?? doc.id}: ${(err as Error).message}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      done++;
      if (done % 20 === 0) {
        writeRows(type, rows);
        console.log(`  ${type}: ${done}/${docs.length} docs, ${inputTokens + outputTokens} tokens so far`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  writeRows(type, rows);
  console.log(`  ${type}: ${done} docs transcribed, ${empty} still without English text`);
}
console.log(`tokens billed: ${inputTokens} in, ${outputTokens} out (${model})`);
