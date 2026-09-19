import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * SW_ADDL_INFO — the Single Window declaration.
 *
 * ICES `<TABLE>BE_ITEM_SW_INFO_TYPE` (CACHI01 Part 19/24), which prints on the
 * assessed Bill of Entry as Part IV section J. Contract and evidence:
 * docs/boe-mapping/11-sw-addl-info.md.
 *
 * The shapes asserted here are the ones fourteen real filings carry — eight
 * Logi-Sys workbooks and eight ICES-processed Bills of Entry, overlapping on
 * two jobs. The blocker and warning tests each name the ICES filing error they
 * guard, from `BE_fresh_filing_error_codes_24032026.pdf`.
 */

type SwRow = NonNullable<ChecklistDraft['singleWindowInfo']>[number];

function withRows(rows: SwRow[]): ChecklistDraft {
  return { ...structuredClone(EP061126_1_DRAFT), singleWindowInfo: rows };
}

const SQC = (over: Partial<SwRow> = {}): SwRow => ({
  invoiceSrNo: 1,
  itemSlNo: 1,
  infoType: 'Item Characteristics',
  qualifier: 'Standard UQC',
  measurement: 156450,
  unit: 'KGS',
  ...over,
});

async function sheet(draft: ChecklistDraft) {
  const { buffer } = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
  return readSheet(buffer, 'SW_ADDL_INFO');
}

describe('SW_ADDL_INFO', () => {
  /**
   * The golden's own line: CTH 39021000, chapter 39, so it carries the chemical
   * declaration as well as the standard quantity. This is the shape `ex_job25`,
   * `ex_job28` and `liv_job1` file in their workbooks and `ex_job14` and
   * `ex_job15` file on their assessed Bills of Entry.
   */
  it('writes the four rows a chapter-39 line carries, as codes not labels', async () => {
    const rows = await sheet(structuredClone(EP061126_1_DRAFT));
    expect(
      rows.map((r) => [
        r['Info_Type'],
        r['info_Qualifier'],
        r['Info_Code_Description'],
        r['Information'],
        r['Measure'],
        r['Measure_Unit'],
      ]),
    ).toEqual([
      ['CHR', 'SQC', undefined, undefined, '156450.000000', 'KGS'],
      ['CTG', 'CPC', 'CPCPR', undefined, '0.000000', undefined],
      ['IDT', 'CAS', undefined, '9003-07-0', '0.000000', undefined],
      ['PNM', 'IUP', undefined, 'POLYPROPYLENE', '0.000000', undefined],
    ]);
  });

  /**
   * ICES: "The Value is to be provided in either Code, Text or Msr and not in
   * more than one field" (456 / 458 / 460 / 489). The measure belongs to the
   * standard-quantity row alone; Logi-Sys writes 0.000000 with a blank unit on
   * every other family, and so do we.
   */
  it('keeps the measure on the SQC row and off every other family', async () => {
    const rows = await sheet(
      withRows([
        SQC(),
        {
          invoiceSrNo: 1,
          itemSlNo: 1,
          infoType: 'Item Category',
          qualifier: 'Chemical Category (CPC)',
          code: 'CPCBB',
          // A measurement recorded against a code family: dropped, not written.
          measurement: 99,
          unit: 'KGS',
        },
      ]),
    );
    expect(rows.map((r) => [r['info_Qualifier'], r['Measure'], r['Measure_Unit']])).toEqual([
      ['SQC', '156450.000000', 'KGS'],
      ['CPC', '0.000000', undefined],
    ]);
  });

  it('warns when a measurement is recorded against a code family', async () => {
    const { warnings } = await buildLogisysWorkbook({
      draft: withRows([
        SQC(),
        {
          invoiceSrNo: 1,
          itemSlNo: 1,
          infoType: 'Item Category',
          qualifier: 'Chemical Category (CPC)',
          code: 'CPCBB',
          measurement: 99,
        },
      ]),
      job: EP061126_1_JOB,
    });
    expect(warnings.join('\n')).toMatch(/measurement was recorded against/);
  });

  /**
   * The standard quantity is the one declaration ICES wants on every line of
   * every Bill of Entry, so a row it cannot code is not a gap the operator can
   * fill later — the workbook would be filed short and rejected.
   */
  it('refuses the workbook when the standard-quantity row cannot be coded', async () => {
    await expect(
      buildLogisysWorkbook({
        draft: withRows([SQC({ qualifier: 'Standard UQC', infoType: 'Not A Real Info Type' })]),
        job: EP061126_1_JOB,
      }),
    ).rejects.toThrow(/486|mandatory on every line/);
  });

  /** Every other family is optional to some agency: warn, drop, carry on. */
  it('drops an uncodeable optional row with a warning and still exports', async () => {
    const { warnings, buffer } = await buildLogisysWorkbook({
      draft: withRows([
        SQC(),
        {
          invoiceSrNo: 1,
          itemSlNo: 1,
          infoType: 'Item Category',
          qualifier: 'Some Qualifier No Circular Names',
        },
      ]),
      job: EP061126_1_JOB,
    });
    expect(warnings.join('\n')).toMatch(/no Logi-Sys code for qualifier/);
    expect((await readSheet(buffer, 'SW_ADDL_INFO')).length).toBe(1);
  });

  /**
   * Item serials restart per invoice. `ex_job31` (I-20271) is four invoices of
   * one line each, and its assessed BE carries `1 NOS` against each of the four
   * — so the invoice serial is the line's own, never the literal 1.
   */
  it('files each row against its own invoice serial', async () => {
    const rows = await sheet(
      withRows([1, 2, 3, 4].map((n) => SQC({ invoiceSrNo: n, measurement: 1, unit: 'NOS' }))),
    );
    expect(rows.map((r) => [r['Inv_SrNo'], r['Item_SrNo'], r['Measure'], r['Measure_Unit']])).toEqual(
      [
        ['1', '1', '1.000000', 'NOS'],
        ['2', '1', '1.000000', 'NOS'],
        ['3', '1', '1.000000', 'NOS'],
        ['4', '1', '1.000000', 'NOS'],
      ],
    );
  });

  /**
   * The qualifiers of Circular 55/2020's Annexure A all code now. Before this,
   * only the four the I-10793 export happened to show did, and a Drug Related
   * Category row was silently dropped on its way to a customs declaration.
   */
  it('codes the qualifiers CBIC published in Circular 55/2020', async () => {
    const rows = await sheet(
      withRows([
        SQC(),
        { invoiceSrNo: 1, itemSlNo: 1, infoType: 'Item Category', qualifier: 'Drug Related Category', code: 'MSC' },
        { invoiceSrNo: 1, itemSlNo: 1, infoType: 'Item Characteristics', qualifier: 'Storage Condition' },
        { invoiceSrNo: 1, itemSlNo: 1, infoType: 'Product Name', qualifier: 'Scientific Name', information: 'Sesamum indicum' },
        { invoiceSrNo: 1, itemSlNo: 1, infoType: 'Item Characteristics', qualifier: 'Hazardous', code: 'N' },
      ]),
    );
    expect(rows.map((r) => r['info_Qualifier'])).toEqual(['SQC', 'DRC', 'STC', 'SCI', 'HZRDS']);
  });
});
