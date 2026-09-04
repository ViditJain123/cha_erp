import type { ChecklistDraft } from '@checklist/extraction';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * Drafts saved before the ITEMS columns were filled must still export correctly.
 *
 * `GET /api/jobs/[id]/export` reads the stored `job_drafts.draft` jsonb and
 * hands it straight to `buildLogisysWorkbook` — it never re-merges and never
 * re-enriches. So every draft already in the database carries none of the
 * fields the merge now sets, and if the exporter only passed them through, the
 * eight columns would still be blank for every job filed to date.
 *
 * This starts from the golden draft with all of them deleted — which is exactly
 * the shape a stored draft has — and asserts the export is unchanged. It is the
 * only test that covers the fallbacks in `map/items.ts`.
 */
/** A draft as it sits in `job_drafts`: none of the fields the merge now sets. */
function asStored(draft: ChecklistDraft): ChecklistDraft {
  return {
    ...draft,
    items: draft.items.map((item) => {
      const stripped = { ...item };
      delete stripped.generalDescription;
      delete stripped.brand;
      delete stripped.model;
      delete stripped.igstNotification;
      delete stripped.compCessNotification;
      delete stripped.notificationSerials;
      return stripped;
    }),
  };
}

describe('a draft saved before these columns were filled', () => {
  let workbook: Buffer;

  beforeAll(async () => {
    ({ buffer: workbook } = await buildLogisysWorkbook({
      draft: asStored(EP061126_1_DRAFT),
      job: EP061126_1_JOB,
    }));
  });

  it('still writes NOEXCISE, UNBRANDED and NA', async () => {
    const [row] = await readSheet(workbook, 'ITEMS');
    expect(row!['CETH']).toBe('NOEXCISE');
    expect(row!['Brand']).toBe('UNBRANDED');
    expect(row!['Model']).toBe('NA');
  });

  it('re-derives the general description from the invoice line', async () => {
    // Without the model step there is nothing to turn GRANULES into PELLET, so
    // the deterministic seed stands. It is still a legal declaration, which is
    // the point: the column is never blank.
    const [row] = await readSheet(workbook, 'ITEMS');
    expect(row!['General_Description']).toBe('PP GRANULES (POLYPROPYLENE)');
  });

  it('re-derives both notifications and both serials from the CTH', async () => {
    const [row] = await readSheet(workbook, 'ITEMS');
    expect(row!['CTH']).toBe('39021000');
    expect(row!['IGST_LevyNotn']).toBe('009/2025');
    expect(row!['IGST_LevyNotnSrNo']).toBe('II114');
    expect(row!['IGST_CompCessNotn']).toBe('001/2017');
    expect(row!['IGST_CompCessNotnSrNo']).toBe('56');
  });

  it('does not invent a serial for a notification it did not derive', async () => {
    // A draft that names some other IGST notification must not collect
    // 9/2025's serial beside it.
    const other: ChecklistDraft = {
      ...EP061126_1_DRAFT,
      items: EP061126_1_DRAFT.items.map((item) => ({
        ...item,
        igstNotification: '050/2017',
        notificationSerials: {},
      })),
    };
    const { buffer } = await buildLogisysWorkbook({ draft: other, job: EP061126_1_JOB });
    const [row] = await readSheet(buffer, 'ITEMS');
    expect(row!['IGST_LevyNotn']).toBe('050/2017');
    expect(row!['IGST_LevyNotnSrNo']).toBeUndefined();
  });

  it('leaves the four flag columns blank', async () => {
    // Logi-Sys' own export writes '+', 'C', '+' and 'G' here. We have one
    // sample and an ICEGATE spec (BE message format 2.25 p.34) whose code list
    // for the same concepts is 'I' and 'P' — not enough agreement to declare
    // a value on a Bill of Entry.
    const [row] = await readSheet(workbook, 'ITEMS');
    expect(row!['IGST_LevyNotnFlag']).toBeUndefined();
    expect(row!['IGST_ExemptionNotnType']).toBeUndefined();
    expect(row!['IGST_CompCessNotnFlag']).toBeUndefined();
    expect(row!['IGST_CompCessExemptionNotnType']).toBeUndefined();
  });
});

/**
 * The second reference job: the sheet Kuberr's import-documentation desk
 * hand-filled on 1 September 2026 (`logisys-e4a144cd-…-20260828.xlsx`), a
 * different CTH and a description that carries a grade code.
 *
 * Every value below is transcribed from that file, and none of them is in a
 * fixture — they are derived from the CTH and the invoice line alone. It is the
 * proof that the masters answer for a job they were not built against.
 */
describe('reference sheet e4a144cd: random polypropylene, CTH 39023000', () => {
  let workbook: Buffer;

  beforeAll(async () => {
    const base = asStored(EP061126_1_DRAFT);
    const draft: ChecklistDraft = {
      ...base,
      items: [
        {
          ...base.items[0]!,
          description: 'Random Polypropylene RP2248N',
          ritc: '39023000',
          quantity: 99000,
          unit: 'KGS',
          unitPrice: 1.24,
          amount: 122760,
        },
      ],
    };
    ({ buffer: workbook } = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB }));
  });

  it('reproduces all eight columns the desk filled by hand', async () => {
    const [row] = await readSheet(workbook, 'ITEMS');
    expect(row!['CETH']).toBe('NOEXCISE');
    // The grade code comes off; the goods stay.
    expect(row!['Product_Description']).toBe('Random Polypropylene RP2248N');
    expect(row!['General_Description']).toBe('Random Polypropylene');
    expect(row!['Brand']).toBe('UNBRANDED');
    expect(row!['Model']).toBe('NA');
    // 3902 falls in Schedule II S.No. 114, "all goods i.e. polymers … in
    // primary forms"; nothing in 1/2017 names it, so S.No. 56 at nil.
    expect(row!['IGST_LevyNotn']).toBe('009/2025');
    expect(row!['IGST_LevyNotnSrNo']).toBe('II114');
    expect(row!['IGST_CompCessNotn']).toBe('001/2017');
    expect(row!['IGST_CompCessNotnSrNo']).toBe('56');
  });
});
