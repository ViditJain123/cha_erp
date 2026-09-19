import { describe, expect, it } from 'vitest';
import { mergeToDraft } from '../src/merge.js';
import type {
  AwbExtract,
  BlExtract,
  ExtractedDoc,
  InvoiceExtract,
  PackingListExtract,
} from '../src/schemas.js';

/**
 * How SHIPMENT values are chosen from the documents.
 *
 * Every case here is a real failure observed against a document in
 * `ex_job1..7` or `liv_job1`, checked against the checklist Logi-Sys printed
 * for that job. The mapper's own rules are in
 * `packages/exporter/test/shipment.test.ts`; this file is about what reaches it.
 *
 * See `docs/boe-mapping/03-shipment.md`.
 */

/** A minimal invoice, because `mergeToDraft` errors without one. */
function invoice(over: Partial<InvoiceExtract> = {}): ExtractedDoc {
  const data: InvoiceExtract = {
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-06-01',
    sellerName: 'ACME TRADING LLC',
    sellerAddressLines: ['PO BOX 1'],
    sellerCity: 'Muscat',
    sellerCountry: 'Oman',
    buyerName: 'IMPORTER PVT LTD',
    buyerAddressLines: ['Mumbai'],
    buyerGstin: null,
    buyerIec: null,
    currency: 'USD',
    deliveryTermsRaw: 'CIF NHAVA SHEVA',
    termsOfInvoice: 'CIF',
    paymentTerms: null,
    purchaseOrderNumber: null,
    items: [],
    freightCharge: null,
    insuranceCharge: null,
    totalAmount: 1000,
    netWeightKg: null,
    grossWeightKg: null,
    countryOfOrigin: 'Oman',
    portOfLoading: null,
    portOfDischarge: null,
    uncertainFields: [],
    ...over,
  } as InvoiceExtract;
  return { fileName: 'INV.pdf', docType: 'invoice', data, model: 'test' };
}

function bl(over: Partial<BlExtract> = {}, fileName = 'BL.pdf'): ExtractedDoc {
  const data: BlExtract = {
    blNumber: 'MBL0001',
    blDate: '2026-06-10',
    issueDate: '2026-06-10',
    shippedOnBoardDate: null,
    isHouseBl: false,
    masterBlNumber: null,
    masterBlDate: null,
    shipperName: 'ACME TRADING LLC',
    shipperAddressLines: [],
    consigneeName: null,
    notifyPartyName: null,
    shippingLine: null,
    carrierName: null,
    vesselVoyage: null,
    vesselName: null,
    voyageNo: null,
    bookingNumber: null,
    agencyReferenceNumber: null,
    portOfLoading: 'NHAVA SHEVA, INDIA',
    portOfDischarge: 'NHAVA SHEVA, INDIA',
    placeOfDelivery: 'NHAVA SHEVA, INDIA',
    packageCount: null,
    packageUnit: null,
    containerCount: null,
    cargoDescription: null,
    marksAndNumbers: null,
    grossWeightKg: null,
    netWeightKg: null,
    grossWeightUnitAsPrinted: null,
    netWeightUnitAsPrinted: null,
    measurementCbm: null,
    hsCode: null,
    invoiceNumberRef: null,
    freightTerms: null,
    containers: [],
    isDraftDocument: false,
    uncertainFields: [],
    ...over,
  } as BlExtract;
  return { fileName, docType: 'bill_of_lading', data, model: 'test' };
}

function awb(over: Partial<AwbExtract> = {}): ExtractedDoc {
  const data: AwbExtract = {
    mawbNumber: '05779606800',
    hawbNumber: null,
    awbDate: '2026-06-30',
    hawbDate: null,
    shipperName: 'FUCHS LUBRICANTS CO',
    shipperAddressLines: [],
    consigneeName: null,
    issuingCarrierOrAgent: null,
    carrierIataPrefix: null,
    operatingCarrier: null,
    airportOfDeparture: 'BOSTON',
    airportOfDestination: 'BOM',
    flightAndDate: null,
    flightNumber: null,
    flightDate: null,
    pieces: null,
    packageUnit: null,
    grossWeightKg: null,
    netWeightKg: null,
    grossWeightUnitAsPrinted: null,
    chargeableWeightKg: null,
    natureOfGoods: null,
    hsCode: null,
    deliveryTerms: null,
    referenceNumbers: null,
    uncertainFields: [],
    ...over,
  } as AwbExtract;
  return { fileName: 'AWB.pdf', docType: 'air_waybill', data, model: 'test' };
}

