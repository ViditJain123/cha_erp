import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, HssParty } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * HSS — the chain of sales afloat.
 *
 * No vendor export in the repo has ever populated this sheet, so every
 * assertion here is against `BE Message format 2.25` p.33 and the ICES filing
 * error list rather than against an observed row. The error code each test
 * guards is named in its title.
 *
 * The rule the whole sheet turns on is the spec's own worked example: the
 * importer filing the Bill of Entry is on GENERAL and **never here**; the party
 * who sold to them is preceding level `0`, that party's seller is `1`.
 */

const SELLER: HssParty = {
  level: 0,
  iec: '0388012345',
  branchSrNo: 1,
  name: 'MIDSEA TRADING PTE LTD',
  branchName: 'HEAD OFFICE',
  address: '8 MARINA VIEW, ASIA SQUARE TOWER 1',
  city: 'SINGAPORE',
  country: 'SG',
  postalCode: '018960',
};

const withChain = (chain: HssParty[], hss = true): ChecklistDraft => {
  const draft = structuredClone(EP061126_1_DRAFT);
  draft.boe = { ...draft.boe!, flags: { ...draft.boe!.flags, hss } };
  draft.hssChain = chain;
  // The three move together: flag, chain, and the loading on INVOICES.
  if (hss) draft.invoices = draft.invoices.map((i) => ({ ...i, hssValue: i.invoiceValue * 1.05 }));
  return draft;
};

const build = (chain: HssParty[], hss = true) =>
  buildLogisysWorkbook({ draft: withChain(chain, hss), job: EP061126_1_JOB });

describe('an ordinary import', () => {
  it('leaves the sheet header-only', async () => {
    const { buffer } = await buildLogisysWorkbook({
      draft: EP061126_1_DRAFT,
      job: EP061126_1_JOB,
    });
    expect(await readSheet(buffer, 'HSS')).toHaveLength(0);
  });
});

describe('one sale afloat', () => {
  it('writes the seller at preceding level 0', async () => {
    const { buffer } = await build([SELLER]);
    const rows = await readSheet(buffer, 'HSS');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Level: '0',
      HSS_Name: 'MIDSEA TRADING PTE LTD',
      HSS_BranchName: 'HEAD OFFICE',
      HSS_BranchSr: '1',
      HSS_IECode: '0388012345',
      HSS_Address: '8 MARINA VIEW, ASIA SQUARE TOWER 1',
      HSS_City: 'SINGAPORE',
      HSS_Country: 'SG',
      HSS_PostalCode: '018960',
    });
  });

  it('keeps the leading zero on the postal code and the IEC', async () => {
    const { buffer } = await build([SELLER]);
    const [row] = await readSheet(buffer, 'HSS');
    expect(row!['HSS_PostalCode']).toBe('018960');
    expect(row!['HSS_IECode']).toBe('0388012345');
  });

  it('leaves the AD code blank rather than proposing one', async () => {
    // It reaches no ICES field, so there is nothing to validate it against and
    // nothing gained by guessing.
    const { buffer } = await build([SELLER]);
    const [row] = await readSheet(buffer, 'HSS');
    expect(row!['HSS_ADCode']).toBeUndefined();
  });
});

describe('a chain of two sales', () => {
  it('orders the rows by preceding level, seller first', async () => {
    const upstream: HssParty = { ...SELLER, level: 1, iec: '0388099999', name: 'PACIFIC RESOURCES SA' };
    const { buffer } = await build([upstream, SELLER]);
    const rows = await readSheet(buffer, 'HSS');
    expect(rows.map((r) => [r['Level'], r['HSS_Name']])).toEqual([
      ['0', 'MIDSEA TRADING PTE LTD'],
      ['1', 'PACIFIC RESOURCES SA'],
    ]);
  });
});

describe('what it refuses', () => {
  it('refuses the flag with no chain — error 116', async () => {
    await expect(build([])).rejects.toThrow(/names no seller/);
  });

  it('refuses a chain that does not start at level 0', async () => {
    await expect(build([{ ...SELLER, level: 1 }])).rejects.toThrow(/starts at level 1, not 0/);
  });

  it('refuses a seller with no IE Code — error 161', async () => {
    await expect(build([{ ...SELLER, iec: '' }])).rejects.toThrow(/no\n?\s*IE Code/s);
  });

  it('refuses an exempted-category IEC without the particulars — error 164', async () => {
    // ICES fills a regular importer's name and address from its own IEC
    // directory. For an exempted-category code it cannot, so they are mandatory.
    await expect(
      build([{ level: 0, iec: '0100000011', branchSrNo: 1, name: 'MINISTRY OF DEFENCE' }]),
    ).rejects.toThrow(/exempted-category code/);
  });

  it('does not require the particulars for an ordinary IEC', async () => {
    const { buffer, warnings } = await build([{ level: 0, iec: '0388012345', branchSrNo: 1 }]);
    expect(await readSheet(buffer, 'HSS')).toHaveLength(1);
    expect(warnings.join('\n')).not.toMatch(/exempted-category/);
  });

  it('warns rather than refuses when the branch serial is unknown — error 163', async () => {
    const { branchSrNo: _omitted, ...noBranch } = SELLER;
    const { buffer, warnings } = await build([noBranch]);
    const [row] = await readSheet(buffer, 'HSS');
    expect(row!['HSS_BranchSr']).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/No branch serial/);
  });
});

describe('sheets and flags that must agree', () => {
  it('warns when a chain is recorded but the job is not flagged', async () => {
    const { buffer, warnings } = await build([SELLER], false);
    expect(await readSheet(buffer, 'HSS')).toHaveLength(0);
    expect(warnings.join('\n')).toMatch(/not flagged as a high seas sale/);
  });

  it('files nothing on an ex-bond Bill of Entry — error 664', async () => {
    const draft = withChain([SELLER]);
    draft.beType = 'Ex-Bond';
    const { warnings } = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB }).catch((e: Error) => {
      // An ex-bond draft built off a home-consumption fixture blocks elsewhere;
      // what matters here is that HSS was not one of the blockers.
      expect(e.message).not.toMatch(/^HSS:/m);
      return { warnings: [] as string[] };
    });
    expect(warnings.join('\n')).not.toMatch(/HSS: The job is flagged/);
  });
});
