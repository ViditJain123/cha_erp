/**
 * Corpus files -> page text.
 *
 *   pnpm --filter @checklist/library extract-corpus [type ...] [--force]
 *
 * Reads what fetch-corpus.py downloaded into data/customs-corpus/<type>s/ and
 * writes data/customs-corpus/text/<type>.jsonl, one row per page (CorpusPage).
 * PDFs go through unpdf; regulation sections are HTML fragments and are
 * tag-stripped into a single page. Forms have no file worth reading, so each
 * Customs form becomes one metadata row.
 *
 * Incremental: a document whose file size matches its rows from the last run
 * is kept as is. Documents with no text layer (scans) are counted and listed
 * in text/_report.json -- not OCR'd.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  CORPUS_TYPES,
  corpusDir,
  describe,
  htmlToText,
  isCustoms,
  loadIndex,
  textPath,
  type CorpusPage,
  type CorpusType,
} from '../src/corpus.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const types = (args.filter((a) => !a.startsWith('--')) as CorpusType[]).filter((t) => {
  if (CORPUS_TYPES.includes(t)) return true;
  console.error(`unknown type ${t}; one of ${CORPUS_TYPES.join(', ')}`);
  process.exit(1);
});

// unpdf's bundled pdf.js calls Math.sumPrecise (TC39 stage 3), which Node 24
// lacks; without it every glyph measurement logs a warning.
const MathExt = Math as unknown as { sumPrecise?: (xs: Iterable<number>) => number };
MathExt.sumPrecise ??= (xs) => {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum;
};

/** Below this many characters a page carries no usable text layer. */
const MIN_PAGE_CHARS = 40;

async function pdfPages(file: string): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(readFileSync(file)), { verbosity: 0 });
  const { text } = await extractText(doc, { mergePages: false });
  return text;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref()),
  ]);
}

function readRows(type: CorpusType): Map<number, CorpusPage[]> {
  const byId = new Map<number, CorpusPage[]>();
  const p = textPath(type);
  if (!existsSync(p)) return byId;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as CorpusPage;
    byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  }
  return byId;
}

function writeRows(type: CorpusType, byId: Map<number, CorpusPage[]>): void {
  const p = textPath(type);
  mkdirSync(path.dirname(p), { recursive: true });
  const ids = [...byId.keys()].sort((a, b) => a - b);
  const body = ids.flatMap((id) => byId.get(id)!.map((r) => JSON.stringify(r))).join('\n');
  writeFileSync(`${p}.tmp`, body ? `${body}\n` : '');
  renameSync(`${p}.tmp`, p);
}

interface TypeReport {
  records: number;
  customs: number;
  files: number;
  extracted: number;
  kept: number;
  pages: number;
  chars: number;
  noText: { id: number; number: string | null; file: string; pages: number }[];
  failed: { id: number; file: string; error: string }[];
  missingFile: number;
}

async function extractType(type: CorpusType, regulationDocs: Map<number, Record<string, unknown>>): Promise<TypeReport> {
  const records = loadIndex(type);
  const byRecordId = new Map(records.map((r) => [r.id as number, r]));
  const report: TypeReport = {
    records: records.length,
    customs: records.filter(isCustoms).length,
    files: 0,
    extracted: 0,
    kept: 0,
    pages: 0,
    chars: 0,
    noText: [],
    failed: [],
    missingFile: 0,
  };
  const previous = force ? new Map<number, CorpusPage[]>() : readRows(type);
  const out = new Map<number, CorpusPage[]>();

  if (type === 'form') {
    for (const r of records.filter(isCustoms)) {
      const base = describe(type, r);
      const text = [base.number, base.title, base.category && `Category: ${base.category}`].filter(Boolean).join(' — ');
      out.set(base.id, [{ ...base, page: 1, text, bytes: 0 }]);
    }
    report.extracted = out.size;
    report.pages = out.size;
    writeRows(type, out);
    return report;
  }

  const dir = path.join(corpusDir(), `${type}s`);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /__\d+\.(pdf|html)$/.test(f)) : [];
  report.files = files.length;
  const onDisk = new Set<number>();
  let n = 0;
  for (const file of files) {
    n++;
    const id = Number(file.match(/__(\d+)\.(pdf|html)$/)![1]);
    const record = byRecordId.get(id);
    if (!record) continue;
    onDisk.add(id);
    const full = path.join(dir, file);
    const bytes = statSync(full).size;
    const prior = previous.get(id);
    if (prior?.length && prior[0]!.bytes === bytes) {
      out.set(id, prior);
      report.kept++;
    } else {
      try {
        const pages = file.endsWith('.html')
          ? [htmlToText(readFileSync(full, 'utf8'))]
          : await withTimeout(pdfPages(full), 120_000);
        const base = describe(type, record, regulationDocs);
        out.set(
          id,
          pages.map((text, i) => ({ ...base, page: i + 1, text: text.replace(/\u0000/g, '').trim(), bytes })),
        );
        report.extracted++;
      } catch (err) {
        report.failed.push({ id, file, error: String((err as Error)?.message ?? err) });
        continue;
      }
    }
    const rows = out.get(id)!;
    const chars = rows.reduce((s, r) => s + r.text.length, 0);
    report.pages += rows.length;
    report.chars += chars;
    if (rows.every((r) => r.text.length < MIN_PAGE_CHARS)) {
      report.noText.push({ id, number: rows[0]!.number, file, pages: rows.length });
    }
    if (n % 250 === 0) {
      console.log(`  ${type}: ${n}/${files.length} files`);
      writeRows(type, out);
    }
  }
  const wantedFiles = records.filter((r) => (type === 'notification' ? true : isCustoms(r)));
  report.missingFile = type === 'notification' ? 0 : wantedFiles.filter((r) => !onDisk.has(r.id as number)).length;
  writeRows(type, out);
  return report;
}

const regulationDocs = new Map(loadIndex('regulation-doc').map((r) => [r.id as number, r]));
const reportPath = path.join(corpusDir(), 'text', '_report.json');
const reports: Record<string, TypeReport> = existsSync(reportPath)
  ? (JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, TypeReport>)
  : {};
for (const type of types.length ? types : CORPUS_TYPES) {
  const t0 = Date.now();
  const r = await extractType(type, regulationDocs);
  reports[type] = r;
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(reports, null, 1));
  console.log(
    `${type}: ${r.files} files -> ${r.extracted} extracted, ${r.kept} unchanged, ${r.pages} pages, ` +
      `${(r.chars / 1e6).toFixed(1)}M chars; ${r.noText.length} with no text layer, ${r.failed.length} failed` +
      (r.missingFile ? `, ${r.missingFile} Customs records with no file` : '') +
      ` (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
  );
  for (const f of r.failed.slice(0, 10)) console.log(`  ! ${f.file}: ${f.error}`);
}
console.log(`report: ${reportPath}`);
