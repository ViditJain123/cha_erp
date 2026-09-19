import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, ItemReImport } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { openWorkbook, readSheet } from './read.js';

/**
 * RE-IMPORT — the shipping bill goods went out under, and the notification
 * entry claimed on the way back.
 *
 * Unlike SEC65_EXBOND_INFO, this sheet has a vendor example. `ex_job29`
 * (`JobData_I-14385_26-27_20260907_165024.xlsx`) is Logi-Sys' own export for
 * job I-14385, and its single RE-IMPORT row is the only populated one in the
 * repo. `ex_job29` describes it below, and the first test asserts our row cell
 * for cell against it. Everything else is built by departing from that row.
 *
 * The blocker tests each name the ICES filing error they guard, from
 * `data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf`.
 */

/** The re-import block that reproduces `ex_job29`'s vendor row. */
const EX_JOB29: ItemReImport = {
  sbNo: { value: '3250689', source: 'document' },
  sbDate: { value: '2025-07-03', source: 'document' },
  portOfExport: { value: 'INNSA1', source: 'document' },
  sbInvSrNo: { value: 1, source: 'document' },
  sbItemSrNo: { value: 1, source: 'document' },
  notification: { value: { notification: '045/2017', serial: '1E' }, source: 'operator' },
};

/**
 * The golden draft with a re-import block on its one line.
 *
 * `EP061126_1_DRAFT` claims Japan CEPA in `Basic_Notn`, which a re-import may
 * not do — the relief comes from this sheet alone — so the claim comes off with
 * the line. That is not test scaffolding: it is the rule, and the last test
 * here asserts the export refuses when it is left on.
 */
function reImport(
  block: Partial<ItemReImport> = {},
  omit: (keyof ItemReImport)[] = [],
  draftPatch: Partial<ChecklistDraft> = {},
): ChecklistDraft {
  const base = EP061126_1_DRAFT.items[0]!;
  const { fta: _fta, bcdExemption: _bcd, bcdNotification: _notn, ...item } = base;
  const re: ItemReImport = { ...EX_JOB29, ...block };
  for (const key of omit) delete re[key];
  return {
    ...EP061126_1_DRAFT,
    // The filing date the time limits are measured against.
    shipment: { ...EP061126_1_DRAFT.shipment, beFilingDate: '2026-09-07' },
    items: [{ ...item, reImport: re }],
    ...draftPatch,
  };
}

const build = (draft: ChecklistDraft) =>
  buildLogisysWorkbook({ draft, job: EP061126_1_JOB });

const rowOf = async (draft: ChecklistDraft) => {
  const { buffer } = await build(draft);
  return (await readSheet(buffer, 'RE-IMPORT'))[0];
};

