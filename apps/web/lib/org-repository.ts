import ExcelJS from 'exceljs';
import { cellValue, iso2, partyNameCell, partyNameKey } from '@checklist/core';

/**
 * Reads the Organization Repository export out of Logi-Sys.
 *
 * The file is one sheet with two banner rows above the header and 73 columns,
 * of which about half are empty on every row. The header row is found rather
 * than assumed, because the banner is the company name and could be one line
 * or three.
 *
 * Nothing is rejected for being ugly. The export is full of `NULL` strings,
 * `.` cities and stray quotes, and refusing the file over them would mean the
 * CHA cannot load their own master. Values that mean nothing become undefined
 * and the rest is stored as it stands.
 */

/** One organization, as it will be stored. Field names match the table. */
export interface OrgRepoRow {
  name: string;
  name_key: string;
  alias?: string;
  branch_name: string;
  branch_sr_no: string;
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  email?: string;
  telephone?: string;
  web_url?: string;
  ad_code?: string;
  gstin?: string;
  gst_state_code?: string;
  iec?: string;
  pan?: string;
  cin?: string;
  bin?: string;
  lut_number?: string;
  st_reg_no?: string;
  is_shipper: boolean;
  is_consignee: boolean;
  is_agent: boolean;
  is_transporter: boolean;
  is_service_provider: boolean;
  is_active: boolean;
  source_created_on?: string;
  source_created_by?: string;
  raw: Record<string, string>;
}

export interface OrgRepoParse {
  rows: OrgRepoRow[];
  /** Things worth telling the operator that did not stop the import. */
  warnings: string[];
  /** Things that did. Non-empty errors means rows is not usable. */
  errors: string[];
}

/** Columns without which the file is not an organization repository. */
const REQUIRED_HEADERS = ['Organization', 'Branch Name', 'Branch Sr No'];

/** How far down to look for the header row before giving up. */
const HEADER_SEARCH_ROWS = 10;

function text(row: ExcelJS.Row, column: number | undefined): string {
  if (!column) return '';
  const value = row.getCell(column).value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Rich text and formula results. The export uses neither, but a file that
    // has been opened and saved in Excel might.
    const rich = value as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (rich.richText) return rich.richText.map((r) => r.text).join('');
    if (rich.text !== undefined) return String(rich.text);
    if (rich.result !== undefined) return String(rich.result);
    return '';
  }
  return String(value);
}

/** Logi-Sys writes booleans as the words True and False. */
function flag(raw: string): boolean {
  return raw.trim().toLowerCase() === 'true';
}

/**
 * `exactOptionalPropertyTypes` is on, so an optional field has to be absent
 * rather than present and undefined.
 */
function opt<K extends string>(key: K, value: string | undefined): Record<K, string> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

