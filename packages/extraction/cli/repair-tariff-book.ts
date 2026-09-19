import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MODELS, structuredPdfCall } from '../src/openai.js';

/**
 * Re-reads the tariff pages whose rows the arithmetic could not reconcile.
 *
 * build-tariff-book.py grades every schedule row against the TOTAL printed
 * beside it, and ~8% do not reconcile under any reading of their cells — the
 * OCR dropped a digit rather than a decimal point, or the row carries an AIDC
 * or cess the column layout does not show. Those rows ship as `unverified`,
 * which is honest but not useful: a reviewer still has to open the book.
 *
 * So they get read again, from the page image rather than the text layer. The
 * model is shown the rendered page and asked only what it can *see* in the
 * printed cells for a named list of tariff items. It is not asked what the duty
 * should be, and it is given no prior reading to agree with — a model handed
 * "the OCR says 250, is that right?" will say yes.
 *
 * Its answer is then put through the same checksum as the original parse.
 * Nothing is taken on the model's word: a re-read that still does not reconcile
 * is discarded and the row stays `unverified`. The model is a second pair of
 * eyes on the page, and the arithmetic remains the judge.
 *
 *     pnpm --filter @checklist/extraction repair-tariff-book [--limit N] [--dry]
 */

const SCHEDULE = 'packages/core/src/masters/generated/tariff-book/schedule.json';
const REPAIRS = 'packages/core/src/masters/generated/tariff-book/repairs.json';
const BOOK = 'data/tariff-books/bdp-2026-27-vol1.pdf';

/** 300 dpi: the body text is 7pt, and 150 loses the decimal points. */
const DPI = 300;

const TOLERANCE = 0.02;

const RowSchema = z.object({
  /** The 8-digit code as printed in the first column. */
  cth: z.string(),
  /** BASIC column, or null if the cell is blank or not a plain percentage. */
  basic: z.number().nullable(),
  /** EFFECTIVE column. */
  effective: z.number().nullable(),
  /** IGST column — the statutory rate, e.g. 18, not the rupee amount. */
  igst: z.number().nullable(),
  /** SWS column exactly as printed (a percentage of assessable value). */
  sws: z.number().nullable(),
  /** TOTAL column, usually to three decimals. */
  total: z.number().nullable(),
  /** Anything in the cells you could not read with confidence. */
  unreadable: z.string(),
});

const PageSchema = z.object({ rows: z.array(RowSchema) });

const SYSTEM = `You are reading one page of the Indian Customs Tariff (BDP, 2026-27) from a scan, and transcribing cells from its rate table.

The table's columns are, left to right: HSCODE, ITEM DESCRIPTION, UNIT, BASIC, EFFECTIVE, PRE., IGST, SWS, TOTAL, IMP. POL., REMARKS, EXP.POL. Report BASIC, EFFECTIVE, IGST, SWS and TOTAL for each tariff item you are asked about.

Transcribe what is printed. Do not compute, correct, or reconcile anything — if a cell looks wrong to you, report it as printed and say so in "unreadable". Read decimal points carefully: this scan loses them, and "2.50" and "250" are different duties. TOTAL is normally printed to three decimals.

A blank cell, a dash, or "Free" is null, not zero — except that the SWS column genuinely prints 0.00 for surcharge-exempt goods, and that is a zero.

If a row is not on this page, or you cannot see its cells, omit it rather than guessing.`;

interface BookRow {
  cth: string;
  page: number;
  confidence: string;
  basicBcdRate?: number;
  effectiveBcdRate?: number;
  igstRate?: number;
  swsOfAv?: number;
  totalIncidencePercent?: number;
}

