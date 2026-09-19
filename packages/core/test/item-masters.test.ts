import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aidcLevyFor,
  combineNotnRate,
  computeBeDuty,
  endUseCodeFromText,
  ftaAgreementForCertificate,
  ftaConcessionFor,
  ftaOriginCriterion,
  normalIssuanceDays,
  eximSchemeCode,
  eximSchemeName,
  exemptionNotnType,
  logisysNotn,
  notnFlag,
  notnFlagFromRateText,
  productDescriptionKey,
  resetItemMasterCache,
  retroactiveCheck,
  sameCompany,
  tariffValueCandidates,
  tariffValueQuantity,
  tradeRemediesFor,
  type FtaAgreement,
  type TradeRemedyEntry,
} from '../src/index.js';

/**
 * The ITEMS masters and the code domains behind them
 * (docs/boe-mapping/06-items.md). Data-dependent cases run against the
 * committed JSON; matching logic runs against small masters swapped in through
 * ITEM_MASTERS_DIR.
 */

afterEach(() => {
  delete process.env.ITEM_MASTERS_DIR;
  resetItemMasterCache();
});

function withMasters(files: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'item-masters-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), JSON.stringify(body));
  process.env.ITEM_MASTERS_DIR = dir;
  resetItemMasterCache();
}

describe('code domains', () => {
  it('spells notifications the way Logi-Sys files them', () => {
    expect(logisysNotn('11/2021-Customs')).toBe('011/2021');
    expect(logisysNotn('69/2011 - Customs')).toBe('069/2011');
    expect(logisysNotn('009/2025')).toBe('009/2025');
    expect(logisysNotn('nothing')).toBeUndefined();
  });

  it('reads the Plus/Minus/Higher/Lower dropdown', () => {
    expect(notnFlag('Plus')).toBe('+');
    expect(notnFlag('higher')).toBe('H');
    expect(notnFlag('L')).toBe('L');
    expect(notnFlag('sometimes')).toBeUndefined();
    expect(combineNotnRate('+', 100, 20)).toBe(120);
    expect(combineNotnRate('-', 100, 20)).toBe(80);
    expect(combineNotnRate('H', 100, 120)).toBe(120);
    expect(combineNotnRate('L', 100, 120)).toBe(100);
  });

  it('reads the flag off a notification’s rate wording', () => {
    expect(notnFlagFromRateText('10% or Rs. 25 per kg, whichever is higher')).toBe('H');
    expect(notnFlagFromRateText('12% or Rs 4170 per tonne whichever is lower')).toBe('L');
    expect(notnFlagFromRateText('7.5%')).toBe('+');
  });

  it('types an exemption by the notification that grants it', () => {
    expect(exemptionNotnType('45/2025-Customs')).toBe('C');
    expect(exemptionNotnType('02/2017-Integrated Tax (Rate)')).toBe('G');
    expect(exemptionNotnType('045/2025')).toBeUndefined();
  });

  it('refuses an Exim scheme code no directory holds', () => {
    expect(eximSchemeCode('3')).toBe('03');
    expect(eximSchemeCode('11 : Concessional duty EPCG scheme')).toBe('11');
    expect(eximSchemeCode('Zero duty EPCG scheme')).toBe('12');
    // `88` is in neither the ICES scheme directory nor Logi-Sys' own output.
    // (`99` used to stand in for "unknown" here; it is NFEI, a real code the
    // scrolled screenshot simply never showed.)
    expect(eximSchemeCode('88')).toBeUndefined();
  });

  it('takes the codes the screenshot never showed, and the vendor-only ones', () => {
    // Every one of these is filed by a real Logi-Sys export in the corpus and
    // was refused before the directory was loaded — which refused the whole
    // workbook, not just the cell.
    expect(eximSchemeCode('26')).toBe('26'); // ex_job28, DFIA
    expect(eximSchemeCode('32')).toBe('32'); // ex_job27, Tariff Rate Quota
    expect(eximSchemeCode('RD')).toBe('RD'); // ex_job20, RoDTEP scrips
    expect(eximSchemeCode('19')).toBe('19'); // Drawback — scrolled out of view
    expect(eximSchemeName('26')).toBe('DFIA');
    expect(eximSchemeName('RD')).toBe('RoDTEP scrip');
  });

  it('codes an importer’s plain-words end use, and only those', () => {
    expect(endUseCodeFromText('for actual use in our factory')).toBe('GNX200');
    expect(endUseCodeFromText('goods are for trading')).toBe('GNX100');
    expect(endUseCodeFromText('R&D samples')).toBe('GNX810');
    expect(endUseCodeFromText('please file as GNX200')).toBe('GNX200');
    expect(endUseCodeFromText('urgent clearance please')).toBeUndefined();
  });

  it('keys a product description stably', () => {
    expect(productDescriptionKey('Random  Polypropylene, RP2248N')).toBe('RANDOM POLYPROPYLENE RP2248N');
    expect(productDescriptionKey('random polypropylene rp2248n')).toBe('RANDOM POLYPROPYLENE RP2248N');
  });
});

