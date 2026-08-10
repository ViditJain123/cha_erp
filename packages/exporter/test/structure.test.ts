import { describe, expect, it } from 'vitest';
import { code, num, text } from '../src/cell.js';
import { fillTemplate } from '../src/sheet-writer.js';
import { loadTemplate, templateHash } from '../src/template.js';
import { headersOf, openWorkbook, partNames, partText, readSheet } from './read.js';

/**
 * The template-fidelity guard.
 *
 * Logi-Sys is a closed system: we cannot ask it what it expects, so the only
 * assurance we have is that the file we hand it differs from the file it gave
 * us in exactly one respect — the rows we added. Everything here checks that.
 */

/** The vendor's sheets, in the vendor's order. */
const VENDOR_SHEETS = [
  'GENERAL',
  'INBOND_EXBOND',
  'SHIPMENT',
  'CONTAINERS',
  'INVOICES',
  'ITEMS',
  'STATEMENT',
  'SEC65_EXBOND_INFO',
  'RE-IMPORT',
  'LICENSE',
  'SW_ADDL_INFO',
  'SW_CONSTITUENT',
  'SW_PRODUCTION',
  'SW_CONTROL',
  'SEZ_INFO',
  'HSS',
  'BONDS_CERTIFICATES',
  'SUPPORTING_DOCS',
  'EXCHANGE_RATE',
];

/**
 * Pinned so that replacing templates/ImportXLSXTemplate.xlsx is a deliberate,
 * reviewed act rather than something that happens quietly. If the vendor ships
 * a revision, this failing is the prompt to diff the headers before trusting
 * any export built against it.
 */
const TEMPLATE_SHA256 = '12ecee89db39ec23078f7ca01d898ec1ce3d1d74908558705c65b8382060a024';

describe('the checked-in vendor template', () => {
  it('is the file we reviewed', () => {
    expect(templateHash()).toBe(TEMPLATE_SHA256);
  });

  it('declares the 19 sheets in the vendor order', async () => {
    const template = await loadTemplate();
    expect(template.order).toEqual(VENDOR_SHEETS);
  });

  it('has a header row on every sheet', async () => {
    const template = await loadTemplate();
    for (const name of VENDOR_SHEETS) {
      const sheet = template.sheets.get(name);
      expect(sheet, `sheet ${name}`).toBeDefined();
      expect(sheet!.headers.filter(Boolean).length, `sheet ${name} headers`).toBeGreaterThan(0);
    }
  });

  it('parses the wide sheets fully', async () => {
    const template = await loadTemplate();
    // Transcription errors on these two are the likeliest silent failure, so
    // pin their widths and a few load-bearing names.
    expect(template.sheets.get('INVOICES')!.headers.length).toBe(97);
    expect(template.sheets.get('ITEMS')!.headers.length).toBe(127);
    expect(template.sheets.get('GENERAL')!.headers[5]).toBe('AD_Code');
    expect(template.sheets.get('ITEMS')!.headers[8]).toBe('CTH');
    expect(template.sheets.get('SHIPMENT')!.headers).toContain('Marks_&_Nos');
  });
});