/** The same identity build-tariff-book.py grades against. Kept in step by hand. */
function reconciles(effective: number, igst: number, sws: number | null, total: number): boolean {
  const applied =
    sws !== null && (Math.abs(sws) <= TOLERANCE || Math.abs(sws - 0.1 * effective) <= TOLERANCE)
      ? sws
      : 0.1 * effective;
  const expected = effective + applied + (igst / 100) * (100 + effective + applied);
  return Math.abs(expected - total) <= TOLERANCE;
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(path.join(dir, SCHEDULE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find ${SCHEDULE} from ${process.cwd()}`);
}

function renderPage(root: string, pageNo: number, outDir: string): Buffer {
  const stem = path.join(outDir, `p${pageNo}`);
  const file = `${stem}.png`;
  if (!existsSync(file)) {
    // pdftoppm ships with poppler and is already a dependency of the corpus
    // tooling. Rendering in-process would mean a headless Chrome or a wasm
    // build of pdfium for 226 pages, once.
    execFileSync('pdftoppm', [
      '-png', '-r', String(DPI),
      '-f', String(pageNo), '-l', String(pageNo),
      '-singlefile', path.join(root, BOOK), stem,
    ]);
  }
  return readFileSync(file);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const dry = args.includes('--dry');

  const root = repoRoot();
  const file = JSON.parse(readFileSync(path.join(root, SCHEDULE), 'utf8')) as {
    rows: BookRow[];
  };

  // Grouped by page: one render and one call answers every unreconciled row on
  // it, and they cluster — 980 rows sit on ~226 pages.
  const byPage = new Map<number, BookRow[]>();
  for (const row of file.rows) {
    if (row.confidence !== 'unverified') continue;
    const list = byPage.get(row.page);
    if (list) list.push(row);
    else byPage.set(row.page, [row]);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b).slice(0, limit);
  console.log(
    `${[...byPage.values()].flat().length} unverified rows on ${byPage.size} pages; ` +
      `re-reading ${pages.length}${dry ? ' (dry run, no model calls)' : ''}`,
  );
  if (dry) return;

  const outDir = path.join(root, 'node_modules', '.cache', 'tariff-pages');
  mkdirSync(outDir, { recursive: true });

  const repairs: Record<string, unknown> = {};
  let fixed = 0;
  let stillBroken = 0;

  for (const pageNo of pages) {
    const wanted = byPage.get(pageNo)!;
    let parsed;
    try {
      const image = renderPage(root, pageNo, outDir);
      parsed = await structuredPdfCall({
        schema: PageSchema,
        schemaName: 'tariff_page_cells',
        system: SYSTEM,
        userText:
          `Report the rate cells for these tariff items on this page:\n` +
          wanted.map((r) => r.cth).join(', '),
        fileName: `tariff-p${pageNo}.png`,
        pdf: image,
        mimeType: 'image/png',
        model: MODELS.extract,
      });
    } catch (err) {
      console.log(`  p${pageNo}: ${(err as Error).message}`);
      continue;
    }

    for (const row of parsed.data.rows) {
      const target = wanted.find((r) => r.cth === row.cth);
      if (!target) continue;
      if (row.effective === null || row.igst === null || row.total === null) {
        stillBroken++;
        continue;
      }
      if (!reconciles(row.effective, row.igst, row.sws, row.total)) {
        stillBroken++;
        continue;
      }
      fixed++;
      repairs[row.cth] = {
        basicBcdRate: row.basic ?? row.effective,
        effectiveBcdRate: row.effective,
        igstRate: row.igst,
        ...(row.sws !== null && { swsOfAv: row.sws }),
        totalIncidencePercent: row.total,
        page: pageNo,
        source: 'vision',
        model: parsed.model,
      };
    }
    console.log(`  p${pageNo}: ${wanted.length} asked, ${fixed} reconciled so far`);
  }

  const payload = {
    _generated: 'do not edit by hand — pnpm --filter @checklist/extraction repair-tariff-book',
    note:
      'Rows re-read from the page image because the text layer would not reconcile. ' +
      'Every entry here passed the same arithmetic check as the deterministic parse; ' +
      'rows that still did not are absent, and stay unverified.',
    builtAt: new Date().toISOString(),
    repaired: Object.keys(repairs).length,
    rows: repairs,
  };
  writeFileSync(path.join(root, REPAIRS), `${JSON.stringify(payload, null, 1)}\n`);
  console.log(
    `\n${fixed} rows now reconcile, ${stillBroken} still do not and stay unverified.\n` +
      `wrote ${REPAIRS}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