describe('AIDC serials against the committed master (11/2021)', () => {
  // Every golden checklist, from docs/boe-mapping/06-items.md §16.
  it.each([
    ['34039900', '2026-07-02', undefined, '17'], // ex_job1
    ['17021110', '2026-08-04', { notification: '096/2008', serial: '(i)' }, '17'], // ex_job2, DFTP
    ['12074090', '2026-06-22', undefined, '17'], // ex_job3
    ['39046100', '2026-07-27', undefined, '17'], // ex_job4
    ['85322990', '2026-06-09', { notification: '024/2005', serial: '20' }, '17'], // ex_job5, as filed
    ['29171400', '2026-08-24', undefined, '17'], // liv_job1
    ['39021000', '2026-08-08', { notification: '069/2011', serial: '295' }, '19'], // ex_job6, Japan CEPA
  ])('CTH %s on %s files S.No. %s', (cth, date, claim, serial) => {
    const line = aidcLevyFor(cth, date, claim);
    expect(line?.notification).toBe('011/2021');
    expect(line?.serial).toBe(serial);
  });
});

describe('tariff values (36/2001-Customs (N.T.) editions)', () => {
  it('finds the edition in force on the date and its row for crude palm oil', () => {
    const tv = tariffValueCandidates('15111000', '2026-09-05');
    expect(tv?.baseNotification).toBe('036/2001');
    expect(tv?.edition.notification).toMatch(/72\/2026/);
    expect(tv?.rows[0]?.uqc).toBe('MTS');
  });

  it('converts the invoice quantity into the notification’s own unit', () => {
    expect(tariffValueQuantity(156450, 'KGS', { uqc: 'MTS', per: 1 })).toBeCloseTo(156.45, 6);
    expect(tariffValueQuantity(1000, 'GMS', { uqc: 'GMS', per: 10 })).toBe(100);
    expect(tariffValueQuantity(10, 'NOS', { uqc: 'GMS', per: 10 })).toBeUndefined();
  });

  it('answers nothing for goods no table names', () => {
    expect(tariffValueCandidates('39021000', '2026-09-05')).toBeUndefined();
  });
});

