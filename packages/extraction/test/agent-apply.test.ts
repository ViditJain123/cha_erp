import { describe, expect, it } from 'vitest';
import { bcdExemptionMatches, lookupTariff, requiresIgcr } from '@checklist/core';
import type { ChecklistDraft, DraftItem } from '../src/draft.js';
import { applyAgentResult } from '../src/agent/apply.js';
import type { JobAgentResult } from '../src/agent/output.js';
import { CandidateRegistry } from '../src/agent/registry.js';
import { jobAgentTools } from '../src/agent/tools.js';

/**
 * What the agent's answer may and may not do to a draft. Every case runs
 * against the real masters: the registry is filled by calling the tools the
 * way the model would, then an answer is applied and the line inspected.
 */
const FILING = '2026-09-01';
const FILES = ['INVOICE.pdf', 'BL.pdf', 'EPCG-831018385.pdf'];

function item(over: Partial<DraftItem> = {}): DraftItem {
  return {
    slNo: 1,
    invoiceSrNo: 1,
    description: 'PP GRANULES (POLYPROPYLENE)',
    ritc: '39021000',
    quantity: 1000,
    unit: 'KGS',
    unitPrice: 1,
    amount: 1000,
    bcdRate: 7.5,
    swsRate: 10,
    igstRate: 18,
    aidcRate: 0,
    compCessRate: 0,
    endUseCode: '',
    notificationSerials: { igst: 'II114' },
    ...over,
  };
}

function draft(items: DraftItem[]): ChecklistDraft {
  return { items, flags: [], shipment: {}, invoices: [], importer: { name: 'X' }, supplier: { name: 'Y' } } as unknown as ChecklistDraft;
}

function empty(over: Partial<JobAgentResult['items'][number]> = {}): JobAgentResult['items'][number] {
  return {
    invoiceSrNo: 1,
    slNo: 1,
    cth: { reason: 'settled', decided: false, cth: null, confidence: 'high', evidence: [], considered: [] },
    bcd: { reason: 'none', applies: false, notification: null, serial: null, subEntry: null, descriptionMatches: false, conditionEstablishedBy: null, conditionSummary: null, confidence: 'high', evidence: [] },
    igst: { reason: 'as merged', decided: false, serial: null, rate: null, confidence: 'high', evidence: [] },
    compCess: { reason: 'as merged', decided: false, serial: null, rate: null, confidence: 'high', evidence: [] },
    exim: { reason: 'no licence', applies: false, notification: null, serial: null, licenceNo: null, licenceDate: null, licenceFile: null, evidence: [] },
    conflicts: [],
    openQuestions: [],
    ...over,
  };
}

function result(items: JobAgentResult['items']): JobAgentResult {
  return { items, jobConflicts: [], webFindings: [] };
}

async function registryAfter(calls: { name: string; args: unknown }[]): Promise<CandidateRegistry> {
  const registry = new CandidateRegistry();
  const tools = jobAgentTools({ files: [], filingDate: FILING, registry });
  for (const c of calls) await tools.find((t) => t.name === c.name)!.handler(c.args);
  return registry;
}

const opts = { fileNames: FILES, model: 'test', at: '2026-09-01T00:00:00Z' };

describe('evidence references', () => {
  it('reads a file name with a page suffix as the file, and the web as the web', async () => {
    const { isPrimaryEvidence } = await import('../src/agent/output.js');
    const files = new Set(FILES);
    expect(isPrimaryEvidence('EPCG-831018385.pdf p.5', files)).toBe(true);
    expect(isPrimaryEvidence('INVOICE.pdf, page 2', files)).toBe(true);
    expect(isPrimaryEvidence('the mail', files)).toBe(true);
    expect(isPrimaryEvidence('mail', files)).toBe(true);
    expect(isPrimaryEvidence('web:https://cbic.gov.in/x', files)).toBe(false);
    expect(isPrimaryEvidence('tool:bcd_candidates', files)).toBe(false);
    expect(isPrimaryEvidence('Consignment record', files)).toBe(false);
  });
});

