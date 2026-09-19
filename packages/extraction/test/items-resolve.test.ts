import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetItemMasterCache, type FtaAgreement } from '@checklist/core';
import type { ChecklistDraft, DraftItem } from '../src/draft.js';
import { resolveItems, retargetItemCth } from '../src/items-resolve.js';

/**
 * The master-derived half of ITEMS, against small masters swapped in through
 * ITEM_MASTERS_DIR so each rule is pinned by the case that exercises it rather
 * than by whatever the committed corpus happens to contain.
 */

const TODAY = '2026-09-01';

const JAPAN: FtaAgreement = {
  key: 'IN-JP-CEPA',
  name: 'India-Japan CEPA',
  partners: ['JP'],
  inForceFrom: '2011-08-01',
  inForceUntil: null,
  concessionNotifications: [{ notification: '69/2011-Customs' }],
  slot: 'BASIC',
  rooRules: { notification: '98/2011-Customs (N.T.)' },
  cooHeadingPatterns: ['Comprehensive Economic Partnership Agreement'],
  originCriteria: [{ coo: 'CTH', ices: 'CTH' }],
  retroactive: { allowed: true, windowDays: 365, marking: 'ISSUED RETROACTIVELY' },
};

function masters(extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'resolve-items-'));
  mkdirSync(path.join(dir, 'fta-schedules'));
  const files: Record<string, unknown> = {
    'fta-agreements.json': [JAPAN],
    'fta-schedules/IN-JP-CEPA.json': [{ serial: '295', include: ['390210'], description: 'Polypropylene', rate: 0, rateText: 'Nil' }],
    'levies.json': {
      aidc: {
        notification: '11/2021-Customs',
        entries: [
          { serial: '1', include: ['071310'], description: 'All goods', rate: 40, rateText: '40%', allGoods: true, kind: 'specific' },
          { serial: '17', include: [], anyChapter: true, description: 'All goods other than goods mentioned against serial numbers 1 to 16G above.', rate: 0, rateText: 'Nil', kind: 'residual' },
          { serial: '19', include: [], anyChapter: true, description: 'All goods on which exemption from basic customs duty is claimed and allowed under the notifications mentioned in the ANNEXURE.', rate: 0, rateText: 'Nil', kind: 'claim-based' },
        ],
        annexure: [{ serial: '6', notification: '069/2011', validFrom: '2021-02-02' }],
      },
      swsExemption: { notification: '11/2018-Customs', entries: [] },
      igstExemptions: [],
      compCessExemptions: [],
    },
    'trade-remedies.json': { asOf: TODAY, entries: [] },
    ...extra,
  };
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), JSON.stringify(body));
  process.env.ITEM_MASTERS_DIR = dir;
  resetItemMasterCache();
}

beforeEach(() => masters());
afterEach(() => {
  delete process.env.ITEM_MASTERS_DIR;
  resetItemMasterCache();
});

function item(over: Partial<DraftItem> = {}): DraftItem {
  return {
    slNo: 1,
    invoiceSrNo: 1,
    description: 'PP GRANULES (POLYPROPYLENE)',
    ritc: '39021000',
    quantity: 156450,
    unit: 'KGS',
    unitPrice: 1.20757,
    amount: 188924.33,
    bcdRate: 7.5,
    swsRate: 10,
    igstRate: 18,
    igstNotification: '009/2025',
    aidcRate: 0,
    compCessRate: 0,
    originCountry: 'Japan',
    manufacturerName: 'ASIA SHIGEN INTERNATIONAL CO., LTD',
    endUseCode: '',
    ...over,
  };
}

function draft(over: Partial<ChecklistDraft> = {}, items: DraftItem[] = [item()]): ChecklistDraft {
  return {
    tenantId: 't',
    transportMode: 'Sea',
    beType: 'Home Consumption',
    importer: { name: 'X', addressLines: [], matchedFromMasters: false },
    supplier: { name: 'ASIA SHIGEN INTERNATIONAL CO., LTD', addressLines: [], country: 'Japan' },
    shipment: { blDate: '2025-09-08', countryOfOrigin: 'Japan', consCountry: 'Japan', containers: [] },
    invoiceMeta: { exchangeRates: { USD: 96.05 } },
    invoices: [
      { srNo: 1, invoiceNumber: 'I', invoiceDate: '2025-09-01', termsOfInvoice: 'CIF', currency: 'USD', invoiceValue: 188924.33, paymentMethod: 'Transaction', natureOfTransaction: 'Sale', relatedParty: false },
    ],
    items,
    supportingDocs: [],
    declarations: [],
    duty: null,
    fieldMeta: {},
    flags: [],
    ...over,
  } as ChecklistDraft;
}