function packingList(over: Partial<PackingListExtract> = {}): ExtractedDoc {
  const data: PackingListExtract = {
    invoiceNumberRef: null,
    packageCount: null,
    packageUnit: null,
    netWeightKg: null,
    grossWeightKg: null,
    marksAndNumbers: null,
    lines: [],
    uncertainFields: [],
    ...over,
  } as PackingListExtract;
  return { fileName: 'PL.pdf', docType: 'packing_list', data, model: 'test' };
}

const at = (docs: ExtractedDoc[]) => mergeToDraft(docs, { today: '2026-07-01' }).shipment;
const flagsOf = (docs: ExtractedDoc[]) => mergeToDraft(docs, { today: '2026-07-01' }).flags;

describe('the carrier is not whoever issued the document', () => {
  it('reads the airline off the master air waybill prefix', () => {
    // ex_job1: the AWB says "Issuing Carrier's Agent: DSV AIR & SEA INC" — a
    // freight forwarder — while the MAWB 057 79606800 and the routing row
    // "CDG / AF / BOM / AF" both say Air France. Writing the forwarder into
    // CarrierName names the wrong carrier on the declaration.
    const shipment = at([
      invoice(),
      awb({ carrierIataPrefix: '057', issuingCarrierOrAgent: 'DSV AIR & SEA INC' }),
    ]);
    expect(shipment.shippingLineOrCarrier).toBe('AIR FRANCE');
  });

  it('decodes the prefix from the MAWB number when it is not returned separately', () => {
    // ex_job5's MAWB is 61854841905 -> prefix 618 -> Singapore Airlines.
    const shipment = at([invoice(), awb({ mawbNumber: '61854841905' })]);
    expect(shipment.shippingLineOrCarrier).toBe('SINGAPORE AIRLINES LTD.');
  });

  it('falls back to the stated carrier, loudly, when the prefix is unknown', () => {
    const docs = [invoice(), awb({ mawbNumber: '77712345678', operatingCarrier: 'SOME AIRLINE' })];
    expect(at(docs).shippingLineOrCarrier).toBe('SOME AIRLINE');
    expect(flagsOf(docs).some((f) => f.path === 'shipment.shippingLineOrCarrier')).toBe(true);
  });

  it('prefers the B/L carrier field over the prominent name on the form', () => {
    // ex_job6's carrier is only in the signature block, "INTERASIA LINES, LTD.
    // AS AGENT FOR THE CARRIER ...", while the letterhead names the shipper.
    const shipment = at([
      invoice(),
      bl({ carrierName: 'INTERASIA LINES', shippingLine: 'ASIA SHIGEN INTERNATIONAL' }),
    ]);
    expect(shipment.shippingLineOrCarrier).toBe('INTERASIA LINES');
  });
});

describe('vessel and voyage', () => {
  it('uses the document’s own boxes when it has them', () => {
    // liv_job1 prints "Vessel WAN HAI 515" and "Voyage No. W101" separately.
    const shipment = at([invoice(), bl({ vesselName: 'WAN HAI 515', voyageNo: 'W101' })]);
    expect(shipment.vesselOrFlight).toBe('WAN HAI 515');
    expect(shipment.voyageNo).toBe('W101');
  });

  it('splits a combined string only when it has to', () => {
    // ex_job2 prints one box: "WADI DUKA/02621/N".
    const shipment = at([invoice(), bl({ vesselVoyage: 'WADI DUKA/02621/N' })]);
    expect(shipment.vesselOrFlight).toBe('WADI DUKA/02621/N');
    expect(shipment.voyageNo).toBe('02621/N');
  });

  it('puts an air flight number in the voyage column, not the vessel one', () => {
    // There is no vessel on an air job, and FlightNo_VoyageNo was always blank
    // because the voyage split ran for sea only.
    const shipment = at([invoice(), awb({ flightNumber: 'AF331' })]);
    expect(shipment.voyageNo).toBe('AF331');
    expect(shipment.vesselOrFlight).toBeUndefined();
  });
});