describe('the registry rule', () => {

  it('refuses a CTH no tool returned, and files one that was', async () => {
    const empty_ = new CandidateRegistry();
    const refused = applyAgentResult(
      draft([item()]),
      result([empty({ cth: { reason: 'it is polyethylene', decided: true, cth: '39012000', confidence: 'high', evidence: [], considered: [] } })]),
      empty_,
      opts,
    );
    expect(refused.draft.items[0]!.ritc).toBe('39021000');
    expect(refused.draft.flags.some((f) => f.severity === 'error' && f.path === 'items.0.ritc' && /not a tariff item any tool returned/.test(f.message))).toBe(true);

    const registry = await registryAfter([{ name: 'resolve_tariff_prefix', args: { prefix: '3901' } }]);
    const applied = applyAgentResult(
      draft([item()]),
      result([empty({ cth: { reason: 'the invoice says HDPE, which is polyethylene', decided: true, cth: '39012000', confidence: 'high', evidence: [{ document: 'INVOICE.pdf', quote: 'HDPE' }], considered: ['39021000', '39012000'] } })]),
      registry,
      opts,
    );
    const line = applied.draft.items[0]!;
    expect(line.ritc).toBe('39012000');
    expect(line.sources?.ritc).toBe('agent');
    expect(line.bcdRate).toBe(lookupTariff('39012000')!.bcdRate);
    expect(line.agent?.decisions.find((d) => d.field === 'cth')).toMatchObject({ value: '39012000', applied: true });
  });

  it('leaves an operator\'s CTH alone', async () => {
    const registry = await registryAfter([{ name: 'resolve_tariff_prefix', args: { prefix: '3901' } }]);
    const out = applyAgentResult(
      draft([item({ sources: { ritc: 'operator' } })]),
      result([empty({ cth: { reason: 'HDPE', decided: true, cth: '39012000', confidence: 'high', evidence: [], considered: [] } })]),
      registry,
      opts,
    );
    expect(out.draft.items[0]!.ritc).toBe('39021000');
  });

  it('refuses a BCD entry whose only evidence is the web', async () => {
    const cth = '90211000';
    const registry = await registryAfter([{ name: 'bcd_candidates', args: { cth } }]);
    const entry = bcdExemptionMatches(cth, { onIsoDate: FILING })[0]!;
    const out = applyAgentResult(
      draft([item({ ritc: cth })]),
      result([
        empty({
          bcd: { reason: 'the entry names these goods', applies: true, notification: '045/2025', serial: entry.serial, subEntry: null, descriptionMatches: true, conditionEstablishedBy: null, conditionSummary: null, confidence: 'high', evidence: [{ document: 'web:https://x', quote: 'q' }] },
        }),
      ]),
      registry,
      opts,
    );
    expect(out.draft.items[0]!.bcdNotification).toBeUndefined();
    expect(out.draft.flags.some((f) => f.path === 'items.0.bcdRate' && /only evidence is the web/.test(f.message))).toBe(true);
  });
});