const JP_COO = {
  certificateNumber: '250377141204202410',
  issueDate: '2025-09-09',
  issuingCountry: 'Japan',
  originCountry: 'Japan',
  schemeText: 'Agreement between Japan and the Republic of India for a Comprehensive Economic Partnership Agreement',
  originCriterion: 'CTH',
  transitCountries: [],
  items: [{ itemNumber: '1', description: 'POLYPROPYLENE', hsCode: '3902.10', originCriterion: 'CTH' }],
};

describe('AIDC', () => {
  it('follows the BCD claim: 19 under a Japan-CEPA claim (ex_job6), 17 without one', () => {
    const claimed = resolveItems(draft({ certificatesOfOrigin: [JP_COO] }), { today: TODAY });
    expect(claimed.items[0]!.aidcLevy?.serial).toBe('19');
    expect(claimed.items[0]!.aidcNotification).toBe('011/2021');
    const standard = resolveItems(draft({}, [item({ ritc: '34039900', description: 'LUBRICANT', originCountry: 'United States' })]), { today: TODAY });
    expect(standard.items[0]!.aidcLevy?.serial).toBe('17');
  });

  it('lets a code-specific entry win', () => {
    const out = resolveItems(draft({}, [item({ ritc: '07131000', description: 'PEAS', originCountry: 'Canada' })]), { today: TODAY });
    expect(out.items[0]!.aidcLevy?.serial).toBe('1');
    expect(out.items[0]!.aidcRate).toBe(40);
  });
});

describe('preferential origin', () => {
  it('claims the agreement’s serial for the item’s own CTH', () => {
    const out = resolveItems(draft({ certificatesOfOrigin: [JP_COO] }), { today: TODAY });
    const fta = out.items[0]!.fta!;
    expect(fta).toMatchObject({ slot: 'BASIC', notification: '069/2011', serial: '295', originCriterion: 'CTH', retroactiveIssuance: false });
    expect(out.items[0]!.bcdExemption).toMatchObject({ notification: '069/2011', percent: 100, scheme: 'India-Japan CEPA' });
    expect(out.ftaClaim?.scheme).toBe('India-Japan CEPA');
  });

  it('never borrows another line’s serial for a CTH the schedule does not name', () => {
    const out = resolveItems(draft({ certificatesOfOrigin: [{ ...JP_COO, items: [] }] }, [item({ ritc: '34039900' })]), { today: TODAY });
    expect(out.items[0]!.fta).toBeUndefined();
    expect(out.items[0]!.bcdExemption).toBeUndefined();
    expect(out.flags.some((f) => /not a concession line/.test(f.message))).toBe(true);
  });

  it('flags a retroactive certificate issued outside the window', () => {
    const out = resolveItems(draft({ certificatesOfOrigin: [{ ...JP_COO, issueDate: '2027-02-01', issuedRetroactively: true }] }), { today: TODAY });
    expect(out.items[0]!.fta?.retroactiveCheck?.compliant).toBe(false);
    expect(out.flags.some((f) => f.severity === 'error' && /within 365 days/.test(f.message))).toBe(true);
  });

  it('with no certificate, records the missed benefit and asks', () => {
    const out = resolveItems(draft(), { today: TODAY });
    expect(out.items[0]!.fta).toBeUndefined();
    expect(out.ftaOpportunities?.[0]).toMatchObject({ agreement: 'IN-JP-CEPA', serial: '295', standardBcdRate: 7.5 });
    expect(out.ftaOpportunities?.[0]?.estimatedSaving).toBeGreaterThan(0);
  });

  it('respects the importer declining the benefit', () => {
    const out = resolveItems(draft({ certificatesOfOrigin: [JP_COO] }), { today: TODAY, claimFtaBenefit: false });
    expect(out.items[0]!.fta).toBeUndefined();
    expect(out.ftaOpportunities).toBeUndefined();
  });

  it('leaves an operator’s claim alone', () => {
    const mine = item({ fta: { agreement: 'X', scheme: 'Mine', slot: 'BASIC', notification: '001/2020', serial: '9' }, sources: { fta: 'operator' } });
    const out = resolveItems(draft({ certificatesOfOrigin: [JP_COO] }, [mine]), { today: TODAY });
    expect(out.items[0]!.fta?.scheme).toBe('Mine');
  });
});