export async function parseOrganizationRepository(data: Buffer): Promise<OrgRepoParse> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    return { rows: [], warnings, errors: ['That file could not be read as an .xlsx workbook.'] };
  }

  const sheet = workbook.getWorksheet('Organization List') ?? workbook.worksheets[0];
  if (!sheet) return { rows: [], warnings, errors: ['The workbook has no sheets.'] };

  // Find the header row by looking for the columns that must be there.
  let headerRowNumber = 0;
  const columnOf = new Map<string, number>();
  for (let r = 1; r <= Math.min(HEADER_SEARCH_ROWS, sheet.rowCount); r++) {
    const seen = new Map<string, number>();
    sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = String(cell.value ?? '').replace(/\s+/g, ' ').trim();
      // The banner rows repeat one value across all 73 columns, so take the
      // first occurrence of a header and never let a repeat overwrite it.
      if (header && !seen.has(header)) seen.set(header, colNumber);
    });
    if (REQUIRED_HEADERS.every((h) => seen.has(h))) {
      headerRowNumber = r;
      for (const [header, col] of seen) columnOf.set(header, col);
      break;
    }
  }

  if (!headerRowNumber) {
    const wanted = REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ');
    return {
      rows: [],
      warnings,
      errors: [
        `This does not look like an Organization Repository export: no header row with ${wanted} in the first ${HEADER_SEARCH_ROWS} rows.`,
      ],
    };
  }

  const headers = [...columnOf.keys()];
  const at = (row: ExcelJS.Row, header: string) => text(row, columnOf.get(header));

  const byKey = new Map<string, OrgRepoRow>();
  const unmappedCountries = new Set<string>();
  let blankNames = 0;
  let merged = 0;

  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    const name = partyNameCell(at(row, 'Organization'));
    if (!name) {
      // A blank organization is a trailing or spacer row, not an error — but
      // a row with other data and no name is worth mentioning.
      if (headers.some((h) => at(row, h).trim() !== '')) blankNames++;
      continue;
    }

    // Branch is part of the key, so it is never undefined: a party with no
    // branch keys on the empty string. The placeholder branches ("0", ".")
    // are kept verbatim here because they are what Logi-Sys keys on; they are
    // blanked at export time, not at import time.
    const branchName = at(row, 'Branch Name').replace(/\s+/g, ' ').trim();
    const branchSrNo = at(row, 'Branch Sr No').replace(/\s+/g, ' ').trim();

    const key = `${name}|${branchName}|${branchSrNo}`;

    const country = cellValue(at(row, 'Country'));
    const countryCode = iso2(country);
    if (country && !countryCode) unmappedCountries.add(country);

    const gstin = cellValue(at(row, 'GSTIN'));
    const state = cellValue(at(row, 'State'));

    const raw: Record<string, string> = {};
    for (const header of headers) {
      const value = at(row, header).trim();
      if (value !== '') raw[header] = value;
    }

    const parsed: OrgRepoRow = {
      name,
      name_key: partyNameKey(name),
      ...opt('alias', cellValue(at(row, 'ALIAS'))),
      branch_name: branchName,
      branch_sr_no: branchSrNo,
      ...opt('address1', cellValue(at(row, 'Branch AD1'))),
      ...opt('address2', cellValue(at(row, 'Branch AD2'))),
      ...opt('address3', cellValue(at(row, 'Branch AD3'))),
      ...opt('city', cellValue(at(row, 'City'))),
      ...opt('state', state?.toUpperCase()),
      ...opt('postal_code', cellValue(at(row, 'Postal Code'))),
      ...opt('country', country),
      ...opt('country_code', countryCode),
      ...opt('email', cellValue(at(row, 'Email Address'))),
      ...opt('telephone', cellValue(at(row, 'Telephone No'))),
      ...opt('web_url', cellValue(at(row, 'Web URL'))),
      ...opt('ad_code', cellValue(at(row, 'AD Code'))),
      ...opt('gstin', gstin),
      // The repository has no GST state column; by construction the code is
      // the first two digits of the GSTIN.
      ...opt('gst_state_code', gstin?.slice(0, 2)),
      ...opt('iec', cellValue(at(row, 'IE CODE NO'))),
      ...opt('pan', cellValue(at(row, 'PAN NO'))),
      ...opt('cin', cellValue(at(row, 'CIN NO'))),
      ...opt('bin', cellValue(at(row, 'BIN NO'))),
      ...opt('lut_number', cellValue(at(row, 'LUT Number'))),
      ...opt('st_reg_no', cellValue(at(row, 'ST REG NO'))),
      is_shipper: flag(at(row, 'Is Shipper')),
      is_consignee: flag(at(row, 'Is Consignee')),
      is_agent: flag(at(row, 'Is Agent')),
      is_transporter: flag(at(row, 'Is Transporter')),
      is_service_provider: flag(at(row, 'Is ServiceProvider')),
      // A row present in the file but switched off in Logi-Sys stays off here.
      is_active: flag(at(row, 'Is Active')),
      ...opt('source_created_on', cellValue(at(row, 'Created On'))),
      ...opt('source_created_by', cellValue(at(row, 'Created By'))),
      raw,
    };

    // The repository holds a handful of near-duplicates that differ only by a
    // stray quote or a doubled space, so cleaning the name makes them collide.
    // They are merged rather than dropped: the role flags differ between the
    // two rows, and losing an Is Consignee would stop the party resolving.
    const existing = byKey.get(key);
    if (existing) merged++;
    byKey.set(key, existing ? mergeDuplicate(existing, parsed) : parsed);
  }

  const rows = [...byKey.values()];

  if (rows.length === 0) {
    errors.push('The workbook has a header row but no organizations under it.');
  }
  if (blankNames > 0) {
    warnings.push(`${blankNames} row(s) had no organization name and were skipped.`);
  }
  if (merged > 0) {
    warnings.push(
      `${merged} row(s) repeated a name, branch and branch serial already in the file and were merged into it.`,
    );
  }
  if (unmappedCountries.size > 0) {
    warnings.push(
      `No ISO country code for: ${[...unmappedCountries].sort().join(', ')}. ` +
        'Those parties import without a country code; add the spelling to packages/core/src/masters/codes.ts.',
    );
  }

  return { rows, warnings, errors };
}

/**
 * Fold a duplicate row into the one already kept: every role either row
 * claims, and the first non-empty value for everything else.
 */
function mergeDuplicate(kept: OrgRepoRow, extra: OrgRepoRow): OrgRepoRow {
  const out = { ...extra, ...kept } as Record<string, unknown>;
  for (const [field, value] of Object.entries(extra)) {
    if (typeof value === 'boolean') {
      out[field] = Boolean(kept[field as keyof OrgRepoRow]) || value;
    } else if (out[field] === undefined) {
      out[field] = value;
    }
  }
  out['raw'] = { ...extra.raw, ...kept.raw };
  return out as unknown as OrgRepoRow;
}
