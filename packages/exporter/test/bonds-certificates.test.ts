import { describe, expect, it } from 'vitest';
import type { BondOrCertificate, ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * BONDS_CERTIFICATES — the security already lodged with Customs.
 *
 * Unlike most of the Single Window sheets this one has real vendor rows to
 * check against, so the assertions below reproduce them exactly:
 *
 *   ex_job25/JobData_I-30288_26-27_20260907_164002.xlsx
 *     B | DE | 2002542921 | – | – | – | – | INHZA1
 *   ex_job26/JobData_I-60133_26-27_20260907_164152.xlsx
 *     B | EZ | 2002611612 | – | – | – | – | INHZA1
 *   ex_job31/JobData_I-20271_26-27_20260911_143243.xlsx
 *     C | MS | NOC/2026/000004873..876 | 03-Aug-2026 | – | – | – | –
 *
 * All three are `H` type filings, which is why the golden home-consumption
 * draft is the right base for every case here.
 */

const withBonds = (bonds: BondOrCertificate[]): ChecklistDraft => ({
  ...structuredClone(EP061126_1_DRAFT),
  bonds,
});

const build = (bonds: BondOrCertificate[]) =>
  buildLogisysWorkbook({ draft: withBonds(bonds), job: EP061126_1_JOB });

describe('the sheet a home-consumption job with no security produces', () => {
  it('is header-only', async () => {
    const { buffer } = await buildLogisysWorkbook({
      draft: EP061126_1_DRAFT,
      job: EP061126_1_JOB,
    });
    expect(await readSheet(buffer, 'BONDS_CERTIFICATES')).toHaveLength(0);
  });
});

describe('a bond row, against ex_job25', () => {
  it('writes the vendor row exactly', async () => {
    const { buffer } = await build([
      {
        kind: 'bond',
        type: 'DE',
        number: '2002542921',
        registrationPortCode: 'INHZA1',
      },
    ]);

    const [row] = await readSheet(buffer, 'BONDS_CERTIFICATES');
    expect(row).toMatchObject({
      Bond_or_Certificate: 'B',
      Bond_Cert_Type: 'DE',
      Bond_Cert_No: '2002542921',
      Registration_Port_Code: 'INHZA1',
    });
    // `<TABLE>BOND` has no date field, and no Central Excise jurisdiction
    // applies to a bond. Both vendor bond rows leave all four blank.
    expect(row!['Bond_Cert_Date']).toBeUndefined();
    expect(row!['Commissionerate']).toBeUndefined();
    expect(row!['Division']).toBeUndefined();
    expect(row!['Range']).toBeUndefined();
  });

  it('keeps a bond number that starts with a zero', async () => {
    // N(10) in ICES, a string here: a bond number is an identifier, and as a
    // number 0002542921 becomes 2542921.
    const { buffer } = await build([
      { kind: 'bond', type: 'WH', number: '0002542921', registrationPortCode: 'INNSA1' },
    ]);
    const [row] = await readSheet(buffer, 'BONDS_CERTIFICATES');
    expect(row!['Bond_Cert_No']).toBe('0002542921');
  });

  it('accepts EZ, which ex_job26 filed against an EPCG licence', async () => {
    const { buffer } = await build([
      { kind: 'bond', type: 'EZ', number: '2002611612', registrationPortCode: 'INHZA1' },
    ]);
    const [row] = await readSheet(buffer, 'BONDS_CERTIFICATES');
    expect(row!['Bond_Cert_Type']).toBe('EZ');
  });

  it('warns rather than asserts when the scheme bond code was only proposed', async () => {
    const { warnings } = await build([
      {
        kind: 'bond',
        type: 'EC',
        number: '2002611612',
        registrationPortCode: 'INHZA1',
        proposed: true,
      },
    ]);
    expect(warnings.join('\n')).toMatch(/proposed from the licence/);
  });

  it('warns when the registration port is unknown', async () => {
    const { warnings } = await build([{ kind: 'bond', type: 'WH', number: '2002542921' }]);
    expect(warnings.join('\n')).toMatch(/no registration port/);
  });

  it('refuses a bond code ICES does not have — error 501', async () => {
    await expect(build([{ kind: 'bond', type: 'XX', number: '2002542921' }])).rejects.toThrow(
      /not an ICES bond code/,
    );
  });

  it('refuses the literal EB and says to use the purpose code — error 553', async () => {
    await expect(build([{ kind: 'bond', type: 'EB', number: '2002542921' }])).rejects.toThrow(
      /purpose code/,
    );
  });

  it('accepts an eBond purpose code in the bond-code column', async () => {
    const { buffer } = await build([
      { kind: 'bond', type: 'W1', number: '2002542921', registrationPortCode: 'INNSA1' },
    ]);
    const [row] = await readSheet(buffer, 'BONDS_CERTIFICATES');
    expect(row!['Bond_Cert_Type']).toBe('W1');
  });

  it('refuses a bond with no number — error 502', async () => {
    await expect(build([{ kind: 'bond', type: 'WH', number: '' }])).rejects.toThrow(/no.*number/s);
  });
});

describe('a certificate row, against ex_job31', () => {
  it('writes the four NOC rows exactly', async () => {
    const { buffer } = await build(
      ['000004873', '000004874', '000004875', '000004876'].map((n) => ({
        kind: 'certificate' as const,
        type: 'MS',
        number: `NOC/2026/${n}`,
        date: '2026-08-03',
      })),
    );

    const rows = await readSheet(buffer, 'BONDS_CERTIFICATES');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      Bond_or_Certificate: 'C',
      Bond_Cert_Type: 'MS',
      Bond_Cert_No: 'NOC/2026/000004873',
      Bond_Cert_Date: '03-Aug-2026',
    });
    // A certificate has no registration port: `<TABLE>CERT` has no such field.
    expect(rows.every((r) => r['Registration_Port_Code'] === undefined)).toBe(true);
  });

  it('warns when a certificate has no date — error 552', async () => {
    const { warnings } = await build([
      { kind: 'certificate', type: 'MS', number: 'NOC/2026/000004873' },
    ]);
    expect(warnings.join('\n')).toMatch(/has no date/);
  });

  it('does not warn about a missing date on an IGCR IIN, which the spec makes optional', async () => {
    const { warnings } = await build([
      { kind: 'bond', type: 'EI', number: '2002542921', registrationPortCode: 'INNSA1' },
      { kind: 'certificate', type: 'EI', number: 'IIN2026MH000123' },
    ]);
    expect(warnings.join('\n')).not.toMatch(/has no date/);
  });
});

