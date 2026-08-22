/**
 * Party names, as they arrive and as Logi-Sys holds them.
 *
 * A name off a bill of lading and the same name in the organization repository
 * differ in punctuation, honorifics and legal suffixes far more often than they
 * differ in substance: "M/S. ELITE POLYPLUS" against "ELITE POLYPLUS",
 * "ASIA SHIGEN INTERNATIONAL" against "ASIA SHIGEN INTERNATIONAL CO., LTD".
 * partyNameKey() reduces both to the same string so they can be matched on
 * equality, which is cheap and — unlike a similarity score — never surprises.
 *
 * The key is stored on public.organizations.name_key. This is the only
 * implementation of the rule: the column is written from here rather than
 * generated in SQL, so there is no second copy to drift.
 */

/**
 * Legal-form words that carry no identity. Ordered longest-first only for
 * readability; the regex is word-anchored so order does not matter.
 */
const LEGAL_SUFFIXES = [
  'PRIVATE',
  'LIMITED',
  'CORPORATION',
  'COMPANY',
  'INCORPORATED',
  'PVT',
  'LTD',
  'LLP',
  'LLC',
  'INC',
  'CORP',
  'CO',
  'GMBH',
  'SPA',
  'SRL',
  'PTE',
  'SDN',
  'BHD',
  'FZE',
  'FZCO',
  'FZC',
  'DMCC',
  'BV',
  'NV',
  'SA',
  'AG',
  'KG',
  'OY',
  'AB',
  'AS',
];

const LEGAL_SUFFIX_RE = new RegExp(String.raw`\b(?:${LEGAL_SUFFIXES.join('|')})\b`, 'g');

/**
 * Honorifics that lead a consignee name on transport documents. Stripped
 * before punctuation is flattened, because "M/S." only reads as one token
 * while the slash is still there.
 */
const HONORIFIC_RE = /^\s*(?:M\/S|MESSRS)\b[.\s]*/i;

/** Cells that mean "not supplied" in a Logi-Sys export. */
const NULLISH_CELLS = new Set(['', 'NULL', '.', '..', '-', '--', 'NA', 'N/A', 'NIL']);

/**
 * Branch names that mean "no branch". Logi-Sys writes several of these as the
 * branch of a single-location party, and the known-good workbook leaves
 * GENERAL."Branch Name" empty for a party whose repository branch is "0".
 *
 * MAIN and Main Branch are deliberately absent: 1,693 rows of the sample use
 * them as a real branch name, and blanking those would stop the party
 * resolving on the Logi-Sys side.
 */
const PLACEHOLDER_BRANCHES = new Set(['', '0', '.', '..', '-', '--', 'NA', 'N/A', 'NIL', 'NULL']);

/** A repository cell, or undefined when the cell means "not supplied". */
export function cellValue(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return NULLISH_CELLS.has(s.toUpperCase()) ? undefined : s;
}

/**
 * A party name cell. Same as cellValue but also drops the stray quotes some
 * rows carry ('"LIZHU MACHINERY CO., LTD.'), which would otherwise make the
 * name unmatchable and sort it to the top of every list.
 */
export function partyNameCell(raw: unknown): string | undefined {
  const s = cellValue(raw);
  if (!s) return undefined;
  const trimmed = s.replace(/^["'\s]+/, '').replace(/["'\s]+$/, '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/** True when a branch name is a placeholder and should be written as blank. */
export function isPlaceholderBranch(branch: string | undefined | null): boolean {
  if (branch === null || branch === undefined) return true;
  return PLACEHOLDER_BRANCHES.has(branch.trim().toUpperCase());
}

/** The branch name to write into the workbook: blank when it means nothing. */
export function branchNameForExport(branch: string | undefined | null): string | undefined {
  if (!branch || isPlaceholderBranch(branch)) return undefined;
  return branch.trim();
}

/**
 * Matching form of a party name: uppercase, no punctuation, no honorific, no
 * legal suffix. Two names with the same key are the same party.
 */
export function partyNameKey(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .replace(HONORIFIC_RE, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
