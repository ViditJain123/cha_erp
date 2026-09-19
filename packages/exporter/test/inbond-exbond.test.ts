import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { openWorkbook, readSheet } from './read.js';

/**
 * INBOND_EXBOND — the sheet a warehousing or ex-bond Bill of Entry needs.
 *
 * The golden job is a home-consumption filing, so it proves the important
 * negative: this sheet stays exactly as the vendor shipped it for the BE type
 * that has no warehouse. Everything else here is the positive case, built by
 * changing the golden draft's BE type and giving it a warehouse.
 */

const WAREHOUSE = {
  // The worked example in ICEGATE's own Public Enquiries manual: a public
  // warehouse (U, s.57) under Chennai Sea (MAA1 -> INMAA1), serial 001.
  code: 'MAA1U001',
  name: 'M/S APM TERMINAL(I) PVT. LTD',
  address1: 'NO.78, ANNAUPPAMPARTTU VILLAGE',
  address2: 'PONNERI TALUK',
  city: 'CHENNAI',
  pin: '601206',
  country: 'IN',
};

type Block = NonNullable<ChecklistDraft['inbondExbond']>;

/**
 * Keys to leave off entirely, rather than set to undefined.
 *
 * `exactOptionalPropertyTypes` treats "absent" and "present but undefined" as
 * different, and the draft type means it: `release` absent is an ex-bond BE
 * nobody has sized yet.
 */
function bonded(
  beType: 'Warehousing' | 'Ex-Bond',
  block: Partial<Block> = {},
  omit: (keyof Block)[] = [],
): ChecklistDraft {
  const draft: ChecklistDraft = {
    ...EP061126_1_DRAFT,
    beType,
    boe: { ...EP061126_1_DRAFT.boe!, beType: { value: beType, source: 'mail' } },
    inbondExbond: {
      warehouse: { value: WAREHOUSE, source: 'master' },
      inBondBeNo: beType === 'Ex-Bond' ? { value: '1234567', source: 'operator' } : undefined,
      inBondBeDate:
        beType === 'Ex-Bond' ? { value: '2026-07-01', source: 'operator' } : undefined,
      bondNo: { value: 'B/2026/114', source: 'operator' },
      bondDate: { value: '2026-07-01', source: 'operator' },
      bondExpiryDate: { value: '2027-06-30', source: 'operator' },
      ...(beType === 'Ex-Bond'
        ? {
            release: {
              value: { packages: 2, packageCode: 'BGS', grossWeightKg: 51, unit: 'KGS' },
              source: 'operator' as const,
            },
          }
        : {}),
      ...block,
    },
  };
  for (const key of omit) delete draft.inbondExbond?.[key];
  return draft;
}

const build = (draft: ChecklistDraft) => buildLogisysWorkbook({ draft, job: EP061126_1_JOB });

describe('a home-consumption BE', () => {
  it('leaves INBOND_EXBOND exactly as the vendor shipped it', async () => {
    // Row 1 is the header. A mapper that returned a row of blanks would show up
    // here as rowCount 2, and would tell Logi-Sys this BE concerns a warehouse.
    const { buffer } = await build(EP061126_1_DRAFT);
    const wb = await openWorkbook(buffer);
    expect(wb.getWorksheet('INBOND_EXBOND')!.rowCount).toBe(1);
  });
});

describe('a warehousing (W) BE', () => {
  it('writes the warehouse, and no into-bond BE', async () => {
    const { buffer } = await build(bonded('Warehousing'));
    const [row] = await readSheet(buffer, 'INBOND_EXBOND');

    expect(row!['WH_Code']).toBe('MAA1U001');
    expect(row!['WH_Name']).toBe('M/S APM TERMINAL(I) PVT. LTD');
    expect(row!['WH_City']).toBe('CHENNAI');
    expect(row!['WH_Country']).toBe('IN');
    // A W BE *creates* the warehouse ledger; it draws against nothing.
    expect(row!['InBond_BENo'] ?? '').toBe('');
    expect(row!['InBond_BEDate'] ?? '').toBe('');
  });

  it('keeps a PIN with a leading zero a string', async () => {
    const { buffer } = await build(
      bonded('Warehousing', {
        warehouse: { value: { ...WAREHOUSE, pin: '029001' }, source: 'master' },
      }),
    );
    const [row] = await readSheet(buffer, 'INBOND_EXBOND');
    expect(row!['WH_PIN']).toBe('029001');
    expect(typeof row!['WH_PIN']).toBe('string');
  });

  it('writes the bond block', async () => {
    const { buffer } = await build(bonded('Warehousing'));
    const [row] = await readSheet(buffer, 'INBOND_EXBOND');
    expect(row!['Bond_No']).toBe('B/2026/114');
    expect(row!['Bond_Date']).toBeTruthy();
    expect(row!['Bond_ExpiryDate']).toBeTruthy();
  });
});