describe('reason agreement and conditions', () => {
  it('does not file a concession whose reason argues against it', async () => {
    const cth = '90211000';
    const registry = await registryAfter([{ name: 'bcd_candidates', args: { cth } }]);
    const entry = bcdExemptionMatches(cth, { onIsoDate: FILING })[0]!;
    const out = applyAgentResult(
      draft([item({ ritc: cth })]),
      result([
        empty({
          bcd: {
            reason: 'The entry is limited to a specified importer, which the invoice does not establish.',
            applies: true,
            notification: '045/2025',
            serial: entry.serial,
            subEntry: null,
            descriptionMatches: true,
            conditionEstablishedBy: { document: 'INVOICE.pdf', quote: 'x' },
            conditionSummary: null,
            confidence: 'medium',
            evidence: [{ document: 'INVOICE.pdf', quote: 'x' }],
          },
        }),
      ]),
      registry,
      opts,
    );
    expect(out.draft.items[0]!.bcdNotification).toBeUndefined();
    expect(out.draft.flags.some((f) => f.path === 'items.0.bcdRate' && /own reasoning/.test(f.message))).toBe(true);
  });

  it('requires a document or mail for a conditioned entry, and files when one is quoted', async () => {
    const cth = '90211000';
    const registry = await registryAfter([{ name: 'bcd_candidates', args: { cth } }]);
    const filable = [...registry.bcd.values()].find(
      (r) => r.filable && !r.subEntry && r.entry.bcdRate != null && r.entry.conditions.length > 0 && !requiresIgcr(r.entry),
    );
    if (!filable) return; // no conditioned, filable, ad-valorem, non-IGCR entry for this code in the current masters

    const decision = {
      reason: 'The goods are what the entry describes.',
      applies: true,
      notification: '045/2025',
      serial: filable.entry.serial,
      subEntry: null,
      descriptionMatches: true,
      conditionSummary: null,
      confidence: 'high' as const,
      evidence: [{ document: 'INVOICE.pdf', quote: 'x' }],
    };
    const without = applyAgentResult(draft([item({ ritc: cth })]), result([empty({ bcd: { ...decision, conditionEstablishedBy: null } })]), registry, opts);
    expect(without.draft.items[0]!.bcdNotification).toBeUndefined();
    expect(without.draft.flags.some((f) => /carries condition/.test(f.message))).toBe(true);

    const withMail = applyAgentResult(
      draft([item({ ritc: cth })]),
      result([empty({ bcd: { ...decision, conditionEstablishedBy: { document: 'mail', quote: 'for use in our own hospital' } } })]),
      registry,
      opts,
    );
    const line = withMail.draft.items[0]!;
    expect(line.bcdNotification).toBe('045/2025');
    expect(line.notificationSerials?.basic).toBe(filable.entry.serial);
    expect(line.bcdRate).toBe(filable.entry.bcdRate);
    expect(line.sources?.notifications).toBe('agent');
    expect(withMail.draft.flags.some((f) => f.path === 'items.0.bcdRate' && /Condition met by mail/.test(f.message))).toBe(true);
  });

});

describe('a licence claim', () => {
  it('files the scheme only with a licence on the job, and carries the IGST exemption', async () => {
    const registry = await registryAfter([{ name: 'exim_scheme_for_licence', args: { notification: '026/2023', cth: '84051010' } }]);
    const decision = { reason: 'EPCG authorisation on the job covers the plant', applies: true, notification: '026/2023', serial: '1', licenceNo: '0831018385', licenceDate: '2026-05-07', evidence: [{ document: 'EPCG-831018385.pdf', quote: 'Authorisation No 0831018385' }] };

    const withLicence = applyAgentResult(draft([item({ ritc: '84051010' })]), result([empty({ exim: { ...decision, licenceFile: 'EPCG-831018385.pdf' } })]), registry, opts);
    const line = withLicence.draft.items[0]!;
    expect(line.eximScheme).toMatchObject({ code: '12', notification: '026/2023', serial: '1' });
    expect(line.igstExemption).toEqual({ notification: '026/2023', serial: '1', type: 'C' });
    expect(line.sources?.eximScheme).toBe('agent');

    const noLicence = applyAgentResult(
      draft([item({ ritc: '84051010' })]),
      result([empty({ exim: { ...decision, licenceFile: null, evidence: [{ document: 'web:https://dgft', quote: 'x' }] } })]),
      registry,
      opts,
    );
    expect(noLicence.draft.items[0]!.eximScheme).toBeUndefined();
    expect(noLicence.draft.flags.some((f) => f.path === 'items.0.eximScheme' && /no licence on the job/.test(f.message))).toBe(true);
  });

  it('refuses a scheme notification no tool returned', () => {
    const out = applyAgentResult(
      draft([item()]),
      result([empty({ exim: { reason: 'r', applies: true, notification: '021/2023', serial: '1', licenceNo: null, licenceDate: null, licenceFile: 'INVOICE.pdf', evidence: [] } })]),
      new CandidateRegistry(),
      opts,
    );
    expect(out.draft.items[0]!.eximScheme).toBeUndefined();
    expect(out.draft.flags.some((f) => f.severity === 'error' && f.path === 'items.0.eximScheme')).toBe(true);
  });
});

