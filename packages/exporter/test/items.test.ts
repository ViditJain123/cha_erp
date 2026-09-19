import { describe, expect, it } from 'vitest';
import type { ChecklistDraft, DraftItem } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * ITEMS, rule by rule (`docs/boe-mapping/06-items.md`).
 *
 * The golden test pins ex_job6's row against Logi-Sys' own checklist. These
 * pin the branches no single job exercises — a SAPTA-slot claim, a trade
 * remedy, a tariff value, a flag that changes the duty. Every case builds a
 * real workbook and reads the cells back.
 */

/** ex_job6's draft with its one item patched. */
function withItem(patch: Partial<DraftItem>, draftPatch: Partial<ChecklistDraft> = {}): ChecklistDraft {
  const base = structuredClone(EP061126_1_DRAFT);
  return { ...base, items: [{ ...base.items[0]!, ...patch }], ...draftPatch };
}

/** ex_job6 with its FTA claim removed — a standard-rate line. */
function standard(patch: Partial<DraftItem> = {}): ChecklistDraft {
  const base = structuredClone(EP061126_1_DRAFT);
  const { bcdExemption: _e, ...item } = base.items[0]!;
  const { ftaClaim: _c, ...draft } = base;
  return { ...draft, items: [{ ...item, notificationSerials: { igst: 'II114', compCess: '56', aidc: '19' }, ...patch }] };
}

async function row(draft: ChecklistDraft): Promise<Record<string, unknown>> {
  const { buffer } = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
  const [r] = await readSheet(buffer, 'ITEMS');
  return r!;
}

const build = (draft: ChecklistDraft) => buildLogisysWorkbook({ draft, job: EP061126_1_JOB });

describe('ITEMS §4 classification', () => {
  it('refuses a description the importer has never filed until it is confirmed', async () => {
    await expect(build(withItem({ sources: { ritc: 'document' } }))).rejects.toThrow(/new for this importer/);
  });

  it('files a line the product master or the operator has confirmed', async () => {
    expect((await row(withItem({ sources: { ritc: 'master' } })))['CTH']).toBe('39021000');
    expect((await row(withItem({ sources: { ritc: 'operator' } })))['CTH']).toBe('39021000');
  });

  it('does not block a draft saved before provenance was recorded', async () => {
    expect((await row(withItem({})))['CTH']).toBe('39021000');
  });
});

describe('ITEMS §9 end use', () => {
  it('writes the code the draft carries', async () => {
    expect((await row(withItem({ endUseCode: 'GNX200' })))['End_Use']).toBe('GNX200');
  });

  it('refuses a code that is not in the ICES directory', async () => {
    await expect(build(withItem({ endUseCode: 'GNX999' }))).rejects.toThrow(/not an ICES end-use code/);
  });

  it('leaves it blank and warns when nobody has decided', async () => {
    const { buffer, warnings } = await build(withItem({ endUseCode: '' }));
    const [r] = await readSheet(buffer, 'ITEMS');
    expect(r!['End_Use']).toBeUndefined();
    expect(warnings.some((w) => w.includes('End_Use'))).toBe(true);
  });
});

describe('ITEMS §10 Exim scheme', () => {
  it('writes the scheme and its notification', async () => {
    const r = await row(withItem({ eximScheme: { code: '11', notification: '16/2023', serial: '1', policyPara: '5.01', policyYear: '2023' } }));
    expect(r['Exim_Code']).toBe('11');
    expect(r['Exim_Notn']).toBe('016/2023');
    expect(r['PolicyPara']).toBe('5.01');
  });

  it('refuses a code no directory holds', async () => {
    // `88` is in neither the ICES scheme directory nor Logi-Sys' own output.
    await expect(build(withItem({ eximScheme: { code: '88' } }))).rejects.toThrow(/Exim scheme/);
  });

  it('exports the schemes the scrolled dropdown never showed', async () => {
    // Before the ICES directory was loaded these three refused the *workbook*,
    // not just the cell — so three of the four jobs in the corpus that carry a
    // real licence could not be exported at all.
    //   26 — ex_job28, DFIA           32 — ex_job27, Tariff Rate Quota
    //   RD — ex_job20, RoDTEP scrips
    for (const [code, notification] of [
      ['26', '025/2023'],
      ['32', '022/2022'],
      ['RD', 'RODTEP'],
    ] as const) {
      const r = await row(withItem({ eximScheme: { code, notification, serial: '1' } }));
      expect(r['Exim_Code']).toBe(code);
    }
  });
});

describe('ITEMS §12 accessories', () => {
  it('refuses status 1 without a description', async () => {
    await expect(build(withItem({ accessoryStatus: '1' }))).rejects.toThrow(/not described/);
  });

  it('writes status 1 with its details', async () => {
    const r = await row(withItem({ accessoryStatus: '1', accessoriesDetails: 'Remote control' }));
    expect(r['Accessories_Status']).toBe('1');
    expect(r['Accessories_Details']).toBe('Remote control');
  });
});