describe('trade remedies', () => {
  it('files a single matching row with its quantity in the notification’s unit', () => {
    masters({
      'trade-remedies.json': {
        asOf: TODAY,
        entries: [
          { kind: 'ADD', notification: '20/2026-Customs (ADD)', notificationShort: '020/2026', tableSerial: '4', include: ['390210'], description: 'PP', originCountries: ['JP'], exportCountries: ['ANY'], producer: 'ANY', exporter: 'ANY', supplierSerial: null, basis: 'SPECIFIC', rate: null, amount: 120, unit: 'MT', currency: 'USD', validFrom: '2026-01-01', validUntil: '2030-01-01' },
        ],
      },
    });
    const out = resolveItems(draft(), { today: TODAY });
    expect(out.items[0]!.tradeRemedies?.[0]).toMatchObject({ kind: 'ADD', notification: '020/2026', cthSerial: '4', quantity: 156.45, amountPerUnit: 120, amountUnit: 'MT' });
  });

  it('leaves two named rows as candidates for the operator', () => {
    const row = { kind: 'ADD', notification: '20/2026-Customs (ADD)', include: ['390210'], description: 'PP', originCountries: ['JP'], exportCountries: ['ANY'], supplierSerial: null, basis: 'AV', rate: 10, amount: null, unit: null, currency: null, validFrom: '2026-01-01', validUntil: '2030-01-01' };
    masters({
      'trade-remedies.json': {
        asOf: TODAY,
        entries: [
          { ...row, tableSerial: '1', producer: 'Asia Shigen International', exporter: 'ANY' },
          { ...row, tableSerial: '2', producer: 'Asia Shigen Intl Co', exporter: 'ANY' },
        ],
      },
    });
    const out = resolveItems(draft(), { today: TODAY });
    expect(out.items[0]!.tradeRemedies).toBeUndefined();
    expect(out.items[0]!.tradeRemedyCandidates).toHaveLength(2);
  });

  it('drops the candidates once the operator has picked a row', () => {
    // The choice is saved as `tradeRemedies` with source `operator`, which
    // makes this block skip — and the skip left the candidate list in place, so
    // the export went on refusing with "none is chosen" against a line where
    // one had been. The question has to go away with the answer.
    const row = { kind: 'ADD', notification: '20/2026-Customs (ADD)', include: ['390210'], description: 'PP', originCountries: ['JP'], exportCountries: ['ANY'], supplierSerial: null, basis: 'AV', rate: 10, amount: null, unit: null, currency: null, validFrom: '2026-01-01', validUntil: '2030-01-01' };
    masters({
      'trade-remedies.json': {
        asOf: TODAY,
        entries: [
          { ...row, tableSerial: '1', producer: 'Asia Shigen International', exporter: 'ANY' },
          { ...row, tableSerial: '2', producer: 'Asia Shigen Intl Co', exporter: 'ANY' },
        ],
      },
    });
    const chosen = item({
      tradeRemedies: [{ kind: 'ADD', notification: '020/2026', cthSerial: '1', rate: 10 }],
      tradeRemedyCandidates: [
        { kind: 'ADD', notification: '020/2026', cthSerial: '1', producer: 'Asia Shigen International', exporter: 'ANY' },
        { kind: 'ADD', notification: '020/2026', cthSerial: '2', producer: 'Asia Shigen Intl Co', exporter: 'ANY' },
      ],
      sources: { tradeRemedies: 'operator' },
    });
    const out = resolveItems(draft({}, [chosen]), { today: TODAY });
    expect(out.items[0]!.tradeRemedies).toHaveLength(1);
    expect(out.items[0]!.tradeRemedyCandidates).toBeUndefined();
  });
});

describe('end use', () => {
  it('takes the mail’s instruction over the importer’s default', () => {
    const out = resolveItems(draft(), { today: TODAY, mailEndUse: 'for actual use in our plant', defaultEndUseCode: 'GNX100' });
    expect(out.items[0]!.endUseCode).toBe('GNX200');
    expect(out.items[0]!.sources?.endUseCode).toBe('mail');
  });

  it('falls back to the importer’s default, then asks', () => {
    expect(resolveItems(draft(), { today: TODAY, defaultEndUseCode: 'GNX100' }).items[0]!.endUseCode).toBe('GNX100');
    const asked = resolveItems(draft(), { today: TODAY });
    expect(asked.flags.some((f) => f.path === 'items.0.endUseCode')).toBe(true);
  });
});

describe('re-running', () => {
  it('does not pile up its own flags', () => {
    const once = resolveItems(draft({ certificatesOfOrigin: [JP_COO] }), { today: TODAY });
    const twice = resolveItems(once, { today: TODAY });
    expect(twice.flags).toHaveLength(once.flags.length);
    expect(twice.items[0]!.fta).toEqual(once.items[0]!.fta);
  });

  it('drops a claim when the CTH moves off the schedule', () => {
    const claimed = resolveItems(draft({ certificatesOfOrigin: [JP_COO] }), { today: TODAY });
    const moved = { ...claimed, items: [retargetItemCth(claimed.items[0]!, '34039900')], certificatesOfOrigin: [{ ...JP_COO, items: [] }] };
    const out = resolveItems(moved, { today: TODAY });
    expect(out.items[0]!.fta).toBeUndefined();
    expect(out.items[0]!.bcdExemption).toBeUndefined();
  });
});
