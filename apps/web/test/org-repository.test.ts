import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOrganizationRepository, type OrgRepoRow } from '../lib/org-repository';

/**
 * Pinned against the real export the customer gave us, because the shape of
 * this file is the whole feature: a header two rows down, `NULL` where a value
 * is missing, and one row per branch rather than one per party.
 *
 * It holds a real party master, so it is not necessarily in the repository.
 * Absent, these assertions are skipped rather than failed — the shape checks
 * below only mean anything against the genuine article.
 */
const FILE = path.join(
  process.cwd(),
  process.cwd().endsWith('apps/web') ? '../..' : '.',
  'OrganizationRepository_78_20260811_194754.xlsx',
);

const present = existsSync(FILE);
const parsed = present
  ? await parseOrganizationRepository(readFileSync(FILE))
  : { rows: [] as OrgRepoRow[], warnings: [] as string[], errors: [] as string[] };

function find(name: string): OrgRepoRow[] {
  return parsed.rows.filter((r) => r.name === name);
}

describe.skipIf(!present)('parseOrganizationRepository', () => {
  it('reads every organization', () => {
    expect(parsed.errors).toEqual([]);
    // 5,094 rows in the file; three pairs differ only by a stray quote or a
    // doubled space in the name and merge into one row each.
    expect(parsed.rows).toHaveLength(5091);
    expect(parsed.warnings).toContain(
      '3 row(s) repeated a name, branch and branch serial already in the file and were merged into it.',
    );
  });

  it('merges a near-duplicate rather than losing its role flags', () => {
    // Logi-Sys holds '"LIZHU MACHINERY CO., LTD.' (shipper only) and
    // 'LIZHU MACHINERY CO., LTD.' (shipper and consignee) as separate rows.
    const [lizhu, ...rest] = find('LIZHU MACHINERY CO., LTD.');
    expect(rest).toHaveLength(0);
    expect(lizhu?.is_shipper).toBe(true);
    expect(lizhu?.is_consignee).toBe(true);
  });

  it('keys on name + branch + branch serial, which is unique', () => {
    const keys = new Set(parsed.rows.map((r) => `${r.name}|${r.branch_name}|${r.branch_sr_no}`));
    expect(keys.size).toBe(parsed.rows.length);
  });

  it('keeps one row per branch of a multi-branch importer', () => {
    const siemens = find('SIEMENS LIMITED');
    expect(siemens).toHaveLength(52);
    expect(siemens.every((r) => r.is_consignee)).toBe(true);
    expect(siemens.map((r) => r.branch_name)).toContain('Bangalore 2');
    // Every branch shares the party's PAN and IEC.
    expect(new Set(siemens.map((r) => r.pan))).toEqual(new Set(['AAACS0764L']));
  });

  it('reads the importer the exported workbook got wrong', () => {
    const [elite, ...rest] = find('ELITE POLYPLUS');
    expect(rest).toHaveLength(0);
    expect(elite).toMatchObject({
      name_key: 'ELITE POLYPLUS',
      branch_name: '0',
      branch_sr_no: '0',
      ad_code: '0410002',
      gstin: '27AAJFE0052B1Z1',
      gst_state_code: '27',
      pan: 'AAJFE0052B',
      city: 'Mumbai',
      state: 'MAHARASHTRA',
      country: 'India',
      country_code: 'IN',
      is_consignee: true,
      is_shipper: false,
      is_active: true,
    });
  });

  it('reads both spellings of the supplier the workbook got wrong', () => {
    const asia = find('ASIA SHIGEN INTERNATIONAL CO., LTD');
    expect(asia).toHaveLength(2);
    expect(asia.every((r) => r.is_shipper)).toBe(true);
    expect(asia.map((r) => r.branch_name).sort()).toEqual(['0', '1']);
    expect(asia[0]?.country_code).toBe('JP');
    // The repository also holds a typo'd near-duplicate. It is a separate
    // party as far as the key is concerned, which is correct: we must not
    // silently merge two rows Logi-Sys keeps apart.
    expect(find('ASIA SHIGEN INTERNAT10NAL CO.,LTD')).toHaveLength(1);
  });

  it('drops the stray quote on the one name that has it', () => {
    expect(parsed.rows.some((r) => r.name.startsWith('"'))).toBe(false);
    expect(find('LIZHU MACHINERY CO., LTD.')).toHaveLength(1);
  });

  it('treats NULL, "." and blanks as absent', () => {
    // 'NULL' is written into PAN on rows that have no PAN.
    expect(parsed.rows.some((r) => r.pan === 'NULL')).toBe(false);
    expect(parsed.rows.some((r) => r.city === '.')).toBe(false);
    // Only real values survive: 1,636 PANs and 1,627 IECs out of 5,094 rows.
    expect(parsed.rows.filter((r) => r.pan).length).toBe(1636);
    expect(parsed.rows.filter((r) => r.iec).length).toBe(1627);
    expect(parsed.rows.filter((r) => r.gstin).length).toBe(1000);
  });

  it('keeps a placeholder branch, because Logi-Sys keys on it', () => {
    expect(parsed.rows.filter((r) => r.branch_name === '0').length).toBeGreaterThan(1000);
    expect(parsed.rows.filter((r) => r.branch_name === 'MAIN').length).toBe(1433);
  });

  it('resolves every country spelling in the file to an ISO code', () => {
    expect(find('ELITE POLYPLUS')[0]?.country_code).toBe('IN');
    expect(find('ASIA SHIGEN INTERNATIONAL CO., LTD')[0]?.country_code).toBe('JP');
    // Including the repository's own typos, which are aliased in codes.ts.
    expect(parsed.rows.filter((r) => r.country && !r.country_code)).toEqual([]);
    expect(parsed.warnings.find((w) => w.startsWith('No ISO country code for:'))).toBeUndefined();
  });

  it('keeps the whole spreadsheet row', () => {
    const elite = find('ELITE POLYPLUS')[0];
    expect(elite?.raw['Organization']).toBe('ELITE POLYPLUS');
    expect(elite?.raw['Taxable Type']).toBe('S');
  });

});

describe('parseOrganizationRepository, without the fixture', () => {
  it('rejects a file that is not an organization repository', async () => {
    const notXlsx = await parseOrganizationRepository(Buffer.from('hello'));
    expect(notXlsx.errors).toHaveLength(1);
    expect(notXlsx.rows).toEqual([]);
  });
});