describe('ITEMS §14-§17 preferential origin', () => {
  it('files a BASIC-slot agreement in Basic_Notn with P', async () => {
    const r = await row(
      withItem({
        fta: {
          agreement: 'IN-JP-CEPA',
          scheme: 'India-Japan CEPA',
          slot: 'BASIC',
          notification: '069/2011',
          serial: '295',
          cooNumber: '250377141204202410',
          cooDate: '2025-09-09',
          countryOfIssue: 'JP',
          originCriterion: 'CTH',
          directConsignment: true,
          retroactiveIssuance: false,
          itemSrNoInCertificate: '1',
          retroactiveCheck: { compliant: true, reason: 'not retroactive' },
        },
      }),
    );
    expect(r['Standard_Preferential']).toBe('P');
    expect(r['Basic_Notn']).toBe('069/2011');
    expect(r['Basic_NotnSrNo']).toBe('295');
    expect(r['SAPTA_Notn']).toBeUndefined();
    expect(r['COO_ItemSrNoCert']).toBe('1');
    // ICES: transit country is mandatory with an FTA claim; the origin when none is stated.
    expect(r['Transit_Country']).toBe('JP');
  });

  it('files a SAPTA-slot agreement in SAPTA_Notn, standard in Basic (ex_job2, DFTP)', async () => {
    const r = await row(
      standard({
        ritc: '17021110',
        bcdRate: 25,
        originCountry: 'Uganda',
        bcdExemption: { notification: '096/2008', serial: '(i)', percent: 100, scheme: 'DFTP' },
        fta: {
          agreement: 'DFTP',
          scheme: 'DFTP',
          slot: 'SAPTA',
          notification: '096/2008',
          serial: '(i)',
          cooNumber: '05830',
          cooDate: '2026-06-10',
          countryOfIssue: 'UG',
          directConsignment: true,
          retroactiveIssuance: false,
        },
      }),
    );
    expect(r['SAPTA_Notn']).toBe('096/2008');
    expect(r['SAPTA_NotnSrNo']).toBe('(i)');
    expect(r['Basic_Notn']).toBeUndefined();
    expect(r['Standard_Preferential']).toBe('S');
    expect(r['isFTAbenefitClaimed']).toBe('Y');
  });

  it('keeps a general exemption standard (ex_job5, 024/2005)', async () => {
    const r = await row(standard({ bcdNotification: '024/2005', notificationSerials: { basic: '20', igst: 'II504' } }));
    expect(r['Standard_Preferential']).toBe('S');
    expect(r['Basic_Notn']).toBe('024/2005');
    expect(r['Basic_NotnSrNo']).toBe('20');
    expect(r['isFTAbenefitClaimed']).toBe('N');
    expect(r['COO_Retroactive_Issuance']).toBeUndefined();
  });

  it('refuses a retroactive certificate that breaks the agreement’s rule', async () => {
    await expect(
      build(
        withItem({
          fta: {
            agreement: 'IN-JP-CEPA',
            scheme: 'India-Japan CEPA',
            slot: 'BASIC',
            notification: '069/2011',
            serial: '295',
            cooNumber: 'X1',
            retroactiveIssuance: true,
            retroactiveCheck: { compliant: false, reason: 'issued 400 days after shipment; contact the shipper' },
          },
        }),
      ),
    ).rejects.toThrow(/contact the shipper/);
  });
});

describe('ITEMS §18-§19 GST lines and flags', () => {
  it('leaves a Plus flag blank — it does not change an ad valorem duty', async () => {
    const r = await row(standard({ igstLevyFlag: '+', compCessLevyFlag: '+' }));
    expect(r['IGST_LevyNotnFlag']).toBeUndefined();
    expect(r['IGST_CompCessNotnFlag']).toBeUndefined();
  });

  it('writes a flag that does change the duty', async () => {
    const r = await row(standard({ compCessLevyFlag: 'H' }));
    expect(r['IGST_CompCessNotnFlag']).toBe('H');
  });

  it('writes the exemption type only beside an exemption', async () => {
    const without = await row(standard());
    expect(without['IGST_ExemptionNotnType']).toBeUndefined();
    const withEx = await row(standard({ igstExemption: { type: 'C', notification: '45/2025-Customs', serial: '160' } }));
    expect(withEx['IGST_ExemptionNotnType']).toBe('C');
    expect(withEx['IGST_ExemptionNotn']).toBe('045/2025');
    expect(withEx['IGST_ExemptionNotnSrNo']).toBe('160');
  });
});

describe('ITEMS §16 levies', () => {
  it('files the AIDC serial the masters resolved', async () => {
    const r = await row(standard({ aidcLevy: { notification: '011/2021', serial: '17' }, notificationSerials: {} }));
    expect(r['AIDC_LevyNotn']).toBe('011/2021');
    expect(r['AIDC_LevyNotnSrNo']).toBe('17');
  });

  it('files an SWS exemption and a health cess line', async () => {
    const r = await row(
      standard({
        swsExemption: { notification: '11/2018-Customs', serial: '3' },
        healthCess: { notification: '006/2020', serial: '1' },
      }),
    );
    expect(r['SWS_Notn']).toBe('011/2018');
    expect(r['SWS_NotnSrNo']).toBe('3');
    expect(r['CHealthCess_Notn']).toBe('006/2020');
  });
});