describe('trade agreements against the committed master', () => {
  it('reads ex_job6’s Japanese certificate and files 069/2011 S.No. 295 in Basic', () => {
    const agreement = ftaAgreementForCertificate(
      'COMPREHENSIVE ECONOMIC PARTNERSHIP AGREEMENT BETWEEN JAPAN AND THE REPUBLIC OF INDIA',
      'JP',
      '2026-08-08',
    );
    expect(agreement?.key).toBe('IN-JP-CEPA');
    const c = ftaConcessionFor(agreement!, '39021000', '2026-08-08');
    expect(c).toMatchObject({ notification: '069/2011', serial: '295', slot: 'BASIC', rate: 0, rateIsRemission: false });
    expect(ftaOriginCriterion(agreement!, 'B')?.criterion).toBe('CONWO - COOP');
  });

  it('reads ex_job2’s Ugandan DFTP certificate and files 096/2008 (i) as a remission in the SAPTA slot', () => {
    const agreement = ftaAgreementForCertificate('Duty Free tariff Preference Scheme for Least Developed Countries', 'UG', '2026-08-04');
    expect(agreement?.key).toBe('DFTP');
    const c = ftaConcessionFor(agreement!, '17021110', '2026-08-04');
    expect(c).toMatchObject({ notification: '096/2008', serial: '(i)', slot: 'SAPTA', rate: 100, rateIsRemission: true });
  });

  it('knows no concession for goods the Japan schedule does not name', () => {
    const agreement = ftaAgreementForCertificate('India-Japan CEPA', 'JP', '2026-08-08')!;
    expect(ftaConcessionFor(agreement, '10063010', '2026-08-08')).toBeUndefined(); // rice: excluded from Japan's concessions
  });

  it('reads each agreement’s ordinary issuance window', () => {
    const jp = ftaAgreementForCertificate('India-Japan CEPA', 'JP', '2026-08-08')!;
    expect(normalIssuanceDays(jp)).toBe(3); // "not later than three days"
    const ae = ftaAgreementForCertificate('CEPA', 'AE', '2026-08-08')!;
    expect(normalIssuanceDays(ae)).toBe(7); // five working days
  });
});

describe('retroactive issuance', () => {
  const agreement = (retroactive: FtaAgreement['retroactive']): FtaAgreement => ({
    key: 'T',
    name: 'Test CEPA',
    partners: ['JP'],
    inForceFrom: '2011-08-01',
    inForceUntil: null,
    concessionNotifications: [{ notification: '69/2011-Customs' }],
    slot: 'BASIC',
    cooHeadingPatterns: [],
    originCriteria: [],
    retroactive,
  });
  const rule = { allowed: true, windowDays: 365, marking: 'ISSUED RETROACTIVELY', source: { notification: '69/2011', rule: 'rule 10' } };

  it('is not retroactive when issued by the shipment date', () => {
    const r = retroactiveCheck(agreement(rule), '2025-09-09', '2025-09-10', null);
    expect(r).toMatchObject({ retroactive: false, compliant: true });
  });

  it('is compliant when marked and inside the window', () => {
    expect(retroactiveCheck(agreement(rule), '2025-12-01', '2025-09-10', true)).toMatchObject({ retroactive: true, compliant: true });
  });

  it('is not compliant unmarked, outside the window, or where the agreement forbids it', () => {
    expect(retroactiveCheck(agreement(rule), '2025-12-01', '2025-09-10', false).compliant).toBe(false);
    expect(retroactiveCheck(agreement(rule), '2027-01-01', '2025-09-10', true).reason).toMatch(/within 365 days/);
    expect(retroactiveCheck(agreement({ ...rule, allowed: false }), '2025-12-01', '2025-09-10', true).reason).toMatch(/does not provide/);
  });
});