describe('an ex-bond (EX) BE', () => {
  it('names the into-bond BE it draws against', async () => {
    const { buffer } = await build(bonded('Ex-Bond'));
    const [row] = await readSheet(buffer, 'INBOND_EXBOND');
    expect(row!['InBond_BENo']).toBe('1234567');
    expect(row!['InBond_BEDate']).toBeTruthy();
  });

  it('states the released packages and weight on SHIPMENT, not the whole consignment', async () => {
    // The point of an ex-bond BE: 2 bags of the warehoused goods are leaving,
    // not the six containers that arrived. ICES asks for exactly this (BE
    // Message format 2.25, fields 35 and 37) and the template has no column for
    // it on INBOND_EXBOND, so it lands here.
    const { buffer } = await build(bonded('Ex-Bond'));
    const [row] = await readSheet(buffer, 'SHIPMENT');
    expect(row!['No_of_Pkg']).toBe('2.000');
    expect(row!['GrWt']).toBe('51.000');
  });

  it('refuses to file without the into-bond BE', async () => {
    await expect(build(bonded('Ex-Bond', {}, ['inBondBeNo']))).rejects.toThrow(/InBond_BENo/);
  });

  it('refuses to file without saying how much it releases', async () => {
    await expect(build(bonded('Ex-Bond', {}, ['release']))).rejects.toThrow(
      /does not say how much it releases/,
    );
  });
});

describe('the warehouse code', () => {
  it('refuses one that is not a warehouse code', async () => {
    await expect(
      build(
        bonded('Warehousing', {
          warehouse: { value: { code: 'ZZZZ9999', country: 'IN' }, source: 'operator' },
        }),
      ),
    ).rejects.toThrow(/not an ICES port code/);
  });

  it('refuses one of the wrong length', async () => {
    await expect(
      build(
        bonded('Warehousing', {
          warehouse: { value: { code: 'MAA1U01', country: 'IN' }, source: 'operator' },
        }),
      ),
    ).rejects.toThrow(/8 characters/);
  });

  it('warns when the warehouse is licensed under a different station than the BE is filed at', async () => {
    // The golden job files at Nhava Sheva; this warehouse is Chennai's. Legal
    // for a bond-to-bond movement, a typo otherwise.
    const { warnings } = await build(bonded('Warehousing'));
    expect(warnings.some((w) => w.includes('licensed under'))).toBe(true);
  });

  it('warns when only the code is known, without blocking', async () => {
    const { buffer, warnings } = await build(
      bonded('Warehousing', {
        warehouse: { value: { code: 'MAA1U001', country: 'IN' }, source: 'operator' },
      }),
    );
    const [row] = await readSheet(buffer, 'INBOND_EXBOND');
    expect(row!['WH_Code']).toBe('MAA1U001');
    expect(row!['WH_Name'] ?? '').toBe('');
    expect(warnings.some((w) => w.startsWith('INBOND_EXBOND.WH_Name'))).toBe(true);
  });
});

describe('the two flag columns', () => {
  it('writes Y when ticked and nothing when not', async () => {
    const { buffer } = await build(
      bonded('Warehousing', { isWarehouseSale: true, isSec65ManufacturingWh: false }),
    );
    const [row] = await readSheet(buffer, 'INBOND_EXBOND');
    expect(row!['IsWareHouseSale']).toBe('Y');
    // False and unknown are the same empty cell — never 'N'.
    expect(row!['IsSEC65ManufacturingWH'] ?? '').toBe('');
  });

  it('asks what a Section 65 ex-bond filing clears, when nobody has said', async () => {
    const { warnings } = await build(bonded('Ex-Bond', { isSec65ManufacturingWh: true }));
    expect(
      warnings.some(
        (w) =>
          w.startsWith('INBOND_EXBOND.IsSEC65ManufacturingWH') && w.includes('does not say what it'),
      ),
    ).toBe(true);
  });

  it('flags section 61 interest on an as-such clearance out of a Section 65 warehouse', async () => {
    const { warnings } = await build(
      bonded('Ex-Bond', { isSec65ManufacturingWh: true, clearanceKind: 'as_such' }),
    );
    expect(warnings.some((w) => w.includes('section 61'))).toBe(true);
  });

  // An into-bond BE deposits goods; nothing is being cleared out of the
  // warehouse yet, so Section 65 has nothing to say on it.
  it('says nothing about Section 65 on an into-bond BE', async () => {
    const { warnings } = await build(bonded('Warehousing', { isSec65ManufacturingWh: true }));
    expect(warnings.some((w) => w.includes('SEC65'))).toBe(false);
  });
});