describe('IGCR needs both halves', () => {
  const BOND: BondOrCertificate = {
    kind: 'bond',
    type: 'EI',
    number: '2002542921',
    registrationPortCode: 'INNSA1',
  };
  const IIN: BondOrCertificate = {
    kind: 'certificate',
    type: 'EI',
    number: 'IIN2026MH000123',
  };

  it('files the bond and the IIN as two rows', async () => {
    const { buffer } = await build([BOND, IIN]);
    const rows = await readSheet(buffer, 'BONDS_CERTIFICATES');
    expect(rows.map((r) => [r['Bond_or_Certificate'], r['Bond_Cert_Type'], r['Bond_Cert_No']])).toEqual([
      ['B', 'EI', '2002542921'],
      ['C', 'EI', 'IIN2026MH000123'],
    ]);
  });

  it('refuses an IGCR bond with no IIN — errors 513, 514', async () => {
    await expect(build([BOND])).rejects.toThrow(/no IIN/);
  });

  it('refuses an IIN with no IGCR bond — error 516', async () => {
    await expect(build([IIN])).rejects.toThrow(/no IGCR bond/);
  });

  it('refuses more than one IIN — error 517', async () => {
    await expect(
      build([BOND, IIN, { ...IIN, number: 'IIN2026MH000124' }]),
    ).rejects.toThrow(/exactly one per Bill of Entry/);
  });
});
