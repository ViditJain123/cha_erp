import { describe, expect, it } from 'vitest';
import type { ChecklistDraft } from '@checklist/extraction';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { readSheet } from './read.js';

/**
 * SHIPMENT rules, as departures from the golden sea job.
 *
 * The golden test pins what a complete job produces. This file pins what an
 * *incomplete* one produces — which is the whole point of the sheet's contract:
 * a column with no available source raises a warning naming itself, and never
 * quietly becomes blank. Every case below is drawn from a real document in
 * `ex_job1..7` or `liv_job1`.
 *
 * See `docs/boe-mapping/03-shipment.md`.
 */

type Shipment = ChecklistDraft['shipment'];

/** The golden draft with its shipment block amended, and keys removable. */
function withShipment(patch: Partial<Shipment>, omit: (keyof Shipment)[] = []): ChecklistDraft {
  const shipment: Record<string, unknown> = { ...EP061126_1_DRAFT.shipment, ...patch };
  for (const key of omit) delete shipment[key as string];
  return { ...EP061126_1_DRAFT, shipment: shipment as unknown as Shipment };
}

async function build(draft: ChecklistDraft) {
  const result = await buildLogisysWorkbook({ draft, job: EP061126_1_JOB });
  return { row: (await readSheet(result.buffer, 'SHIPMENT'))[0]!, warnings: result.warnings };
}

/** Whether any warning names this column. */
function warnsAbout(warnings: string[], path: string): boolean {
  return warnings.some((w) => w.includes(path));
}

