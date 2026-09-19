import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * The GENERAL header, and what the exporter does when it does not know.
 *
 * Thirteen of this sheet's columns were constants: the custom house was
 * `awb ? 'INBOM4' : 'INNSA1'`, the duty payment status was 'T', the filing
 * posture was a coin flip on transport mode, and the nine yes/no columns were
 * always blank. None of those could ever fail a test, because none of them was
 * ever computed.
 *
 * These tests exist to make the absence of a value visible. A workbook that
 * ships a custom house nobody chose is the failure being guarded against, and
 * it is worse than a workbook that refuses to ship.
 */

const build = (draft: ChecklistDraft) => buildLogisysWorkbook({ draft, job: EP061126_1_JOB });

/**
 * A resolved warehouse block, so a bonded BE can be built at all.
 *
 * INBOND_EXBOND blocks a `W` or `EX` export that names no warehouse, which is
 * the point of that sheet — these GENERAL tests are about the BE-type letter,
 * so they supply the minimum that lets the workbook be produced.
 */
const BONDED: NonNullable<ChecklistDraft['inbondExbond']> = {
  warehouse: {
    value: { code: 'MAA1U001', name: 'M/S APM TERMINAL(I) PVT. LTD', country: 'IN' },
    source: 'mail',
  },
  inBondBeNo: { value: '1234567', source: 'operator' },
  inBondBeDate: { value: '2026-07-01', source: 'operator' },
  bondNo: { value: 'B/2026/114', source: 'operator' },
  bondDate: undefined,
  bondExpiryDate: undefined,
  release: { value: { packages: 2, grossWeightKg: 51 }, source: 'operator' },
};

/** The importer with no AD code at all, as an unbound party would be. */
function stripAdCode(importer: ChecklistDraft['importer']): ChecklistDraft['importer'] {
  const { adCode: _none, ...rest } = importer;
  return rest;
}

/** The golden draft with one thing about its header changed. */
function withHeader(patch: Partial<NonNullable<ChecklistDraft['boe']>>): ChecklistDraft {
  return { ...EP061126_1_DRAFT, boe: { ...EP061126_1_DRAFT.boe!, ...patch } };
}

describe('GENERAL refuses to invent a header', () => {
  it('blocks the export when no custom house was chosen', async () => {
    // Blockers throw: an incomplete Bill of Entry costs an operator ten
    // minutes, a confidently wrong one is a misdeclaration.
    await expect(build(withHeader({ customStation: undefined }))).rejects.toThrow(
      /GENERAL\.CustomsHouseCode/,
    );
  });

  it('blocks when the importer banks through several AD codes and none is picked', async () => {
    await expect(
      build({
        ...withHeader({
          adCode: undefined,
          adCodeChoices: [{ adCode: '0410002' }, { adCode: '0510226' }],
        }),
        // The bound-party fallback would otherwise supply one. Omitted rather
        // than set undefined: exactOptionalPropertyTypes tells them apart.
        importer: stripAdCode(EP061126_1_DRAFT.importer),
      }),
    ).rejects.toThrow(/banks through 2 AD codes/);
  });

  it('leaves the filing status blank and warns, rather than guessing', async () => {
    // Was `Air ? 'Prior' : 'Normal'` — a value with no relationship to the rule.
    const { buffer, warnings } = await build(withHeader({ filingStatus: undefined }));
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['AdvancePriorNormal'] ?? '').toBe('');
    expect(warnings.some((w) => w.startsWith('GENERAL.AdvancePriorNormal'))).toBe(true);
  });

  it('blocks a draft that was never resolved at all', async () => {
    const { boe: _dropped, ...unresolved } = EP061126_1_DRAFT;
    await expect(build(unresolved as ChecklistDraft)).rejects.toThrow(
      /header has not been resolved/,
    );
  });
});

describe('GENERAL writes the values it does know', () => {
  it('codes an inland delivery as L, not S', async () => {
    // The case that had no representation: a sea consignment railed to an ICD.
    const { buffer } = await build(
      withHeader({
        transportMode: { value: 'Land', source: 'master' },
        customStation: { value: { code: 'INTKD6', name: 'Tuglakabad ICD' }, source: 'mail' },
      }),
    );
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['TransportModeCode']).toBe('L');
    expect(row!['CustomsHouseCode']).toBe('INTKD6');
  });

  it('codes a warehousing BE as W and an ex-bond one as EX', async () => {
    const bonded = (value: 'Warehousing' | 'Ex-Bond') => ({
      ...withHeader({ beType: { value, source: 'mail' as const } }),
      inbondExbond: BONDED,
    });

    const w = await readSheet((await build(bonded('Warehousing'))).buffer, 'GENERAL');
    expect(w[0]!['BETypeCode']).toBe('W');

    const ex = await readSheet((await build(bonded('Ex-Bond'))).buffer, 'GENERAL');
    expect(ex[0]!['BETypeCode']).toBe('EX');
  });

  it('refuses a bonded BE that names no warehouse', async () => {
    // The BE type alone is not enough: a W or EX filing that does not say which
    // bonded warehouse it concerns cannot be filed, so it is not exported.
    await expect(
      build(withHeader({ beType: { value: 'Ex-Bond', source: 'mail' } })),
    ).rejects.toThrow(/INBOND_EXBOND/);
  });

  it('writes D for deferred duty', async () => {
    const { buffer } = await build(
      withHeader({ dutyPaymentStatus: { value: 'D', source: 'mail' } }),
    );
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['DutyPaymentStatus_T_D']).toBe('D');
  });

  it('writes Y for a true flag and nothing for a false one', async () => {
    const { buffer } = await build(
      withHeader({
        flags: { underSec46: true, underSec48: false, firstCheck: true, greenChannel: false },
      }),
    );
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['IsUnderSec46']).toBe('Y');
    expect(row!['IsFirstCheck']).toBe('Y');
    // False and unknown are the same empty cell — the vendor's own export never
    // writes N on this sheet.
    expect(row!['IsUnderSec48'] ?? '').toBe('');
    expect(row!['IsGreenChannel'] ?? '').toBe('');
    expect(row!['IsHSS'] ?? '').toBe('');
  });

  it('writes the importer’s own reference, not our job number', async () => {
    const { buffer } = await build(
      withHeader({ importerRefNo: { value: 'PO-4471', source: 'mail' } }),
    );
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['Importer_RefNo']).toBe('PO-4471');
    expect(row!['Importer_RefNo']).not.toBe(EP061126_1_JOB.reference);
  });

  it('leaves the importer reference blank when there is none', async () => {
    // It used to be filled with `job.reference` unconditionally.
    const { buffer } = await build(withHeader({ importerRefNo: undefined }));
    const [row] = await readSheet(buffer, 'GENERAL');
    expect(row!['Importer_RefNo'] ?? '').toBe('');
  });
});
