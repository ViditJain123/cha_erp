import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, Sec65FinishedGood } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { openWorkbook, readSheet } from './read.js';

/**
 * SEC65_EXBOND_INFO — the finished product cleared out of a Section 65
 * warehouse.
 *
 * The golden job is a home-consumption filing of PP granules, so it proves the
 * negative this sheet mostly lives in: header-only, exactly as the vendor
 * shipped it. The positives are built by making that draft an ex-bond filing
 * out of a section 65 warehouse — the granules become the imported *input*, and
 * the finished product declared against them is a plastic article made from
 * them, which is the whole shape of a MOOWR clearance.
 *
 * No vendor export in the repo has ever populated this sheet, so every
 * assertion here is against `BE Message format 2.25` and the ICES filing error
 * list rather than against an observed row. The error code each test guards is
 * named in its title.
 */

const WAREHOUSE = {
  code: 'MAA1U001',
  name: 'M/S APM TERMINAL(I) PVT. LTD',
  city: 'CHENNAI',
  country: 'IN',
};

const FINISHED: Sec65FinishedGood = {
  gstInvoiceNo: 'GST/26-27/0912',
  gstInvoiceDate: '2026-08-14',
  cth: '39269099',
  description: 'MOULDED POLYPROPYLENE CRATES',
  quantity: 4200,
  uqc: 'NOS',
};

type Block = NonNullable<ChecklistDraft['inbondExbond']>;

/**
 * The golden draft as an ex-bond filing out of a section 65 warehouse.
 *
 * `omit` removes a key entirely rather than setting it to undefined:
 * `exactOptionalPropertyTypes` makes those two different, and the draft type
 * means it — `clearanceKind` absent is a job nobody has answered for.
 */
function sec65(
  block: Partial<Block> = {},
  items = 1,
  omit: (keyof Block)[] = [],
): ChecklistDraft {
  const item = EP061126_1_DRAFT.items[0]!;
  const draft: ChecklistDraft = {
    ...EP061126_1_DRAFT,
    beType: 'Ex-Bond',
    boe: { ...EP061126_1_DRAFT.boe!, beType: { value: 'Ex-Bond', source: 'mail' } },
    items: Array.from({ length: items }, (_, i) => ({ ...item, slNo: i + 1 })),
    inbondExbond: {
      warehouse: { value: WAREHOUSE, source: 'master' },
      inBondBeNo: { value: '1234567', source: 'operator' },
      inBondBeDate: { value: '2026-07-01', source: 'operator' },
      bondNo: { value: 'B/2026/114', source: 'operator' },
      bondDate: { value: '2026-07-01', source: 'operator' },
      bondExpiryDate: { value: '2027-06-30', source: 'operator' },
      release: {
        value: { packages: 2, packageCode: 'BGS', grossWeightKg: 51, unit: 'KGS' },
        source: 'operator' as const,
      },
      isSec65ManufacturingWh: true,
      clearanceKind: 'resultant_product',
      sec65FinishedGoods: { value: [FINISHED], source: 'operator' },
      ...block,
    },
  };
  for (const key of omit) delete draft.inbondExbond?.[key];
  return draft;
}

const build = (draft: ChecklistDraft) => buildLogisysWorkbook({ draft, job: EP061126_1_JOB });

async function rowCount(draft: ChecklistDraft): Promise<number> {
  const { buffer } = await build(draft);
  const wb = await openWorkbook(buffer);
  return wb.getWorksheet('SEC65_EXBOND_INFO')!.rowCount;
}

