import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

/**
 * Reads the vendor's `ImportXLSXTemplate.xlsx` and exposes its structure.
 *
 * The file itself is the single source of truth for sheet names, sheet order
 * and column headers — we never restate them in code. `sheet-writer.ts` then
 * copies it through byte-for-byte apart from the rows it splices in, so those
 * three things cannot drift from the vendor's.
 *
 * See `templates/README.md` for why the file is treated as an opaque zip rather
 * than loaded and re-saved with a spreadsheet library.
 */

export interface TemplateSheet {
  /** Sheet name as the vendor spells it, e.g. `GENERAL`. */
  name: string;
  /** Zip path of the worksheet part, e.g. `xl/worksheets/sheet1.xml`. */
  part: string;
  /** Row-1 header text, in column order. */
  headers: string[];
  /** Header text to 1-based column number. */
  indexOf: Map<string, number>;
}

export interface LoadedTemplate {
  bytes: Buffer;
  /** Sheet names in workbook order. */
  order: string[];
  sheets: Map<string, TemplateSheet>;
}

const TEMPLATE_URL = new URL('../templates/ImportXLSXTemplate.xlsx', import.meta.url);

let cachedBytes: Buffer | null = null;
let cachedTemplate: LoadedTemplate | null = null;

/**
 * The checked-in template's bytes.
 *
 * Throws rather than degrading. An earlier version of this exporter silently
 * emitted an empty-but-valid workbook when it had nothing to say, and that
 * shipped to users as a working export; a missing template must be loud.
 */
export function templateBytes(): Buffer {
  if (cachedBytes) return cachedBytes;
  try {
    cachedBytes = readFileSync(fileURLToPath(TEMPLATE_URL));
  } catch (cause) {
    throw new Error(
      'Logi-Sys import template is missing from the build. It lives at ' +
        'packages/exporter/templates/ImportXLSXTemplate.xlsx; if this is a ' +
        'serverless bundle, check outputFileTracingIncludes in next.config.ts.',
      { cause },
    );
  }
  return cachedBytes;
}

/** SHA-256 of the template, stamped into the export's template version. */
export function templateHash(): string {
  return createHash('sha256').update(templateBytes()).digest('hex');
}

/* ------------------------------------------------------------------ *
 * Minimal OOXML reading
 *
 * Only enough to find sheet parts and read row 1. A full XML parser is not
 * needed: these header rows are flat, machine-generated and well-formed.
 * ------------------------------------------------------------------ */

function decode(xml: string): string {
  return xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&');
}

/** Shared-string table, in index order. */
function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    // A shared string can be split across several <t> runs.
    [...(m[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decode(t[1] ?? ''))
      .join(''),
  );
}

/** Column letters from a cell reference: `AB12` -> `AB`. */
function columnOf(ref: string): string {
  return /^([A-Z]+)/.exec(ref)?.[1] ?? '';
}

/** `A` -> 1, `AA` -> 27. */
function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Read row 1 of a worksheet part as header text, in column order. */
function readHeaderRow(sheetXml: string, sharedStrings: string[]): string[] {
  const row = /<row[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/.exec(sheetXml);
  if (!row?.[1]) return [];

  const headers: string[] = [];
  for (const cell of row[1].matchAll(/<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const [, ref = '', attrs = '', body = ''] = cell;
    const index = columnNumber(columnOf(ref));
    let value = '';

    if (/\bt="inlineStr"/.test(attrs)) {
      value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1] ?? '')).join('');
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (raw !== undefined) {
        value = /\bt="s"/.test(attrs) ? (sharedStrings[Number(raw)] ?? '') : decode(raw);
      }
    }

    // Headers are sparse only if the vendor left a gap; keep positions exact.
    headers[index - 1] = value;
  }

  for (let i = 0; i < headers.length; i += 1) headers[i] ??= '';
  return headers;
}

/**
 * Parse the template into sheet order + per-sheet headers.
 *
 * Cached: the file never changes at runtime, and every export pays this cost
 * otherwise.
 */
export async function loadTemplate(): Promise<LoadedTemplate> {
  if (cachedTemplate) return cachedTemplate;

  const bytes = templateBytes();
  const zip = await JSZip.loadAsync(bytes);

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relsXml) {
    throw new Error('Logi-Sys template is not a readable workbook: xl/workbook.xml is missing.');
  }

  const relTarget = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = rel[1] ?? '';
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (id && target) {
      relTarget.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
    }
  }

  const sharedStrings = readSharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string'));

  const order: string[] = [];
  const sheets = new Map<string, TemplateSheet>();

  for (const sheet of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = sheet[1] ?? '';
    const name = decode(/\bname="([^"]+)"/.exec(attrs)?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1];
    if (!name || !rid) continue;

    const part = relTarget.get(rid);
    if (!part) throw new Error(`Logi-Sys template sheet "${name}" has no worksheet part.`);

    const sheetXml = await zip.file(part)?.async('string');
    if (sheetXml === undefined) throw new Error(`Logi-Sys template is missing ${part}.`);

    const headers = readHeaderRow(sheetXml, sharedStrings);
    const indexOf = new Map<string, number>();
    headers.forEach((header, i) => {
      if (header && !indexOf.has(header)) indexOf.set(header, i + 1);
    });

    order.push(name);
    sheets.set(name, { name, part, headers, indexOf });
  }

  if (!order.length) throw new Error('Logi-Sys template declares no sheets.');

  cachedTemplate = { bytes, order, sheets };
  return cachedTemplate;
}

/** Test seam: drop the cached parse so a test can reload from disk. */
export function resetTemplateCache(): void {
  cachedBytes = null;
  cachedTemplate = null;
}