describe('a produced workbook', () => {
  async function produce() {
    const template = await loadTemplate();
    return fillTemplate(template, {
      GENERAL: [{ AD_Code: code('0510226'), CustomsHouseCode: code('INNSA1') }],
      CONTAINERS: [
        { 'Container No': code('IAAU1730986'), 'Seal No': code('IAAH479538') },
        { 'Container No': code('IAAU1868002'), 'Seal No': code('IAAH479537') },
      ],
      SHIPMENT: [{ No_of_Pkg: num(6258), 'Marks_&_Nos': text('AS PER BL') }],
    });
  }

  it('opens without a repair prompt and keeps the vendor sheets', async () => {
    const workbook = await openWorkbook(await produce());
    expect(workbook.worksheets.map((w) => w.name)).toEqual(VENDOR_SHEETS);
  });

  it('leaves every header row byte-identical to the template', async () => {
    const template = await loadTemplate();
    const workbook = await openWorkbook(await produce());

    for (const name of VENDOR_SHEETS) {
      const produced = headersOf(workbook.getWorksheet(name)!);
      const expected = template.sheets.get(name)!.headers;
      // exceljs trims trailing empties; compare on the populated prefix.
      expect(produced.slice(0, expected.length), `headers of ${name}`).toEqual(
        expected.slice(0, produced.length || expected.length),
      );
    }
  });

  it('keeps the parts a spreadsheet library would have dropped', async () => {
    // This is the regression test for the approach itself. Loading and
    // re-saving the template with exceljs drops these parts while keeping the
    // definedNames that reference them, leaving a workbook whose defined names
    // point at external books that are no longer present — which is what makes
    // Excel offer to repair the file.
    const names = await partNames(await produce());
    expect(names).toContain('xl/externalLinks/externalLink1.xml');
    expect(names).toContain('xl/externalLinks/externalLink2.xml');
    expect(names).toContain('xl/externalLinks/_rels/externalLink1.xml.rels');
    expect(names).toContain('xl/externalLinks/_rels/externalLink2.xml.rels');
    expect(names).toContain('docProps/custom.xml');
    expect(names).toContain('xl/styles.xml');
    expect(names).toContain('xl/sharedStrings.xml');
  });

  it('does not rewrite workbook.xml or sharedStrings.xml', async () => {
    // Sheet names and order live in workbook.xml; the header row's string
    // indexes live in sharedStrings.xml. Neither is ours to touch.
    const template = await loadTemplate();
    const produced = await produce();

    for (const part of ['xl/workbook.xml', 'xl/sharedStrings.xml', 'xl/styles.xml']) {
      const before = await partText(template.bytes, part);
      const after = await partText(produced, part);
      expect(after, part).toBe(before);
    }
  });

  it('writes rows from row 2 and keys them by header name', async () => {
    const produced = await produce();

    const general = await readSheet(produced, 'GENERAL');
    expect(general).toHaveLength(1);
    expect(general[0]!['AD_Code']).toBe('0510226');
    expect(general[0]!['CustomsHouseCode']).toBe('INNSA1');

    const containers = await readSheet(produced, 'CONTAINERS');
    expect(containers.map((r) => r['Container No'])).toEqual(['IAAU1730986', 'IAAU1868002']);
    expect(containers.map((r) => r['Seal No'])).toEqual(['IAAH479538', 'IAAH479537']);
  });

  it('preserves leading zeros by writing identifiers as text', async () => {
    const rows = await readSheet(await produce(), 'GENERAL');
    expect(typeof rows[0]!['AD_Code']).toBe('string');
    expect(rows[0]!['AD_Code']).not.toBe(510226);
  });

  it('writes numbers as numbers', async () => {
    const rows = await readSheet(await produce(), 'SHIPMENT');
    expect(rows[0]!['No_of_Pkg']).toBe(6258);
    expect(typeof rows[0]!['No_of_Pkg']).toBe('number');
  });

  it('leaves sheets it was given no rows for untouched', async () => {
    const workbook = await openWorkbook(await produce());
    for (const name of ['ITEMS', 'INVOICES', 'LICENSE', 'HSS']) {
      expect(workbook.getWorksheet(name)!.rowCount, `${name} row count`).toBe(1);
    }
  });

  it('is byte-stable for the same input', async () => {
    // job_exports records a sha256 per export; if identical drafts produced
    // different bytes that column would be meaningless.
    const a = await produce();
    const b = await produce();
    expect(a.equals(b)).toBe(true);
  });
});

describe('fillTemplate guards', () => {
  it('rejects a sheet the template does not have', async () => {
    const template = await loadTemplate();
    await expect(fillTemplate(template, { NOT_A_SHEET: [{ x: text('y') }] })).rejects.toThrow(
      /Unknown sheet "NOT_A_SHEET"/,
    );
  });

  it('rejects a column the template does not have, by name', async () => {
    // The drift alarm: if the vendor renames a header, this is what fires,
    // rather than the value landing silently in the wrong column.
    const template = await loadTemplate();
    await expect(
      fillTemplate(template, { GENERAL: [{ AD_Code_Typo: code('0510226') }] }),
    ).rejects.toThrow(/Unknown column "AD_Code_Typo" on sheet "GENERAL"/);
  });
});