describe('RE-IMPORT', () => {
  it('leaves the sheet exactly as the vendor shipped it for an ordinary import', async () => {
    const { buffer } = await build(EP061126_1_DRAFT);
    const sheet = (await openWorkbook(buffer)).getWorksheet('RE-IMPORT')!;
    // A mapper that returned a row of blanks would show up here as rowCount 2,
    // and would tell Logi-Sys these goods had been exported and come back.
    expect(sheet.rowCount).toBe(1);
  });

  it("reproduces ex_job29's vendor row cell for cell", async () => {
    expect(await rowOf(reImport())).toEqual({
      Inv_SrNo: '1',
      Item_SrNo: '1',
      SB_No: '3250689',
      SB_Date: '03-Jul-2025',
      // The ICES code, not "Nhava Sheva Sea" as the checklist prints it.
      Port_of_Export: 'INNSA1',
      SB_Inv_SrNo: '1',
      SB_Item_SrNo: '1',
      Notn_No: '045/2017',
      // Sl. No. 1 clause (e). Alphanumeric, so never an integer.
      Notn_SrNo: '1E',
      // Zero, not blank: the vendor writes 0.00 in all six money columns.
      'Exp._Freight': '0.00',
      'Exp.Insurance': '0.00',
      'Cus.Duty': '0.00',
      Excise_Duty: '0.00',
      IGSTPaid: '0.00',
      // File_No is absent: it is in no ICES message, and Logi-Sys' own export
      // leaves it empty on a live re-import.
    });
  });

  it('writes one row per re-imported line, and none for the rest', async () => {
    const base = EP061126_1_DRAFT.items[0]!;
    const { fta: _f, bcdExemption: _b, bcdNotification: _n, ...plain } = base;
    const draft: ChecklistDraft = {
      ...EP061126_1_DRAFT,
      shipment: { ...EP061126_1_DRAFT.shipment, beFilingDate: '2026-09-07' },
      items: [
        { ...plain, slNo: 1, reImport: EX_JOB29 },
        { ...plain, slNo: 2 },
        {
          ...plain,
          slNo: 3,
          reImport: {
            ...EX_JOB29,
            sbNo: { value: '1916896', source: 'document' },
            sbDate: { value: '2025-05-17', source: 'document' },
            notification: { value: { notification: '045/2017', serial: '5' }, source: 'operator' },
          },
        },
      ],
    };
    const { buffer } = await build(draft);
    const rows = await readSheet(buffer, 'RE-IMPORT');
    // ex_job4's shape: two lines of one invoice, two shipping bills, two
    // different entries. The serial is decided per line, not per job.
    expect(rows.map((r) => [r.Item_SrNo, r.SB_No, r.Notn_SrNo])).toEqual([
      ['1', '3250689', '1E'],
      ['3', '1916896', '5'],
    ]);
  });

  describe('refusing to misdeclare', () => {
    it('blocks with no shipping bill number (ICES 375)', async () => {
      await expect(build(reImport({}, ['sbNo']))).rejects.toThrow(/SB_No/);
    });

    it('blocks when the shipping bill number is not seven digits (ICES 375)', async () => {
      await expect(
        build(reImport({ sbNo: { value: 'INNSA1', source: 'document' } })),
      ).rejects.toThrow(/not the seven digits/);
    });

    it('blocks with no shipping bill date (ICES 376)', async () => {
      await expect(build(reImport({}, ['sbDate']))).rejects.toThrow(/SB_Date/);
    });

    it('blocks when the shipping bill postdates the Bill of Entry', async () => {
      await expect(
        build(reImport({ sbDate: { value: '2027-01-01', source: 'document' } })),
      ).rejects.toThrow(/cannot come back before they left/);
    });

    it('blocks with no port of export (ICES 379)', async () => {
      await expect(build(reImport({}, ['portOfExport']))).rejects.toThrow(/Port_of_Export/);
    });

    it('blocks when the port is a name rather than an ICES code (ICES 379)', async () => {
      await expect(
        build(reImport({ portOfExport: { value: 'Nhava Sheva Sea', source: 'document' } })),
      ).rejects.toThrow(/not a customs station/);
    });

    it("blocks with no invoice serial within the shipping bill (ICES 377)", async () => {
      await expect(build(reImport({}, ['sbInvSrNo']))).rejects.toThrow(/SB_Inv_SrNo/);
    });

    it('blocks with no item serial within the shipping bill (ICES 378)', async () => {
      await expect(build(reImport({}, ['sbItemSrNo']))).rejects.toThrow(/SB_Item_SrNo/);
    });

    it('blocks until a person confirms the notification entry, listing the candidates', async () => {
      const draft = reImport(
        {
          candidates: [
            {
              notification: '045/2017',
              serial: '1A',
              description: 'Goods exported under claim for drawback',
              amountPayable: 'Amount of drawback allowed at the time of export',
              because: 'The shipping bill claims drawback (DBK).',
              cautions: [],
              needsExportFreightInsurance: false,
              needsIncentiveRepayment: true,
            },
          ],
        },
        ['notification'],
      );
      await expect(build(draft)).rejects.toThrow(/no re-import notification has been confirmed/);
      await expect(build(draft)).rejects.toThrow(/045\/2017 1A/);
    });

    it('blocks on a notification and serial that are not an entry (ICES 352)', async () => {
      await expect(
        build(
          reImport({
            notification: { value: { notification: '045/2017', serial: '9Z' }, source: 'operator' },
          }),
        ),
      ).rejects.toThrow(/not an entry of any re-import notification/);
    });

    it('blocks on an unconfirmed proposal, however plausible', async () => {
      await expect(
        build(
          reImport({
            notification: { value: { notification: '045/2017', serial: '1E' }, source: 'default' },
          }),
        ),
      ).rejects.toThrow(/a proposal nobody has confirmed/);
    });

    it('blocks when Sl. 2 is claimed with no export freight or insurance (ICES 355)', async () => {
      await expect(
        build(
          reImport({
            notification: { value: { notification: '045/2017', serial: '2' }, source: 'operator' },
          }),
        ),
      ).rejects.toThrow(/insurance and freight \*\*both ways\*\*/);
    });

    it('blocks when export freight is filed against an entry that forbids it (ICES 353)', async () => {
      await expect(
        build(reImport({ exportFreightInr: { value: 96000, source: 'document' } })),
      ).rejects.toThrow(/requires the export freight and insurance to be nil/);
    });

    it('blocks when a drawback entry repays nothing (ICES 354)', async () => {
      await expect(
        build(
          reImport({
            notification: { value: { notification: '045/2017', serial: '1A' }, source: 'operator' },
          }),
        ),
      ).rejects.toThrow(/Nothing is stated/);
    });

    it('blocks when a Nil entry repays an incentive anyway (ICES 356)', async () => {
      await expect(
        build(
          reImport({
            notification: { value: { notification: '045/2017', serial: '5' }, source: 'operator' },
            customsDuty: { value: 45000, source: 'mail' },
          }),
        ),
      ).rejects.toThrow(/repays no export incentive/);
    });

    it('blocks when the line also claims a basic-duty notification (ICES 388)', async () => {
      const draft = reImport();
      draft.items[0]!.bcdNotification = '045/2025';
      await expect(build(draft)).rejects.toThrow(/declaring the relief twice/);
    });

    it('blocks a 45/2017 claim against a pre-GST shipping bill', async () => {
      await expect(
        build(
          reImport({
            sbNo: { value: '1234567', source: 'document' },
            sbDate: { value: '2016-03-04', source: 'document' },
          }),
        ),
      ).rejects.toThrow(/section 51 was given on or after/);
    });

    it('blocks goods the second proviso excludes', async () => {
      await expect(
        build(reImport({ exclusion: 'These goods were exported out of a warehouse.' })),
      ).rejects.toThrow(/exported out of a warehouse/);
    });
  });

  describe('telling the operator without refusing', () => {
    it('warns when the goods came back past the entry’s time limit', async () => {
      // ex_job29 exactly: a 1E claim on goods that left 14 months earlier,
      // which is why that folder holds a shipping bill extension letter.
      const { warnings } = await build(reImport());
      expect(warnings.some((w) => /14 months after export/.test(w))).toBe(true);
      expect(warnings.some((w) => /extension letter/.test(w))).toBe(true);
    });

    it('does not warn about time when the goods came back inside the limit', async () => {
      const { warnings } = await build(
        reImport({ sbDate: { value: '2026-03-01', source: 'document' } }),
      );
      expect(warnings.some((w) => /after export/.test(w))).toBe(false);
    });

    it('warns that a 158/95 re-import runs against a bond', async () => {
      const { warnings } = await build(
        reImport({
          notification: { value: { notification: '158/1995', serial: '1' }, source: 'operator' },
        }),
      );
      expect(warnings.some((w) => /BONDS_CERTIFICATES/.test(w))).toBe(true);
    });

    it('warns that a pre-2000 notification’s spelling is unverified', async () => {
      const { warnings } = await build(
        reImport({
          notification: { value: { notification: '158/1995', serial: '1' }, source: 'operator' },
        }),
      );
      expect(warnings.some((w) => /158\/95/.test(w))).toBe(true);
    });
  });

  it('accepts a repair-and-return with the export leg’s freight and insurance', async () => {
    const row = await rowOf(
      reImport({
        notification: { value: { notification: '045/2017', serial: '2' }, source: 'operator' },
        exportFreightInr: { value: 96000, source: 'document' },
        exportInsuranceInr: { value: 1405.5, source: 'document' },
      }),
    );
    // Rupees, two decimals, apportioned to the line — the BE annexure calls
    // them "Payment made for export on Pro-rata basis (in Rs.)".
    expect(row).toMatchObject({
      Notn_SrNo: '2',
      'Exp._Freight': '96000.00',
      'Exp.Insurance': '1405.50',
      'Cus.Duty': '0.00',
    });
  });

  it('accepts a drawback return with the incentive repaid', async () => {
    const row = await rowOf(
      reImport({
        notification: { value: { notification: '045/2017', serial: '1A' }, source: 'operator' },
        customsDuty: { value: 45280.75, source: 'document' },
      }),
    );
    expect(row).toMatchObject({
      Notn_SrNo: '1A',
      'Cus.Duty': '45280.75',
      'Exp._Freight': '0.00',
      IGSTPaid: '0.00',
    });
  });
});
