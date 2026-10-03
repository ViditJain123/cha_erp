import { describe, expect, it } from 'vitest';
import { CandidateRegistry } from '../src/agent/registry.js';
import { jobAgentTools } from '../src/agent/tools.js';
import { lookupNotifications } from '../src/agent/notification-index.js';
import { renderJobContext } from '../src/agent/context.js';
import type { ChecklistDraft } from '../src/draft.js';

function tools(filingDate: string) {
  const registry = new CandidateRegistry();
  const defs = jobAgentTools({ files: [], filingDate, registry });
  const call = async (name: string, args: unknown) => {
    const out = await defs.find((t) => t.name === name)!.handler(args);
    return typeof out === 'string' ? out : JSON.stringify(out);
  };
  return { registry, call, defs };
}

describe('the agent tools', () => {
  it('answers with trimmed rows and registers every CTH it shows', async () => {
    const { registry, call } = tools('2026-09-01');
    const raw = await call('resolve_tariff_prefix', { prefix: '3902' });
    const out = JSON.parse(raw);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates[0].description.length).toBeLessThanOrEqual(121);
    expect(registry.cth.has('39021000')).toBe(true);
    expect(JSON.parse(await call('lookup_tariff', { cth: '39021000' })).cth).toBe('39021000');
  });

  it('offers BCD entries only on the notification in force on the filing date', async () => {
    const before = tools('2025-10-31');
    const early = JSON.parse(await before.call('bcd_candidates', { cth: '90211000' }));
    expect(early.applicable).toBe(false);
    expect(early.notification).toBe('050/2017');
    expect(before.registry.bcd.size).toBe(0);

    const after = tools('2026-09-01');
    const late = JSON.parse(await after.call('bcd_candidates', { cth: '90211000' }));
    expect(late.applicable).toBe(true);
    expect(late.entries.length).toBeGreaterThan(0);
    expect(after.registry.bcd.size).toBeGreaterThan(0);
    for (const e of late.entries) {
      expect(e.description.length).toBeLessThanOrEqual(301);
      if (e.listRef) expect(e.filable).toBe(false);
    }
  });

  it('marks the IGST schedule unknown before 9/2025 and registers nothing', async () => {
    const early = tools('2025-03-13');
    const out = JSON.parse(await early.call('igst_candidates', { cth: '39021000' }));
    expect(out.scheduleKnown).toBe(false);
    expect(out.notification).toBe('001/2017');
    expect(early.registry.igst.size).toBe(0);

    const late = tools('2026-09-01');
    const known = JSON.parse(await late.call('igst_candidates', { cth: '39021000' }));
    expect(known.scheduleKnown).toBe(true);
    expect(late.registry.igst.has(CandidateRegistry.igstKey('009/2025', 'II114'))).toBe(true);
  });

  it('maps a licence notification to its scheme entry and registers it', async () => {
    const { registry, call } = tools('2026-09-01');
    const out = JSON.parse(await call('exim_scheme_for_licence', { notification: '21/2023', cth: '39021000' }));
    expect(out.code).toBe('03');
    expect(out.exim).toEqual({ notification: '021/2023', serial: '1' });
    expect(out.igstExemption).toEqual({ notification: '021/2023', serial: '1', type: 'C' });
    expect(out.aidcSerial).toBe('18');
    expect(registry.exim.get('021/2023')?.code).toBe('03');
    expect(await call('exim_scheme_for_licence', { notification: '099/1999', cth: '39021000' })).toMatch(/not a scheme notification/);
  });

  it('withdraws read_document after three calls and names the missing file', async () => {
    const { defs, call } = tools('2026-09-01');
    expect(defs.find((t) => t.name === 'read_document')!.maxCalls).toBe(3);
    expect(await call('read_document', { fileName: 'nope.pdf', pages: null, mode: 'text' })).toMatch(/no file named/);
  });
});

describe('the CBIC notification index', () => {
  it('finds a number in its series and a title by words', () => {
    const rows = lookupNotifications({ number: '45/2025-Customs', query: null });
    expect(rows.some((r) => r.ices === '045/2025' && r.category === 'Tariff')).toBe(true);
    const aa = lookupNotifications({ number: '21/2023-Cus', query: null });
    expect(aa.some((r) => /advance authorisation/i.test(r.name))).toBe(true);
    const byTitle = lookupNotifications({ number: null, query: 'refined palm oil basic customs duty' });
    expect(byTitle.length).toBeGreaterThan(0);
  });
});

describe('the first-turn context', () => {
  it('renders the consignment, the documents and the lines compactly', async () => {
    const draft = {
      transportMode: 'Sea',
      beType: 'Home Consumption',
      importer: { name: 'ACME' },
      supplier: { name: 'Borouge', country: 'AE' },
      shipment: { countryOfOrigin: 'AE', portOfDischarge: 'NHAVA SHEVA', blNo: 'BL1' },
      invoices: [{ srNo: 1, invoiceNumber: 'INV-1', invoiceDate: '2026-06-01', currency: 'USD', invoiceValue: 1000, termsOfInvoice: 'CIF' }],
      items: [{ slNo: 1, invoiceSrNo: 1, description: 'Borsafe HE3490LS HD polyethylene', ritc: '39012000', quantity: 1, unit: 'KGS', unitPrice: 1, amount: 1, bcdRate: 7.5, igstRate: 18, compCessRate: 0, notificationSerials: { igst: 'II114' } }],
      flags: [{ severity: 'error', path: 'items.0.ritc', message: 'x'.repeat(400) }],
    } as unknown as ChecklistDraft;
    const text = await renderJobContext({
      draft,
      docs: [{ fileName: 'INV.pdf', docType: 'invoice', data: null, model: 'test' }],
      files: [{ fileName: 'INV.pdf', pdf: Buffer.from('') }, { fileName: 'LIC.pdf', pdf: Buffer.from(''), hint: 'license' }],
      filingDate: '2026-09-01',
      filingDateSource: 'header',
    });
    expect(text).toContain('Filing date: 2026-09-01');
    expect(text).toContain('LIC.pdf: not classified; ingest says license');
    expect(text).toContain('Item 1/1 (items.0)');
    expect(text).toContain('CTH 39012000');
    expect(text.length).toBeLessThan(6000);
  });
});