describe('a house bill of lading is not the master', () => {
  it('fills only the house columns when no master exists', () => {
    const docs = [invoice(), bl({ blNumber: 'HBL999', isHouseBl: true })];
    const shipment = at(docs);
    expect(shipment.hblNo).toBe('HBL999');
    expect(shipment.blNo).toBeUndefined();
    expect(shipment.blDate).toBeUndefined();
    expect(flagsOf(docs).some((f) => f.path === 'shipment.blNo')).toBe(true);
  });

  it('fills the master columns from the master the house B/L quotes', () => {
    const shipment = at([
      invoice(),
      bl({
        blNumber: 'HBL999',
        isHouseBl: true,
        masterBlNumber: 'MBL123',
        masterBlDate: '2026-06-09',
      }),
    ]);
    expect(shipment.blNo).toBe('MBL123');
    expect(shipment.blDate).toBe('2026-06-09');
    expect(shipment.hblNo).toBe('HBL999');
  });

  it('keeps both when one bundled PDF yields a master and a house B/L', () => {
    // One attachment can now produce several documents, so both B/Ls of a
    // consol shipment can arrive from the same scan. Taking the first and
    // dropping the rest is how a master gets lost behind a house.
    const shipment = at([
      invoice(),
      bl({ blNumber: 'HBL999', isHouseBl: true }, 'bundle.pdf'),
      bl({ blNumber: 'MBL123', isHouseBl: false }, 'bundle.pdf'),
    ]);
    expect(shipment.blNo).toBe('MBL123');
    expect(shipment.hblNo).toBe('HBL999');
  });
});

describe('dates', () => {
  it('prefers the shipped-on-board date over the date of issue', () => {
    const shipment = at([
      invoice(),
      bl({ shippedOnBoardDate: '2026-06-12', issueDate: '2026-06-15', blDate: '2026-06-15' }),
    ]);
    expect(shipment.blDate).toBe('2026-06-12');
  });

  it('says which date it used when the two differ', () => {
    // ex_job2's B/L prints 15-Jun as issued and the checklist files 18-Jun;
    // ex_job6 prints 14-Jul and the checklist files 30-Jun. Whichever we take,
    // the operator has to be able to see it.
    const flags = flagsOf([
      invoice(),
      bl({ shippedOnBoardDate: '2026-06-12', issueDate: '2026-06-15' }),
    ]);
    expect(flags.some((f) => f.path === 'shipment.blDate')).toBe(true);
  });

  it('dates a house air waybill independently of its master', () => {
    const shipment = at([
      invoice(),
      awb({ mawbNumber: '05779606800', hawbNumber: 'BOS0121016', awbDate: '2026-06-30', hawbDate: '2026-07-01' }),
    ]);
    expect(shipment.mawbDate).toBe('2026-06-30');
    expect(shipment.hawbDate).toBe('2026-07-01');
  });
});

describe('packages come from whichever document states them', () => {
  it('takes the count off the packing list when the B/L states none', () => {
    const shipment = at([
      invoice(),
      bl(),
      packingList({ packageCount: 3960, packageUnit: 'BAGS' }),
    ]);
    expect(shipment.packageCount).toBe(3960);
    expect(shipment.packageUnit).toBe('BAGS');
  });

  it('warns when the package count looks like a container count', () => {
    // liv_job1's B/L prints "Total No. of Pkgs/Cntrs 0004 CNTR" next to cargo
    // of 4000 BAG(S). Four is a true number on the document and a false
    // package count, and the BE would declare four bags.
    const docs = [invoice(), bl({ packageCount: 4, containerCount: 4 })];
    expect(flagsOf(docs).some((f) => f.path === 'shipment.packageCount')).toBe(true);
  });

  it('does not assume pallets on an air job', () => {
    // Neither golden air waybill prints a package kind, yet one job filed PLT
    // and the other PKG. The old code hardcoded PLT for every air job.
    const shipment = at([invoice(), awb({ pieces: 20 })]);
    expect(shipment.packageCount).toBe(20);
    expect(shipment.packageUnit).toBeUndefined();
  });
});

