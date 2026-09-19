import { productIndexFile, type ProductIndexEntry } from './tariff-book.js';

/**
 * Lexical search over the printed alphabetical product index.
 *
 * Volume III maps ~13,000 product *names* to the headings they are classified
 * under — "Flatirons Electric" to 8516.40, "Flaxseed (Linseed)" to 1204.00. It
 * is the only part of the tariff that answers "what code is this?" rather than
 * "what does this code cost?".
 *
 * This is deliberately lexical and not an embedding search. The index is a list
 * of short trade names, and what matters is whether the goods description
 * contains one of them — "ACETAZOLAMIDE USP 99.5% 25KG DRUM" contains
 * "Acetazolamide" and that is the whole signal. A vector search over 13,000
 * two-word strings would blur exactly the distinctions the index exists to
 * make, cost an API call per line, and be unable to say *why* it matched.
 *
 * What comes back is a candidate list, never an answer. The index is a finding
 * aid: it has not read the Section and Chapter Notes that actually decide a
 * contested heading, and it is set against HS-2022 rather than the current
 * schedule. Callers are expected to put the candidates to someone — or
 * something — that can weigh them, and to cite the entry that won.
 */

export interface ProductIndexHit extends ProductIndexEntry {
  /** Higher is better. Only comparable within one result set. */
  score: number;
  /** Query words this entry matched, for a reviewer to see why it is here. */
  matched: string[];
}

/**
 * Words that carry no classification signal. Trade descriptions are dense with
 * packing and grade noise — "25KG DRUM", "GRADE A", "AS PER INVOICE" — and
 * without this the top hits are whatever the index happens to say about drums.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'other', 'others', 'not', 'per', 'kgs',
  'kg', 'mts', 'mt', 'pcs', 'nos', 'pack', 'packs', 'packing', 'packed', 'bag',
  'bags', 'drum', 'drums', 'box', 'boxes', 'carton', 'cartons', 'roll', 'rolls',
  'grade', 'quality', 'type', 'model', 'size', 'new', 'used', 'make', 'brand',
  'invoice', 'item', 'items', 'goods', 'total', 'net', 'gross', 'weight',
  'min', 'max', 'approx', 'about', 'each', 'pcs.', 'no', 'nos.', 'qty',
]);

/**
 * Trailing plurals are dropped so "raisins" and "raisin" are one token. Only
 * past four characters, which keeps "gas" and "ores" from being mangled.
 */
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function tokenise(text: string): string[] {
  return words(text).map(stem);
}

/**
 * Query tokens, plus each adjacent pair joined.
 *
 * The index sets compound goods as one word — "Flatirons Electric",
 * "Flaxseed", "Handbags" — while an invoice writes them apart: "ELECTRIC FLAT
 * IRON 1200W". Without the join that line matches "flat" and "iron"
 * separately and lands on flat-rolled steel and iron springs, which is both
 * wrong and confidently wrong.
 */
function queryTokens(text: string): string[] {
  const plain = words(text);
  const joined: string[] = [];
  for (let i = 0; i + 1 < plain.length; i++) joined.push(plain[i]! + plain[i + 1]!);
  return [...new Set([...plain, ...joined].map(stem))];
}

interface Inverted {
  entries: ProductIndexEntry[];
  /** token -> the entries containing it */
  postings: Map<string, number[]>;
  /** token -> inverse document frequency */
  idf: Map<string, number>;
  /** entry -> how many searchable tokens it has */
  length: number[];
}

let inverted: Inverted | null | undefined;

function index(): Inverted | null {
  if (inverted !== undefined) return inverted;
  const file = productIndexFile();
  if (!file) {
    inverted = null;
    return null;
  }
  const postings = new Map<string, number[]>();
  const length: number[] = [];
  file.entries.forEach((entry, i) => {
    const tokens = new Set(tokenise(entry.term));
    length.push(tokens.size);
    for (const token of tokens) {
      const list = postings.get(token);
      if (list) list.push(i);
      else postings.set(token, [i]);
    }
  });
  const total = file.entries.length;
  const idf = new Map<string, number>();
  for (const [token, list] of postings) {
    // Squared, so a match rests on how *distinctive* the shared word is rather
    // than on how many words are shared. "acetazolamide" occurs once in 13,000
    // entries and "iron" in hundreds; linear weighting lets two vague words
    // outvote one exact one, which is how "ELECTRIC FLAT IRON" ends up
    // classified as iron springs.
    const weight = Math.log(1 + total / list.length);
    idf.set(token, weight * weight);
  }
  inverted = { entries: file.entries, postings, idf, length };
  return inverted;
}

/**
 * Index entries whose product name best matches a goods description.
 *
 * Scoring is IDF-weighted overlap, divided by the square root of the entry's
 * own length. The division is what stops a long entry from winning on breadth:
 * without it "Machinery, parts of, for the manufacture of..." outranks
 * "Acetazolamide" for almost any chemical, because it contains more words to
 * collide with.
 */
export function searchProductIndex(description: string, limit = 8): ProductIndexHit[] {
  const idx = index();
  if (!idx) return [];
  const query = queryTokens(description);
  if (!query.length) return [];

  const scores = new Map<number, { score: number; matched: string[] }>();
  for (const token of query) {
    const list = idx.postings.get(token);
    if (!list) continue;
    const weight = idx.idf.get(token) ?? 0;
    for (const i of list) {
      const current = scores.get(i) ?? { score: 0, matched: [] };
      current.score += weight;
      current.matched.push(token);
      scores.set(i, current);
    }
  }

  return [...scores.entries()]
    .map(([i, { score, matched }]) => ({
      ...idx.entries[i]!,
      score: score / Math.sqrt(Math.max(idx.length[i] ?? 1, 1)),
      matched,
    }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, limit);
}
