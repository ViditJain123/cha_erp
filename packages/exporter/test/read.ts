import ExcelJS from 'exceljs';

/**
 * Read a produced workbook back the way a consumer would.
 *
 * Tests assert against this rather than against the writer's own intermediate
 * state, so what is checked is the *file* — including that it parses at all.
 * exceljs is a test-only dependency for exactly this reason; the production
 * path never uses it (see templates/README.md).
 */
export async function openWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/** Row-1 header text of a sheet, in column order. */
export function headersOf(sheet: ExcelJS.Worksheet): string[] {
  const values = sheet.getRow(1).values;
  const list = Array.isArray(values) ? values.slice(1) : [];
  return list.map((v) => (v == null ? '' : String(v)));
}

/**
 * Data rows as header-keyed objects, so assertions never mention a column
 * letter — `rows[0]!['CTH']` rather than `getCell('I2')`.
 */
export async function readSheet(
  buffer: Buffer,
  sheetName: string,
): Promise<Record<string, unknown>[]> {
  const workbook = await openWorkbook(buffer);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`No sheet named "${sheetName}" in the produced workbook.`);

  const headers = headersOf(sheet);
  const rows: Record<string, unknown>[] = [];

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const record: Record<string, unknown> = {};
    let populated = false;

    headers.forEach((header, i) => {
      if (!header) return;
      const value = row.getCell(i + 1).value;
      if (value !== null && value !== undefined && value !== '') populated = true;
      record[header] = value ?? undefined;
    });

    if (populated) rows.push(record);
  }

  return rows;
}

/** The zip part names of a produced workbook, for structural assertions. */
export async function partNames(buffer: Buffer): Promise<string[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => !zip.files[name]!.dir).sort();
}

/** A single part's text, for byte-identity assertions. */
export async function partText(buffer: Buffer, part: string): Promise<string | undefined> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(part)?.async('string');
}
