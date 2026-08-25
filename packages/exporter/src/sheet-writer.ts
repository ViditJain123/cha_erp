import JSZip from 'jszip';
import type { Cell } from './cell.js';
import { columnLetter, escapeXml } from './format.js';
import type { LoadedTemplate } from './template.js';

/**
 * Writes data rows into the vendor template without disturbing anything else.
 *
 * Rows are keyed by the template's own header text rather than by column
 * letter or index. That is the whole safety property: a mapper that names a
 * column the template does not have fails immediately and by name, instead of
 * writing a value one column to the left of where it belongs.
 */

/** One row of a sheet: header text -> cell. Unlisted headers stay blank. */
export type SheetRow = Record<string, Cell>;

/** Rows to write, keyed by sheet name. Sheets absent here are left untouched. */
export type SheetData = Record<string, SheetRow[]>;

function renderCell(ref: string, cell: Cell): string {
  switch (cell.kind) {
    case 'blank':
      // No <c> element at all. An empty inline string can read as "explicitly
      // cleared"; a missing cell reads as "not supplied", which is what a blank
      // column on a Bill of Entry means.
      return '';
    case 'text':
      // Inline strings, not shared strings: xl/sharedStrings.xml is never
      // rewritten, so the header row's string indexes cannot be perturbed.
      // Logi-Sys reads them: the ErrorList it returned for job FUCHS-13841
      // enumerated our products by serial, which it could only do having
      // parsed these cells.
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
  }
}

function renderRow(rowNumber: number, row: SheetRow, indexOf: Map<string, number>): string {
  const cells = Object.entries(row)
    .map(([header, cell]) => ({ column: indexOf.get(header)!, cell }))
    .filter((c) => c.cell.kind !== 'blank')
    .sort((a, b) => a.column - b.column)
    .map((c) => renderCell(`${columnLetter(c.column)}${rowNumber}`, c.cell))
    .join('');

  return `<row r="${rowNumber}">${cells}</row>`;
}

/**
 * Rewrite `<dimension ref="A1:X1"/>` to cover the rows we added.
 *
 * Excel treats a stale dimension as a hint rather than a hard bound, but a
 * wrong one shows up as odd scroll extents and, in some readers, as a repair
 * prompt. Cheap to keep correct.
 */
function rewriteDimension(xml: string, columns: number, lastRow: number): string {
  return xml.replace(/<dimension\s+ref="[^"]*"\s*\/>/, () => {
    const end = `${columnLetter(Math.max(columns, 1))}${lastRow}`;
    return `<dimension ref="A1:${end}"/>`;
  });
}

function spliceRows(xml: string, rowsXml: string): string {
  if (xml.includes('</sheetData>')) {
    return xml.replace('</sheetData>', `${rowsXml}</sheetData>`);
  }
  // Defensive: none of the 19 sheets ships with an empty <sheetData/>, but a
  // future template revision could.
  const selfClosing = /<sheetData\s*\/>/;
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, `<sheetData>${rowsXml}</sheetData>`);
  }
  throw new Error('Worksheet part has no <sheetData> element.');
}

/**
 * Produce a filled workbook from the template and the given rows.
 *
 * Everything outside the touched worksheets' `<sheetData>` and `<dimension>` —
 * styles, shared strings, workbook.xml, external links, doc properties, content
 * types, relationships — is copied through unchanged.
 */
export async function fillTemplate(
  template: LoadedTemplate,
  data: SheetData,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template.bytes);

  for (const [sheetName, rows] of Object.entries(data)) {
    const sheet = template.sheets.get(sheetName);
    if (!sheet) {
      throw new Error(
        `Unknown sheet "${sheetName}". The Logi-Sys template has: ${template.order.join(', ')}.`,
      );
    }
    if (!rows.length) continue;

    for (const row of rows) {
      for (const header of Object.keys(row)) {
        if (!sheet.indexOf.has(header)) {
          // The drift alarm. If the vendor renames or removes a column, this
          // fires in CI rather than silently dropping the value.
          throw new Error(
            `Unknown column "${header}" on sheet "${sheetName}". ` +
              `The template has: ${sheet.headers.filter(Boolean).join(', ')}.`,
          );
        }
      }
    }

    const entry = zip.file(sheet.part);
    const xml = await entry?.async('string');
    if (entry == null || xml === undefined) {
      throw new Error(`Logi-Sys template is missing ${sheet.part}.`);
    }

    // Data starts at row 2; row 1 is the vendor's header row and is never touched.
    const rowsXml = rows.map((row, i) => renderRow(i + 2, row, sheet.indexOf)).join('');
    const withRows = spliceRows(xml, rowsXml);
    const withDimension = rewriteDimension(withRows, sheet.headers.length, rows.length + 1);

    // Carry the template entry's own timestamp over. JSZip would otherwise
    // stamp `new Date()` on a rewritten entry, which makes two exports of the
    // same draft differ byte-for-byte and turns job_exports.sha256 into noise.
    zip.file(sheet.part, withDimension, { date: entry.date });
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