describe('ITEMS §20 tariff value', () => {
  it('writes the value per the notification’s unit and the quantity in it', async () => {
    const r = await row(
      standard({
        ritc: '15111000',
        tariffValue: { notification: '036/2001', serial: '1', quantity: 156.45, currency: 'USD', amountPerUnit: 1214, unit: 'MTS' },
      }),
    );
    expect(r['Tariff_Value_Notn']).toBe('036/2001');
    expect(r['Tariff_Value_NotnSrNo']).toBe('1');
    expect(r['Tarrif_Value_Qty']).toBe('156.450');
    expect(r['Tarrif_Value_Currency']).toBe('USD');
    expect(r['Tarrif_Value_Amount']).toBe('1214.00');
  });

  it('writes the vendor’s zeros when there is none', async () => {
    const r = await row(standard());
    expect(r['Tarrif_Value_Qty']).toBe('0.000');
    expect(r['Tarrif_Value_Amount']).toBe('0.00');
  });
});

describe('ITEMS §21 trade remedies', () => {
  it('writes a specific anti-dumping duty with its rows and unit', async () => {
    const r = await row(
      standard({
        tradeRemedies: [
          { kind: 'ADD', notification: '20/2026-Customs (ADD)', cthSerial: '3', supplierSerial: '2', quantity: 156.45, amountPerUnit: 211.5, amountUnit: 'MT', currency: 'USD' },
        ],
      }),
    );
    expect(r['ADD_Notn']).toBe('020/2026');
    expect(r['CTHSrNo']).toBe('3');
    expect(r['SuppSrNo']).toBe('2');
    expect(r['ADD_Qty']).toBe('156.450000');
    expect(r['ADD_AmountPerUnit']).toBe('211.50000');
    expect(r['ADD_AmountUnit']).toBe('MT');
    expect(r['ADD_Currency']).toBe('USD');
    expect(r['ADD_Basis']).toBeUndefined();
  });

  it('writes an ad valorem duty on assessable value, and CVD on landed value', async () => {
    const r = await row(
      standard({
        tradeRemedies: [
          { kind: 'ADD', notification: '05/2025-Customs (ADD)', cthSerial: '1', ratePercent: 12.5 },
          { kind: 'CVD', notification: '01/2024-Customs (CVD)', cthSerial: '4', supplierSerial: '1', ratePercent: 6 },
        ],
      }),
    );
    expect(r['ADD_Basis']).toBe('AV');
    expect(r['ADD_%Rate']).toBe('12.50');
    expect(r['CVD_Notn']).toBe('001/2024');
    expect(r['CVD_Rate']).toBe('6.00');
    expect(r['CVD_CalculatedOn']).toBe('1');
    expect(r['CVD_ItemSrNo']).toBe('4');
  });

  it('refuses while a trade-remedy row is still to be chosen', async () => {
    await expect(
      build(standard({ tradeRemedyCandidates: [{ kind: 'ADD', notification: '020/2026', cthSerial: '1', producer: 'A', exporter: 'B' }] })),
    ).rejects.toThrow(/trade-remedy row/);
  });

  it('writes no ADD_Basis or CVD_CalculatedOn on a line with no remedy', async () => {
    const r = await row(standard());
    expect(r['ADD_Basis']).toBeUndefined();
    expect(r['CVD_CalculatedOn']).toBeUndefined();
  });
});

describe('ITEMS §25-§27', () => {
  it('writes the SVB block for a related party only', async () => {
    const unrelated = await row(standard());
    expect(unrelated['SVBRefNo']).toBeUndefined();
    const related = await row({
      ...standard(),
      supplierRelationship: { isRelated: true, svbRefNo: 'SVB/12', svbDate: '2025-04-01', svbCustomHouse: 'INNSA1', rateAssessable: 1, statusAssessable: 'F' },
    });
    expect(related['SVBRefNo']).toBe('SVB/12');
    expect(related['SVBCustomHouse']).toBe('INNSA1');
    expect(related['SVB_Rate_Assessable']).toBe('1.00000');
  });

  it('marks a free-of-charge line', async () => {
    expect((await row(standard({ foc: true })))['Foc_Item']).toBe('Y');
    expect((await row(standard()))['Foc_Item']).toBe('N');
  });

  it('writes a previous Bill of Entry the operator gave', async () => {
    const r = await row(standard({ previousBe: { beNo: '1234567', beDate: '2026-01-05', unitPrice: 1.19, currency: 'USD', customHouse: 'INNSA1' } }));
    expect(r['Previous_BENo']).toBe('1234567');
    expect(r['Previous_BEDate']).toBe('05-Jan-2026');
    expect(r['Previous_BEUnitPrice']).toBe('1.190000');
  });
});