describe('weights', () => {
  it('reads KGM as kilograms', () => {
    // ex_job6's B/L prints "157,703.000 KGM" — the UN/ECE code — beside a
    // volume in MTQ.
    const shipment = at([
      invoice(),
      bl({ grossWeightKg: 157703, grossWeightUnitAsPrinted: 'KGM' }),
    ]);
    expect(shipment.grossWeightKg).toBe(157703);
    expect(shipment.weightUnitCode).toBe('KGS');
  });

  it('converts pounds rather than relabelling them', () => {
    const shipment = at([invoice(), bl({ grossWeightKg: 1000, grossWeightUnitAsPrinted: 'LBS' })]);
    expect(shipment.grossWeightKg).toBeCloseTo(453.59237, 4);
    expect(shipment.weightUnitCode).toBe('KGS');
  });

  it('refuses a volume as a weight', () => {
    // MTQ is cubic metres. Declaring it as a gross weight is a misdeclaration.
    const docs = [invoice(), bl({ grossWeightKg: 270, grossWeightUnitAsPrinted: 'MTQ' })];
    expect(at(docs).grossWeightKg).toBeUndefined();
    expect(flagsOf(docs).some((f) => f.path === 'shipment.grossWeightKg')).toBe(true);
  });

  it('finds net weight on the packing list when the B/L has none', () => {
    // ex_job6's 156,450 kg net is on the attached list, not the B/L face.
    const shipment = at([invoice(), bl({ grossWeightKg: 157703 }), packingList({ netWeightKg: 156450 })]);
    expect(shipment.netWeightKg).toBe(156450);
  });

  it('names both documents when they disagree', () => {
    // Well outside the 2% tolerance `nearlyEqual` allows for rounding between
    // documents — 100400 against 99000 is a printing difference, not a dispute.
    const docs = [
      invoice(),
      bl({ grossWeightKg: 100400 }),
      packingList({ grossWeightKg: 76032 }),
    ];
    const flag = flagsOf(docs).find((f) => f.path === 'shipment.grossWeightKg');
    expect(flag).toBeDefined();
    expect(flag!.message).toContain('BL.pdf');
    expect(flag!.message).toContain('PL.pdf');
  });

  it('does not let a zero outrank a real figure', () => {
    // liv_job1's B/L returns netWeightKg 0 and the packing list states 100000.
    // Zero is not a net weight of nothing; it is a document that did not say.
    const shipment = at([
      invoice(),
      bl({ grossWeightKg: 100400, netWeightKg: 0 }),
      packingList({ netWeightKg: 100000 }),
    ]);
    expect(shipment.netWeightKg).toBe(100000);
  });

  it('flags a net weight larger than the gross', () => {
    const docs = [invoice(), bl({ grossWeightKg: 1000, netWeightKg: 2000 })];
    expect(flagsOf(docs).some((f) => f.path === 'shipment.netWeightKg')).toBe(true);
  });
});

describe('a reading that cannot be true', () => {
  it('loses the net weight to one that can', () => {
    // ex_job25's invoice states its net weight three times — 49,500,000 kg once
    // and 49,500 kg twice — against a gross of 50,688 kg. Precedence alone
    // filed 49,500 tonnes of polypropylene in two containers, with a flag
    // saying one of the two was misread.
    const shipment = at([
      invoice(),
      bl({ netWeightKg: 49500000, grossWeightKg: 50688 }),
      packingList({ netWeightKg: 49500 }),
    ]);
    expect(shipment.netWeightKg).toBe(49500);
    expect(shipment.grossWeightKg).toBe(50688);
  });

  it('still wins when every reading is impossible, because then the check is what is wrong', () => {
    const shipment = at([invoice(), bl({ netWeightKg: 60000, grossWeightKg: 50688 })]);
    expect(shipment.netWeightKg).toBe(60000);
  });
});