describe('trade remedies', () => {
  const row = (over: Partial<TradeRemedyEntry>): TradeRemedyEntry => ({
    kind: 'ADD',
    notification: '20/2026-Customs (ADD)',
    notificationShort: '020/2026',
    tableSerial: '1',
    include: ['39021000'],
    description: 'Polypropylene',
    originCountries: ['SG'],
    exportCountries: ['ANY'],
    producer: 'ANY',
    exporter: 'ANY',
    supplierSerial: null,
    basis: 'SPECIFIC',
    rate: null,
    amount: 100,
    unit: 'MT',
    currency: 'USD',
    validFrom: '2026-01-01',
    validUntil: '2030-12-31',
    ...over,
  });
  const query = { cth: '39021000', originIso2: 'SG', exportIso2: 'SG', producer: 'Borouge Pte Ltd', exporter: 'Borouge Pte Ltd.', onIsoDate: '2026-09-01' };

  it('prefers the named producer’s row to the residual', () => {
    withMasters({
      'trade-remedies.json': {
        asOf: '2026-09-13',
        entries: [row({ tableSerial: '1', producer: 'Borouge Pte Ltd', exporter: 'Borouge Pte Ltd', amount: 50 }), row({ tableSerial: '2' })],
      },
    });
    expect(tradeRemediesFor(query).ADD.entry?.tableSerial).toBe('1');
  });

  it('falls to the residual when no named row matches', () => {
    withMasters({
      'trade-remedies.json': {
        asOf: '2026-09-13',
        entries: [row({ tableSerial: '1', producer: 'Reliance', exporter: 'Reliance' }), row({ tableSerial: '2' })],
      },
    });
    expect(tradeRemediesFor(query).ADD.entry?.tableSerial).toBe('2');
  });

  it('returns candidates, not a choice, when two named rows match', () => {
    withMasters({
      'trade-remedies.json': {
        asOf: '2026-09-13',
        entries: [row({ tableSerial: '1', producer: 'Borouge Pte', exporter: 'ANY' }), row({ tableSerial: '3', producer: 'Borouge Pte Ltd', exporter: 'ANY' })],
      },
    });
    const m = tradeRemediesFor(query).ADD;
    expect(m.entry).toBeUndefined();
    expect(m.candidates).toHaveLength(2);
  });

  it('ignores a lapsed or other-origin row', () => {
    withMasters({
      'trade-remedies.json': {
        asOf: '2026-09-13',
        entries: [row({ validUntil: '2025-12-31' }), row({ originCountries: ['CN'] })],
      },
    });
    const m = tradeRemediesFor(query).ADD;
    expect(m.entry).toBeUndefined();
    expect(m.candidates).toHaveLength(0);
  });

  it('matches company names on their distinctive words', () => {
    expect(sameCompany('ZIBO QIXIANG TENGDA CHEMICAL CO. LTD.', 'Zibo Qixiang Tengda Chemical Company Limited')).toBe(true);
    expect(sameCompany('Borouge Pte Ltd', 'Reliance Industries')).toBe(false);
  });
});

describe('duty engine: trade remedies and tariff value', () => {
  const invoice = {
    invoiceNumber: 'I',
    invoiceDate: '2026-09-01',
    termsOfInvoice: 'CIF' as const,
    currency: 'USD',
    invoiceValue: 100000,
    items: [
      { slNo: 1, description: 'x', ritc: '39021000', quantity: 100000, unit: 'KGS', unitPrice: 1, bcdRate: 7.5, swsRate: 10, igstRate: 18 },
    ],
  };

  it('adds a specific anti-dumping duty to the IGST base but not the SWS base', () => {
    const plain = computeBeDuty([invoice], { USD: 90 });
    const withAdd = computeBeDuty(
      [{ ...invoice, items: [{ ...invoice.items[0]!, tradeRemedies: [{ kind: 'ADD' as const, amountPerUnit: 100, currency: 'USD', quantity: 100 }] }] }],
      { USD: 90 },
    );
    expect(withAdd.totals.antiDumping).toBe(900000);
    expect(withAdd.totals.sws).toBe(plain.totals.sws);
    expect(withAdd.totals.igst - plain.totals.igst).toBeCloseTo(900000 * 0.18, 2);
  });

  it('takes the higher of the two parts under H', () => {
    const d = computeBeDuty(
      [{ ...invoice, items: [{ ...invoice.items[0]!, tradeRemedies: [{ kind: 'SAFEGUARD' as const, ratePercent: 20, amountPerUnit: 1, currency: 'USD', quantity: 100, flag: 'H' as const }] }] }],
      { USD: 90 },
    );
    // 20% of 9,000,000 = 1,800,000 beats 100 × 90 = 9,000.
    expect(d.totals.safeguard).toBe(1800000);
  });

  it('values goods at the tariff value, not the invoice price', () => {
    const d = computeBeDuty(
      [{ ...invoice, items: [{ ...invoice.items[0]!, ritc: '15111000', tariffValue: { amountPerUnit: 1214, currency: 'USD', quantity: 100 } }] }],
      { USD: 90 },
    );
    expect(d.totalAssessableValue).toBe(1214 * 100 * 90);
  });
});