/** The blocker paths a build refused with, or [] if it did not refuse. */
async function blockers(draft: ChecklistDraft): Promise<string> {
  try {
    await build(draft);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

// ------------------------------------------------ when it does not apply ----

describe('the filings this sheet has nothing to say about', () => {
  // ICES error 868: SEC65 details on a BE that is not a section 65 ex-bond.
  it('leaves the sheet as the vendor shipped it for a home-consumption BE', async () => {
    expect(await rowCount(EP061126_1_DRAFT)).toBe(1);
  });

  it('writes nothing for an ex-bond BE out of an ordinary bonded warehouse', async () => {
    expect(await rowCount(sec65({ isSec65ManufacturingWh: false }, 1, ['clearanceKind']))).toBe(1);
  });

  // Circular 48/2020 para 8.1 — no manufacture, no finished product, and
  // section 61 interest instead.
  it('writes nothing when the section 65 warehouse clears goods as such', async () => {
    expect(await rowCount(sec65({ clearanceKind: 'as_such' }))).toBe(1);
  });

  it('writes nothing when capital goods leave the premises', async () => {
    expect(await rowCount(sec65({ clearanceKind: 'capital_goods' }))).toBe(1);
  });

  it('writes nothing for a job-work return, which is unsettled', async () => {
    expect(await rowCount(sec65({ clearanceKind: 'job_work_return' }))).toBe(1);
  });
});

// ----------------------------------------------------------- the rows ----

describe('a section 65 resultant-product clearance', () => {
  it('declares the finished product against the item it was made from', async () => {
    const { buffer } = await build(sec65());
    const rows = await readSheet(buffer, 'SEC65_EXBOND_INFO');

    expect(rows).toHaveLength(1);
    expect(rows[0]!['Inv_SrNo']).toBe('1');
    expect(rows[0]!['Item_SrNo']).toBe('1');
    expect(rows[0]!['GSTInvoiceNo']).toBe('GST/26-27/0912');
    expect(rows[0]!['GSTInvoiceDate']).toBeTruthy();
    // The finished product's own heading, not the input's 39021000.
    expect(rows[0]!['FinishedProductCTH']).toBe('39269099');
    expect(rows[0]!['FinishedProductDesc']).toBe('MOULDED POLYPROPYLENE CRATES');
    // Control MSR is N(16,6).
    expect(rows[0]!['FinishedProductQty']).toBe('4200.000000');
    expect(rows[0]!['FinishedProductQtyUnit']).toBe('NOS');
  });

  // ICES error 735: every item on the BE needs a control row. The ordinary
  // MOOWR case is one resultant product made from all of them.
  it('repeats the finished product against every item by default', async () => {
    const { buffer } = await build(sec65({}, 3));
    const rows = await readSheet(buffer, 'SEC65_EXBOND_INFO');
    expect(rows.map((r) => r['Item_SrNo'])).toEqual(['1', '2', '3']);
    expect(new Set(rows.map((r) => r['GSTInvoiceNo']))).toEqual(new Set(['GST/26-27/0912']));
  });

  // Logi-Sys numbers ICES's Control Slno from the order rows arrive in, so an
  // item's second GST invoice has to sit immediately after its first.
  it('keeps an item’s several GST invoices contiguous and in order', async () => {
    const second: Sec65FinishedGood = {
      ...FINISHED,
      gstInvoiceNo: 'GST/26-27/0915',
      gstInvoiceDate: '2026-08-20',
      cth: '39231090',
      description: 'POLYPROPYLENE CARBOYS',
      quantity: 180,
      itemSrNos: [2],
    };
    const { buffer } = await build(
      sec65({ sec65FinishedGoods: { value: [FINISHED, second], source: 'operator' } }, 3),
    );
    const rows = await readSheet(buffer, 'SEC65_EXBOND_INFO');

    expect(rows.map((r) => `${r['Item_SrNo']}:${r['GSTInvoiceNo']}`)).toEqual([
      '1:GST/26-27/0912',
      '2:GST/26-27/0912',
      '2:GST/26-27/0915',
      '3:GST/26-27/0912',
    ]);
  });
});

// ----------------------------------------------- what it refuses to file ----

describe('the ICES rejections it refuses rather than discovers', () => {
  it('refuses a clearance with no finished goods at all', async () => {
    const message = await blockers(
      sec65({ sec65FinishedGoods: { value: [], source: 'operator' } }),
    );
    expect(message).toContain('SEC65_EXBOND_INFO');
    expect(message).toContain('finished product');
  });

  it('refuses a resultant-product clearance from a warehouse with no s.65 permission', async () => {
    const message = await blockers(sec65({ isSec65ManufacturingWh: false }));
    expect(message).toContain('section 65 permission');
  });

  // 725 — Control Location is not a column here, but a blank one invalidates
  // every row.
  it('refuses when no warehouse is named', async () => {
    expect(await blockers(sec65({}, 1, ['warehouse']))).toContain('no warehouse code');
  });

  // 728 — Control Result Code is 16 characters, as is a GST invoice serial.
  it('refuses a GST invoice number longer than sixteen characters', async () => {
    const message = await blockers(
      sec65({
        sec65FinishedGoods: {
          value: [{ ...FINISHED, gstInvoiceNo: 'GST/2026-27/000000912' }],
          source: 'operator',
        },
      }),
    );
    expect(message).toContain('sixteen');
  });

  // 730 — the heading inside the control row is validated too.
  it('refuses a finished-product CTH that is not a tariff item', async () => {
    const message = await blockers(
      sec65({
        sec65FinishedGoods: { value: [{ ...FINISHED, cth: '99999999' }], source: 'operator' },
      }),
    );
    expect(message).toContain('99999999');
    expect(message).toContain('first schedule');
  });

  // 731 — Control MSR must be positive.
  it('refuses a zero or negative quantity', async () => {
    const message = await blockers(
      sec65({
        sec65FinishedGoods: { value: [{ ...FINISHED, quantity: 0 }], source: 'operator' },
      }),
    );
    expect(message).toContain('positive number');
  });

  // 732 — and never silently becomes NOS, which normalizeUqc would have done.
  it('refuses a unit that is not an ICES UQC', async () => {
    const message = await blockers(
      sec65({
        sec65FinishedGoods: { value: [{ ...FINISHED, uqc: 'PCS' }], source: 'operator' },
      }),
    );
    expect(message).toContain('not an ICES unit quantity code');
  });

  // 733 — two control rows for one item cannot be the same GST invoice.
  it('refuses the same GST invoice declared twice against one item', async () => {
    const message = await blockers(
      sec65({
        sec65FinishedGoods: {
          value: [FINISHED, { ...FINISHED, description: 'SAME INVOICE AGAIN' }],
          source: 'operator',
        },
      }),
    );
    expect(message).toContain('declared twice');
  });

  // 734 — a control row has to point at an item that exists.
  it('refuses an entry declared against an item that is not on the BE', async () => {
    const message = await blockers(
      sec65({
        sec65FinishedGoods: { value: [{ ...FINISHED, itemSrNos: [7] }], source: 'operator' },
      }),
    );
    expect(message).toContain('not on this Bill of');
  });

  // 735 — an input with no finished product against it.
  it('refuses when an item has no finished product declared against it', async () => {
    const message = await blockers(
      sec65({ sec65FinishedGoods: { value: [{ ...FINISHED, itemSrNos: [1] }], source: 'operator' } }, 2),
    );
    expect(message).toContain('Item 2 has no finished product');
  });
});

// -------------------------------------------------------------- warnings ----

describe('what it warns about rather than refusing', () => {
  it('warns when the GST invoice predates the warehousing of its inputs', async () => {
    const { warnings } = await build(
      sec65({
        sec65FinishedGoods: {
          value: [{ ...FINISHED, gstInvoiceDate: '2026-06-01' }],
          source: 'operator',
        },
      }),
    );
    expect(warnings.some((w) => w.includes('before the goods were warehoused'))).toBe(true);
  });
});