describe('Marks & Nos', () => {
  it('prints the master waybill, a dotted rule, then the house one on air', () => {
    // Both golden air checklists print exactly this, over three lines:
    //   05779606800 / ................ / BOS0121016
    const shipment = at([
      invoice(),
      awb({ mawbNumber: '05779606800', hawbNumber: 'BOS0121016' }),
    ]);
    expect(shipment.marksAndNos).toBe('05779606800\n................\nBOS0121016');
  });

  it('prints the master alone when there is no house waybill', () => {
    const shipment = at([invoice(), awb({ mawbNumber: '05779606800' })]);
    expect(shipment.marksAndNos).toBe('05779606800');
  });

  it('writes AS PER BL on a sea job, and says what the B/L printed', () => {
    const docs = [invoice(), bl({ marksAndNumbers: 'FCIU8973026 CS:A844894' })];
    expect(at(docs).marksAndNos).toBe('AS PER BL');
    expect(flagsOf(docs).some((f) => f.path === 'shipment.marksAndNos')).toBe(true);
  });
});

describe('a placeholder is not a document number', () => {
  it('refuses the literal text a model returns instead of null', () => {
    // A live eval run put "/null" into a house air waybill number, which then
    // reached Marks & Nos. "Return null when absent" is an instruction a model
    // can follow in the wrong register.
    const shipment = at([invoice(), awb({ mawbNumber: '61854841905', hawbNumber: '/null' })]);
    expect(shipment.hawbNo).toBeUndefined();
    expect(shipment.marksAndNos).toBe('61854841905');
  });

  it('refuses the placeholders a person writes', () => {
    for (const placeholder of ['N/A', 'NIL', '-', 'None', 'not applicable']) {
      const shipment = at([invoice(), bl({ blNumber: placeholder })]);
      expect(shipment.blNo, placeholder).toBeUndefined();
    }
  });

  it('refuses one in a party name, and falls through to the next document', () => {
    // A corpus run returned ">null" as the consignee on a bill of lading. The
    // guard covered document numbers only, so it reached `importer.name` — the
    // field the organization repository is searched on, which then matched
    // nothing and left the Bill of Entry with no GSTIN, no AD code and no IEC.
    const base = invoice().data as InvoiceExtract;
    const withBuyer: ExtractedDoc = {
      fileName: 'INV.pdf',
      docType: 'invoice',
      model: 'test',
      data: {
        ...base,
        invoices: [{ ...base, buyerName: 'SKI PLASTOWARE PRIVATE LIMITED', isExportInvoice: false }],
      } as unknown as InvoiceExtract,
    };
    const draft = mergeToDraft([withBuyer, bl({ consigneeName: '>null' })], { today: '2026-07-01' });
    expect(draft.importer.name).toBe('SKI PLASTOWARE PRIVATE LIMITED');
  });

  it('refuses one in the place of delivery, so no station is resolved from it', () => {
    // `placeOfDelivery` decides whether the consignment is filed as Land at an
    // ICD, and it is the place an operator is offered as the custom house. A
    // placeholder sitting there is worse than an empty field: it looks answered.
    const draft = mergeToDraft(
      [invoice(), bl({ placeOfDelivery: '>null', portOfDischarge: 'NHAVA SHEVA, INDIA' })],
      { today: '2026-07-01' },
    );
    expect(draft.shipment.placeOfDelivery).toBeUndefined();
    expect(draft.shipment.portOfDischarge).toBe('NHAVA SHEVA, INDIA');
  });
});

