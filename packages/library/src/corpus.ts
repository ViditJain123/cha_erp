import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The CBIC reference corpus, as fetch-corpus.py lays it out:
 *
 *   data/customs-corpus/index/cbic-<type>s.json   every record (committed)
 *   data/customs-corpus/<type>s/<number>__<id>.pdf|html   the Customs files (gitignored)
 *   data/customs-corpus/text/<type>.jsonl          one row per page (gitignored)
 *
 * Shared by extract-corpus (files -> text), index-corpus (text -> pgvector) and
 * the pgvector search backend.
 */

export const CORPUS_TYPES = ['notification', 'circular', 'instruction', 'order', 'regulation', 'rule', 'form'] as const;
export type CorpusType = (typeof CORPUS_TYPES)[number];

export const TAXINFO = 'https://taxinformation.cbic.gov.in';

/** One page of one document. Forms have no file and yield one metadata row. */
export interface CorpusPage {
  type: CorpusType;
  id: number;
  number: string | null;
  date: string | null;
  category: string | null;
  title: string;
  page: number;
  text: string;
  isAmended: boolean;
  isOmitted: boolean;
  isHistory: boolean;
  /** Where a person can read the document (see sourceUrl()). */
  sourceUrl: string;
  /** Size of the source file when extracted; a changed size means re-extract. */
  bytes: number;
}

type Raw = Record<string, unknown>;

/** Field names per type, mirroring DOC_TYPES in fetch-corpus.py. */
const FIELDS: Record<CorpusType, { number: string; name: string; date: string; category: string | null }> = {
  notification: { number: 'notificationNo', name: 'notificationName', date: 'notificationDt', category: 'notificationCategory' },
  circular: { number: 'circularNo', name: 'circularName', date: 'circularDt', category: 'circularCategory' },
  instruction: { number: 'instructionNo', name: 'instructionName', date: 'instructionDt', category: 'instructionCategory' },
  order: { number: 'orderNo', name: 'orderName', date: 'orderDt', category: 'orderCategory' },
  regulation: { number: 'regulationNo', name: 'regulationName', date: 'issueDt', category: null },
  rule: { number: 'ruleDocNo', name: 'ruleDocName', date: 'issueDt', category: 'ruleCategory' },
  form: { number: 'formNo', name: 'formName', date: 'issueDt', category: 'formCategory' },
};

const TABS: Partial<Record<CorpusType, string>> = {
  notification: 'Notifications',
  circular: 'Circulars',
  instruction: 'Instructions',
  order: 'Orders',
  form: 'Forms',
};

export function repoRoot(): string {
  // packages/library/src -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}
export function corpusDir(): string {
  return process.env.CORPUS_DIR ?? path.join(repoRoot(), 'data', 'customs-corpus');
}
export function textPath(type: CorpusType): string {
  return path.join(corpusDir(), 'text', `${type}.jsonl`);
}

const CUSTOMS_TAX_ID = 1000002;

export function taxOf(r: Raw): number | undefined {
  const t = (r.tax ?? r.cbicTaxMst) as { id?: number } | null | undefined;
  return t?.id;
}

function flag(v: unknown): boolean {
  return v === true || (typeof v === 'string' && /^(y|yes|true)$/i.test(v.trim()));
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function loadIndex(type: CorpusType | 'regulation-doc'): Raw[] {
  const p = path.join(corpusDir(), 'index', `cbic-${type}s.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Raw[]) : [];
}

/** Record -> the document-level fields every page row carries. */
export function describe(
  type: CorpusType,
  r: Raw,
  regulationDocs?: Map<number, Raw>,
): Omit<CorpusPage, 'page' | 'text' | 'bytes'> {
  const f = FIELDS[type];
  let title = str(r[f.name]) ?? '';
  let category = f.category ? str(r[f.category]) : null;
  if (type === 'regulation') {
    // A regulation record is one section; name the regulations it belongs to.
    const doc = regulationDocs?.get((r.regulationDoc as { id?: number } | null)?.id ?? -1);
    const docName = doc ? str(doc.regulationDocName) : null;
    const section = [str(r.regulationNo), title].filter(Boolean).join('. ');
    title = docName ? `${docName} — ${section}` : section;
    category = doc ? str(doc.regulationCategory) : null;
  }
  const date = str(r[f.date]);
  return {
    type,
    id: r.id as number,
    number: str(r[f.number]),
    date: date ? date.slice(0, 10) : null,
    category,
    title,
    isAmended: flag(r.isAmended),
    isOmitted: flag(r.isOmitted),
    isHistory: flag(r.isHistory),
    sourceUrl: sourceUrl(type, r.id as number, str(r.docFilePath) ?? str(r.contentFilePath)),
  };
}

/** Where a person can read the document. */
export function sourceUrl(type: string, id: number, filePath?: string | null): string {
  const tab = TABS[type as CorpusType];
  if (tab) return `${TAXINFO}/view-pdf/${id}/ENG/${tab}`;
  if (type === 'regulation') return `${TAXINFO}/suneditor/Regulations/${id}`;
  // Rules have no viewer route; this is the API route (base64 JSON).
  if (filePath) return `${TAXINFO}/content/pdf/${filePath.replace(/\\/g, '/')}`;
  return TAXINFO;
}

export function isCustoms(r: Raw): boolean {
  return taxOf(r) === CUSTOMS_TAX_ID;
}

/**
 * "72/2026-Customs (N.T.)" -> "72/2026". The key exact-number lookups match on;
 * CBIC writes the same number as "072/2026", "72/2026-Cus", "72 /2026" and so on.
 */
export function numberKey(number: string | null | undefined): string | null {
  const m = number?.match(/(\d{1,4})\s*\/\s*(?:\d{1,4}\s*\/\s*)?((?:19|20)\d{2})/);
  return m ? `${parseInt(m[1]!, 10)}/${m[2]}` : null;
}

/** HTML fragment -> text with paragraph breaks kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}