describe('SHIPMENT: the main carrier owns MAWB_MBL_No', () => {
  it('leaves the master columns blank when only a house B/L exists', async () => {
    // "Main carrier hoona chaiye". A forwarder's house B/L is not the document
    // the Bill of Entry declares, and writing it into MAWB_MBL_No names the
    // wrong carrier to Customs. The export still happens — the other nine
    // sheets are worth having — but the operator is told why I and J are empty.
    const { row, warnings } = await build(
      withShipment({ hblNo: 'SEAXYZ123', hblDate: '2026-06-28' }, ['blNo', 'blDate']),
    );

    expect(row['MAWB_MBL_No'] ?? '').toBe('');
    expect(row['AWB_BL_Date'] ?? '').toBe('');
    expect(row['HAWB_HBL_No']).toBe('SEAXYZ123');
    expect(row['HAWB_HBL_Date']).toBe('28-Jun-2026');
    expect(warnsAbout(warnings, 'SHIPMENT.MAWB_MBL_No')).toBe(true);
    // The message has to name the house number, or the operator cannot tell
    // which document we decided was insufficient.
    expect(warnings.find((w) => w.includes('SHIPMENT.MAWB_MBL_No'))).toContain('SEAXYZ123');
  });

  it('warns when the master document has no date', async () => {
    const { row, warnings } = await build(withShipment({}, ['blDate']));
    expect(row['MAWB_MBL_No']).toBe('A07GX14312');
    expect(row['AWB_BL_Date'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.AWB_BL_Date')).toBe(true);
  });
});

describe('SHIPMENT: packages are not containers', () => {
  it('writes the package count and its kind', async () => {
    const { row } = await build(EP061126_1_DRAFT);
    expect(row['No_of_Pkg']).toBe('6258.000');
    expect(row['PkgUnitCode']).toBe('BAG');
  });

  it('warns when no document states a package kind', async () => {
    // An air waybill counts pieces and does not name them: job I-13841/26-27
    // was filed 1 PLT and I-30239/26-27 20 PKG, with neither word on either
    // waybill. The code used to assume PLT, which is a constant and wrong.
    const { row, warnings } = await build(withShipment({}, ['packageUnit']));
    expect(row['PkgUnitCode'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.PkgUnitCode')).toBe(true);
  });

  it('warns when the package kind is not in the master', async () => {
    // CNTR is a container, not a package kind — which is exactly what lands
    // here when a totals box reading "0004 CNTR" is read as the package line.
    const { row, warnings } = await build(withShipment({ packageUnit: 'CNTR' }));
    expect(row['PkgUnitCode'] ?? '').toBe('');
    expect(warnings.find((w) => w.includes('SHIPMENT.PkgUnitCode'))).toContain('CNTR');
  });

  it('warns when no document states a package count at all', async () => {
    const { row, warnings } = await build(withShipment({}, ['packageCount']));
    expect(row['No_of_Pkg'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.No_of_Pkg')).toBe(true);
  });
});

describe('SHIPMENT: weights', () => {
  it('declares the unit the weight-unit master resolved, not a literal', async () => {
    // ex_job6's B/L prints "157,703.000 KGM" — the UN/ECE code for kilograms.
    // `merge.ts` converts and records KGS; the mapper must not hardcode it,
    // because a pounds document has to come out converted rather than relabelled.
    const { row } = await build(withShipment({ weightUnitCode: 'KGS' }));
    expect(row['GrWtUnitCode']).toBe('KGS');
    expect(row['NtWtUnitCode']).toBe('KGS');
  });

  it('leaves the unit blank when there is no weight to carry it', async () => {
    const { row, warnings } = await build(withShipment({}, ['netWeightKg']));
    expect(row['NtWt'] ?? '').toBe('');
    expect(row['NtWtUnitCode'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.NtWt')).toBe(true);
  });

  it('warns when gross weight is on no document', async () => {
    const { row, warnings } = await build(withShipment({}, ['grossWeightKg']));
    expect(row['GrWt'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.GrWt')).toBe(true);
  });
});

describe('SHIPMENT: the gateway manifest belongs to inland filings', () => {
  it('asks for the gateway IGM when the BE is filed at an ICD', async () => {
    // ICD Tughlakabad: sixth character of INTKD6 is 6, so it is inland. The
    // goods were manifested at a sea port before moving under bond, and both
    // manifests go on the BE — the ICD's in IGM_No, the gateway's in U/V/W.
    const draft: ChecklistDraft = {
      ...EP061126_1_DRAFT,
      customStation: { code: 'INTKD6', name: 'Tughlakabad' },
    };
    const { row, warnings } = await build(draft);

    expect(row['Port_of_Reporting']).toBe('INTKD6');
    expect(row['Gateway_IGM_No'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.Gateway_IGM_No')).toBe(true);
  });

  it('writes the gateway values once an operator has keyed them', async () => {
    const draft: ChecklistDraft = {
      ...EP061126_1_DRAFT,
      customStation: { code: 'INTKD6', name: 'Tughlakabad' },
      shipment: {
        ...EP061126_1_DRAFT.shipment,
        gatewayIgmNo: '2246881',
        gatewayIgmDate: '2026-06-20',
        gatewayInwardDate: '2026-06-24',
      },
    };
    const { row, warnings } = await build(draft);

    expect(row['Gateway_IGM_No']).toBe('2246881');
    expect(row['Gateway_IGM_Date']).toBe('20-Jun-2026');
    expect(row['Gateway_Inward_Date']).toBe('24-Jun-2026');
    expect(warnsAbout(warnings, 'SHIPMENT.Gateway_IGM_No')).toBe(false);
  });

  it('stays silent at a sea port, where there is no gateway behind the filing', async () => {
    const { warnings } = await build(EP061126_1_DRAFT);
    expect(warnsAbout(warnings, 'Gateway')).toBe(false);
  });
});

describe('SHIPMENT: the ICEGATE block warns only once somebody has looked', () => {
  it('asks for the IGM, line and inward date when ICEGATE was checked', async () => {
    // `igmChecked` is the difference between "no IGM exists yet" (an Advance
    // filing, correctly blank) and "somebody looked it up and did not write it
    // down". Only the second is a gap.
    const { warnings } = await build(withShipment({ igmChecked: true }));
    expect(warnsAbout(warnings, 'SHIPMENT.IGM_No')).toBe(true);
    expect(warnsAbout(warnings, 'SHIPMENT.LineNo')).toBe(true);
    expect(warnsAbout(warnings, 'SHIPMENT.Flight_Inward_Date')).toBe(true);
  });

  it('writes the line number as text, so a leading zero survives', async () => {
    const { row } = await build(
      withShipment({ igmChecked: true, igmNo: '1197668', lineNo: '0042', inwardDate: '2026-07-01' }),
    );
    expect(row['LineNo']).toBe('0042');
    expect(typeof row['LineNo']).toBe('string');
    expect(row['Flight_Inward_Date']).toBe('01-Jul-2026');
  });
});

describe('SHIPMENT: Marks & Nos is never empty', () => {
  it('warns when nothing filled it', async () => {
    // Jobs I-13592/26-27 and I-14075/26-27 both carry an operator-written
    // declaration here rather than "AS PER BL", so this cell can legitimately
    // need a person — but it can never ship blank.
    const { row, warnings } = await build(withShipment({}, ['marksAndNos']));
    expect(row['Marks_&_Nos'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.Marks_&_Nos')).toBe(true);
  });

  it('carries a re-import declaration verbatim', async () => {
    const marks = 'RE-IMPORT OF INDIAN ORIGIN GOODS & RE EXPORTED';
    const { row, warnings } = await build(
      withShipment({ marksAndNos: marks, marksAndNosFromOperator: true }),
    );
    expect(row['Marks_&_Nos']).toBe(marks);
    expect(warnsAbout(warnings, 'SHIPMENT.Marks_&_Nos')).toBe(false);
  });
});

describe('SHIPMENT: the carrier and the conveyance', () => {
  it('warns when the shipping line is on no document', async () => {
    // ex_job6's carrier is only in a signature block and ex_job2's only in the
    // letterhead, so this is a column that genuinely goes missing.
    const { row, warnings } = await build(withShipment({}, ['shippingLineOrCarrier']));
    expect(row['CarrierName'] ?? '').toBe('');
    expect(warnsAbout(warnings, 'SHIPMENT.CarrierName')).toBe(true);
  });

  it('warns for the vessel and the voyage separately', async () => {
    const { warnings } = await build(withShipment({}, ['vesselOrFlight', 'voyageNo']));
    expect(warnsAbout(warnings, 'SHIPMENT.VesselName')).toBe(true);
    expect(warnsAbout(warnings, 'SHIPMENT.FlightNo_VoyageNo')).toBe(true);
  });
});

describe('SHIPMENT: an air job', () => {
  /** The golden sea draft turned into job I-13841/26-27's air shipment. */
  const AIR: ChecklistDraft = {
    ...EP061126_1_DRAFT,
    transportMode: 'Air',
    customStation: { code: 'INBOM4', name: 'Sahar Air Cargo' },
    shipment: {
      containers: [],
      mawbNo: '05779606800',
      mawbDate: '2026-06-30',
      hawbNo: 'BOS0121016',
      hawbDate: '2026-06-30',
      shippingLineOrCarrier: 'AIR FRANCE',
      voyageNo: 'AF331',
      packageCount: 1,
      packageUnit: 'PLT',
      grossWeightKg: 101,
      netWeightKg: 101,
      weightUnitCode: 'KGS',
      marksAndNos: '05779606800\n................\nBOS0121016',
    },
  };

  it('puts the master waybill in I/J and the house one in K/L', async () => {
    // Transcribed from ex_job1's checklist: "MAWB No. 05779606800 dt.
    // 30-Jun-2026" / "HAWB No. BOS0121016 dt. 30-Jun-2026".
    const { row } = await build(AIR);
    expect(row['MAWB_MBL_No']).toBe('05779606800');
    expect(row['AWB_BL_Date']).toBe('30-Jun-2026');
    expect(row['HAWB_HBL_No']).toBe('BOS0121016');
    expect(row['HAWB_HBL_Date']).toBe('30-Jun-2026');
  });

  it('leaves VesselName blank and does not ask for a vessel', async () => {
    // There is no ship on an air job. The column used to carry the flight
    // string, because merge.ts wrote `flightAndDate` into `vesselOrFlight`.
    const { row, warnings } = await build(AIR);
    expect(row['VesselName'] ?? '').toBe('');
    expect(row['FlightNo_VoyageNo']).toBe('AF331');
    expect(warnsAbout(warnings, 'SHIPMENT.VesselName')).toBe(false);
  });

  it('carries the airline, not the forwarder', async () => {
    // The air waybill for this job is issued by DSV AIR & SEA INC, a freight
    // forwarder. The carrier is Air France, read off the MAWB prefix 057.
    const { row } = await build(AIR);
    expect(row['CarrierName']).toBe('AIR FRANCE');
    expect(row['CarrierCode'] ?? '').toBe('');
  });

  it('writes the marks as one cell, newlines collapsed', async () => {
    // The checklist prints three lines; a cell in the workbook is one line,
    // and cell.text() is what flattens it.
    const { row } = await build(AIR);
    expect(row['Marks_&_Nos']).toBe('05779606800 ................ BOS0121016');
  });

  it('reports at the air custom house, not a sea port', async () => {
    const { row, warnings } = await build(AIR);
    expect(row['Port_of_Reporting']).toBe('INBOM4');
    // INBOM4 is an air cargo complex, not an inland station: no gateway.
    expect(warnsAbout(warnings, 'Gateway')).toBe(false);
  });
});