describe('the station the transport document implies', () => {
  it('reads a repeated place as the port, not the ICD of the same name', () => {
    // ex_job13's bill of lading prints KOLKATA in both the discharge and the
    // delivery box. Kolkata names a sea port, an air cargo complex and an ICD,
    // so the word alone resolved to nothing and the job had no custom house.
    // Repeated, it means the consignment stops at the port.
    const draft = mergeToDraft(
      [invoice(), bl({ placeOfDelivery: 'KOLKATA', portOfDischarge: 'KOLKATA' })],
      { today: '2026-07-01' },
    );
    expect(draft.transportMode).toBe('Sea');
    expect(
      draft.flags.some((f) => f.message.includes('INCCU1')),
    ).toBe(true);
  });

  it('still treats an inland delivery as inland', () => {
    const draft = mergeToDraft(
      [invoice(), bl({ placeOfDelivery: 'ICD TUMB', portOfDischarge: 'NHAVA SHEVA' })],
      { today: '2026-07-01' },
    );
    expect(draft.transportMode).toBe('Land');
  });
});

describe('an air waybill names the station too', () => {
  it('carries the airport of destination onto the draft', () => {
    // It was extracted and dropped, so an air job reached the header with no
    // place to resolve a custom house from and the export refused for want of
    // a station that was printed on the document all along.
    const draft = mergeToDraft([invoice(), awb({ airportOfDestination: 'BOMBAY, INDIA' })], {
      today: '2026-07-01',
    });
    expect(draft.shipment.airportOfDestination).toBe('BOMBAY, INDIA');
  });
});

describe('reference numbers', () => {
  it('points out the other numbers a bill of lading carries', () => {
    // ex_job2 prints BOOKING NO ESLKEMBFL2000990, an illegible BL No. box, and
    // AGENCY REF NO EMIVKEMBFL200846 — and Logi-Sys filed the agency ref.
    const docs = [
      invoice(),
      bl({
        blNumber: 'ESLKEMBFL2000990',
        bookingNumber: 'ESLKEMBFL2000990',
        agencyReferenceNumber: 'EMIVKEMBFL200846',
      }),
    ];
    const flag = flagsOf(docs).find(
      (f) => f.path === 'shipment.blNo' && f.message.includes('EMIVKEMBFL200846'),
    );
    expect(flag).toBeDefined();
  });
});

describe('containers', () => {
  it('takes containers from every bill of lading, not just the master', () => {
    // The failure this exists to stop: a job carrying a master B/L and a house
    // B/L took its container list from whichever one won, and the other's boxes
    // were discarded. A Bill of Entry declaring one of four is a wrong filing.
    const shipment = at([
      invoice(),
      bl({ containers: [{ number: 'CAIU3686895', sizeType: '20GP', sealNo: 'QIN2410658' }] }),
      bl(
        {
          isHouseBl: true,
          blNumber: 'HBL0001',
          containers: [
            { number: 'CAIU3686895', sizeType: '20GP', sealNo: 'QIN2410658' },
            { number: 'CAIU3772397', sizeType: '20GP', sealNo: 'QIN2509082' },
            { number: 'SEGU1294439', sizeType: '20GP', sealNo: 'QIN2410652' },
            { number: 'TGBU3711543', sizeType: '20GP', sealNo: 'QIN2509085' },
          ],
        },
        'HBL.pdf',
      ),
    ]);
    expect(shipment.containers.map((c) => c.number)).toEqual([
      'CAIU3686895',
      'CAIU3772397',
      'SEGU1294439',
      'TGBU3711543',
    ]);
  });

  it('keeps the reading that carries the seal and the size', () => {
    const shipment = at([
      invoice(),
      bl({ containers: [{ number: 'CAIU 3686895', sizeType: null, sealNo: null }] }),
      bl(
        {
          isHouseBl: true,
          containers: [{ number: 'CAIU3686895', sizeType: '20GP', sealNo: 'QIN2410658' }],
        },
        'HBL.pdf',
      ),
    ]);
    expect(shipment.containers).toHaveLength(1);
    expect(shipment.containers[0]?.sealNo).toBe('QIN2410658');
    expect(shipment.containers[0]?.sizeType).toBe('20GP');
  });

  it('says so when the B/L states more containers than were read', () => {
    // ex_job6: "SAY : SIX CONTAINERS ONLY" against a list of one.
    const docs = [
      invoice(),
      bl({ containerCount: 6, containers: [{ number: 'IAAU1141498', sizeType: '40SD96', sealNo: null }] }),
    ];
    const draft = mergeToDraft(docs, { today: '2026-07-01' });
    expect(draft.shipment.containerCountStated).toBe(6);
    const flag = draft.flags.find((f) => f.path === 'shipment.containers');
    expect(flag?.message).toContain('states 6 containers');
  });

  it('carries each box\'s packages and gross weight onto the draft', () => {
    // CONTAINERS.PackagesStuffed and GrWt were on the sheet, on the draft and
    // in the golden fixture, and nothing in the live path filled them — so
    // every real export wrote the mapper's fallback 0 while Logi-Sys' own file
    // for ex_job6 carried 1,043 cartons and 26,284 kg per box.
    const shipment = at([
      invoice(),
      bl({
        containers: [
          { number: 'IAAU1141498', sizeType: '40SD96', sealNo: 'IAAH479523', packagesStuffed: 1043, grossWeightKg: 26284 },
          { number: 'IAAU1730986', sizeType: '40SD96', sealNo: 'IAAH479538', packagesStuffed: 1043, grossWeightKg: 26284 },
        ],
      }),
    ]);
    expect(shipment.containers.map((c) => c.packagesStuffed)).toEqual([1043, 1043]);
    expect(shipment.containers.map((c) => c.grossWeightKg)).toEqual([26284, 26284]);
  });

  it('keeps a container whose check digit fails, and flags it', () => {
    // Dropping it would be this path reintroducing its own bug: a box the
    // system declines to carry is a box missing from the Bill of Entry.
    const docs = [
      invoice(),
      bl({ containers: [{ number: 'IAAU1141499', sizeType: null, sealNo: null }] }),
    ];
    const draft = mergeToDraft(docs, { today: '2026-07-01' });
    expect(draft.shipment.containers.map((c) => c.number)).toEqual(['IAAU1141499']);
    expect(
      draft.flags.some(
        (f) => f.path === 'shipment.containers' && f.message.includes('check digit'),
      ),
    ).toBe(true);
  });
});