describe('serials, conflicts and web findings', () => {
  it('takes a citation of a tool result as neutral, not as the web', async () => {
    const registry = await registryAfter([{ name: 'comp_cess_candidates', args: { cth: '39021000' } }]);
    const out = applyAgentResult(
      draft([item()]),
      result([empty({ compCess: { reason: 'No entry names the code; residual S.No. 56 applies.', decided: true, serial: '56', rate: 0, confidence: 'high', evidence: [{ document: 'Compensation cess master — 39021000', quote: 'residualSerial: 56' }] } })]),
      registry,
      opts,
    );
    expect(out.draft.items[0]!.notificationSerials?.compCess).toBe('56');
    expect(out.draft.flags.some((f) => /only evidence is the web/.test(f.message))).toBe(false);
  });

  it('confirms an IGST serial the tool returned, and refuses one it did not', async () => {
    const registry = await registryAfter([{ name: 'igst_candidates', args: { cth: '39021000' } }]);

    const ok = applyAgentResult(
      draft([item()]),
      result([empty({ igst: { reason: 'Schedule II S.No. 114 names polypropylene', decided: true, serial: 'II114', rate: 18, confidence: 'high', evidence: [] } })]),
      registry,
      opts,
    );
    expect(ok.draft.items[0]!.notificationSerials?.igst).toBe('II114');
    expect(ok.draft.flags.some((f) => f.severity === 'info' && /confirms IGST/.test(f.message))).toBe(true);

    const bad = applyAgentResult(
      draft([item()]),
      result([empty({ igst: { reason: 'x', decided: true, serial: 'III999', rate: 5, confidence: 'high', evidence: [] } })]),
      registry,
      opts,
    );
    expect(bad.draft.items[0]!.notificationSerials?.igst).toBe('II114');
    expect(bad.draft.flags.some((f) => f.severity === 'error' && f.path === 'items.0.igstRate')).toBe(true);
  });

  it('turns conflicts, open questions and web findings into flags, never values', () => {
    const out = applyAgentResult(
      draft([item()]),
      {
        items: [
          empty({
            conflicts: [{ field: 'origin', documents: ['INVOICE.pdf', 'BL.pdf'], values: ['Japan', 'Korea'], severity: 'error', resolution: 'The certificate of origin decides; a person must confirm.' }],
            openQuestions: ['Is the importer an actual user?'],
          }),
        ],
        jobConflicts: [{ field: 'weight', documents: ['BL.pdf', 'PL.pdf'], values: ['1000', '1200'], severity: 'warning', resolution: 'Packing list is authoritative.' }],
        webFindings: [{ url: 'https://example.com', quote: 'HE3490LS is an HDPE pipe grade', aboutItemSlNo: 1, claim: 'The grade is HDPE' }],
      },
      new CandidateRegistry(),
      opts,
    );
    const paths = out.draft.flags.map((f) => f.path);
    expect(paths).toContain('items.0.originCountry');
    expect(paths).toContain('items.0.agent');
    expect(paths).toContain('agent.conflict');
    expect(out.draft.flags.some((f) => f.severity === 'info' && /web, not filed/.test(f.message))).toBe(true);
    expect(out.draft.items[0]!.agent?.openQuestions).toEqual(['Is the importer an actual user?']);
    expect(out.flagsAdded).toBe(4);
  });
});