describe('a line that does not multiply out', () => {
  it('derives the unit price from the amount, as Logi-Sys does', () => {
    // ex_job21: 17,600 KGS at a printed 185 against a line amount of 14,800.
    // The exporter refuses a line whose numbers disagree, so the job could not
    // be filed at all — and Logi-Sys' own export of that job carries
    // 0.840909, which is 14,800 ÷ 17,600.
    const base = invoice().data as InvoiceExtract;
    const withLine: ExtractedDoc = {
      fileName: 'INV.pdf',
      docType: 'invoice',
      model: 'test',
      data: {
        ...base,
        invoices: [
          {
            ...base,
            isExportInvoice: false,
            items: [
              {
                description: 'LUBRODAL F 827',
                hsCode: '34039900',
                quantity: 17600,
                unit: 'KGS',
                unitPrice: 185,
                amount: 14800,
                isCharge: false,
              },
            ],
          },
        ],
      } as unknown as InvoiceExtract,
    };
    const draft = mergeToDraft([withLine, bl()], { today: '2026-07-01' });
    expect(draft.items[0]!.quantity).toBe(17600);
    expect(draft.items[0]!.unitPrice).toBeCloseTo(0.840909, 6);
    expect(draft.flags.some((f) => f.path === 'items.0.unitPrice')).toBe(true);
  });

  it('leaves a line that reconciles alone', () => {
    const base = invoice().data as InvoiceExtract;
    const ok: ExtractedDoc = {
      fileName: 'INV.pdf',
      docType: 'invoice',
      model: 'test',
      data: {
        ...base,
        invoices: [
          {
            ...base,
            isExportInvoice: false,
            items: [
              { description: 'X', hsCode: '34039900', quantity: 100, unit: 'KGS', unitPrice: 2.5, amount: 250, isCharge: false },
            ],
          },
        ],
      } as unknown as InvoiceExtract,
    };
    const draft = mergeToDraft([ok, bl()], { today: '2026-07-01' });
    expect(draft.items[0]!.unitPrice).toBe(2.5);
  });
});
