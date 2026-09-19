import type { ChecklistDraft } from '@checklist/extraction';

/**
 * Golden fixture: job EP061126-1, filed by Logi-Sys as I-13844/26-27.
 *
 * Sea import of polypropylene granules from Yokohama to Nhava Sheva for Elite
 * Polyplus, six 40' containers, claiming India-Japan CEPA. Every value below is
 * transcribed from the documents in `ex_job6/`:
 *
 *   - `Import CheckList-I-1384426-27-08-AUG-2026_12_14_PM.pdf` — what Logi-Sys
 *     itself produced for this job, and therefore the authority on what the
 *     import should have contained
 *   - `COPY BL EP061126-1.pdf` — B/L A07GX14312, vessel, containers and seals
 *   - `INV EP061126-1.pdf` — invoice value, unit price, terms
 *   - `PL EP061126-1.pdf` — per-container bag counts and weights
 *   - `EPA EP061126-1.pdf` — the CEPA certificate of origin
 *
 * This is a TypeScript literal rather than JSON on purpose: the compiler then
 * keeps it a valid `ChecklistDraft` as the type evolves, so a field added for
 * the exporter shows up here as a type error rather than as a silently missing
 * value.
 *
 * The job was originally keyed into the Logi-Sys template by hand and rejected.
 * The golden test asserts the corrected values, so each of those mistakes has a
 * test that fails if the exporter reintroduces it.
 */
export const EP061126_1_DRAFT: ChecklistDraft = {
  tenantId: 'kuberr',
  transportMode: 'Sea',
  beType: 'Home Consumption',
  customStation: { code: 'INNSA1', name: 'Nhava Sheva Sea' },
  filingStatus: 'Advance',

  // The resolved Bill of Entry header. Every value here is one the exporter
  // refuses to invent: the custom house is the customer's instruction, the
  // filing status follows from an IGM that had not been filed when this job was
  // read, and the importer reference is the one the customer asked us to carry.
  // The Logi-Sys checklist for this job prints all five, which is what makes
  // them assertable.
  boe: {
    transportMode: { value: 'Sea', source: 'document' },
    customStation: {
      value: { code: 'INNSA1', name: 'Nhava Sheva Sea' },
      source: 'mail',
      because: 'Named in the customer’s instructions',
    },
    beType: { value: 'Home Consumption', source: 'mail' },
    dutyPaymentStatus: { value: 'T', source: 'default', because: 'Duty paid per transaction' },
    filingStatus: {
      value: 'Advance',
      source: 'operator',
      because: 'No IGM filed against this BL',
    },
    adCode: { value: '0510226', source: 'master' },
    importerRefNo: { value: 'EP061126-1', source: 'operator' },
    flags: {},
  },

  importer: {
    name: 'M/S. ELITE POLYPLUS',
    addressLines: [
      '707 HUBTOWN SOLARIS',
      'NS PHADKE MARG, OPP TELI GALI',
      'MUMBAI',
    ],
    iec: 'AAJFE0052B',
    pan: 'AAJFE0052B',
    gstin: '27AAJFE0052B1Z1',
    gstStateCode: '27',
    gstStateName: 'MAHARASHTRA',
    // Leading zero is significant: the checklist prints "0510226 AD Code".
    // Keyed by hand this became 510226, which is a different bank branch.
    adCode: '0510226',
    branchSno: '0',
    matchedFromMasters: false,
  },

  supplier: {
    name: 'ASIA SHIGEN INTERNATIONAL CO., LTD',
    addressLines: [
      '34-15-503, MOTOHAMA-CHO, CHUO KU,',
      'HAMAMATSU SHI, SHIZUOKA KEN, 430-0942',
    ],
    city: 'Shizuoka',
    country: 'Japan',
  },

  shipment: {
    blNo: 'A07GX14312',
    // The B/L date, not the filing date. The manual attempt wrote today's
    // date here as a raw Excel serial.
    blDate: '2026-06-30',
    vesselOrFlight: 'INTERASIA TENACITY S022',
    voyageNo: 'S022',
    shippingLineOrCarrier: 'INTERASIA LINES',
    portOfLoading: 'Yokohama(JPYOK)',
    consCountry: 'Japan',
    countryOfOrigin: 'Japan',
    packageCount: 6258,
    packageUnit: 'BAG',
    grossWeightKg: 157703,
    netWeightKg: 156450,
    marksAndNos: 'AS PER BL',
    // Six containers. The manual attempt carried only the last one.
    containers: [
      { number: 'IAAU1730986', sizeType: '40SD96', sealNo: 'IAAH479538', packagesStuffed: 1043, grossWeightKg: 26284 },
      { number: 'IAAU1868002', sizeType: '40SD96', sealNo: 'IAAH479537', packagesStuffed: 1043, grossWeightKg: 26284 },
      { number: 'IAAU1947945', sizeType: '40SD96', sealNo: 'IAAH479581', packagesStuffed: 1043, grossWeightKg: 26283 },
      { number: 'IAAU1957028', sizeType: '40SD96', sealNo: 'IAAH498433', packagesStuffed: 1043, grossWeightKg: 26284 },
      { number: 'IAAU1818697', sizeType: '40SD96', sealNo: 'IAAH479522', packagesStuffed: 1043, grossWeightKg: 26284 },
      { number: 'IAAU1141498', sizeType: '40SD96', sealNo: 'IAAH479523', packagesStuffed: 1043, grossWeightKg: 26284 },
    ],
  },

  invoiceMeta: {
    exchangeRates: { USD: 96.05 },
  },

  invoices: [
    {
      srNo: 1,
      invoiceNumber: 'ASI-EP061126-1',
      invoiceDate: '2026-06-30',
      // The invoice reads "MT CNF NHAVASHEVA" — cost and freight, no insurance.
      // Keyed by hand this became CIF, which would have folded a non-existent
      // insurance cost into the assessable value.
      termsOfInvoice: 'C&F',
      currency: 'USD',
      invoiceValue: 188924.33,
      // Notional 1.125%, as the checklist shows (204144.55 INR).
      insurance: { kind: 'percent', percent: 1.125 },
      paymentMethod: 'Transaction',
      natureOfTransaction: 'Sale',
      relatedParty: false,
    },
  ],

  items: [
    {
      slNo: 1,
      invoiceSrNo: 1,
      description: 'PP GRANULES (POLYPROPYLENE)',
      // The invoice prints "HS CODE : 3902.10"; the BE wants 8 digits.
      ritc: '39021000',
      // The invoice states 156.450 MT at USD 1,207.57/MT. The BE states the
      // same value in KGS, so both quantity and unit price are rescaled.
      quantity: 156450,
      unit: 'KGS',
      unitPrice: 1.20757,
      amount: 188924.33,
      bcdRate: 7.5,
      // 0% actually paid, under India-Japan CEPA.
      bcdExemption: { notification: '069/2011', serial: '295', percent: 100, scheme: 'India-Japan CEPA' },
      swsRate: 10,
      igstRate: 18,
      igstNotification: '009/2025',
      aidcRate: 0,
      aidcNotification: '011/2021',
      compCessRate: 0,
      compCessNotification: '001/2017',
      notificationSerials: { basic: '295', igst: 'II114', aidc: '19', compCess: '56' },
      generalDescription: 'PP PELLET (POLYPROPYLENE)',
      brand: 'UNBRANDED',
      model: 'NA',
      originCountry: 'Japan',
      manufacturerName: 'ASIA SHIGEN INTERNATIONAL CO., LTD',
      manufacturerAddress: '222-25-302, MOTOSHIRO-CHO, NAKA-KU, HAMAMATSU-CITY, SHIZUOKA',
      manufacturerCountry: 'Japan',
      endUseCode: 'GNX100',
    },
  ],

  ftaClaim: {
    scheme: 'India-Japan CEPA',
    cooNumber: '250377141204202410',
    cooDate: '2025-09-09',
    countryOfIssue: 'Japan',
    originCriterion: 'CTH',
    directConsignment: true,
    retroactiveIssuance: false,
  },

  singleWindowInfo: [
    { itemSlNo: 1, infoType: 'Item Characteristics', qualifier: 'Standard UQC', measurement: 156450, unit: 'KGS' },
    { itemSlNo: 1, infoType: 'Item Category', qualifier: 'Chemical Category (CPC)', code: 'CPCPR' },
    { itemSlNo: 1, infoType: 'Item Identification', qualifier: 'Chemical Abstract Service registration number.', information: '9003-07-0' },
    { itemSlNo: 1, infoType: 'Product Name', qualifier: 'Name as per the IUPAC Nomenclature', information: 'POLYPROPYLENE' },
  ],

  supportingDocs: [
    { fileName: 'COPY BL EP061126-1.pdf', docType: 'bill_of_lading' },
    { fileName: 'EPA EP061126-1.pdf', docType: 'certificate_of_origin' },
    { fileName: 'INV EP061126-1.pdf', docType: 'invoice' },
    { fileName: 'PL EP061126-1.pdf', docType: 'packing_list' },
  ],

  declarations: [],

  // The duty engine's output is not needed by any template column — the Bill
  // of Entry computes duty itself from the values we send.
  duty: null,

  fieldMeta: {},
  flags: [],
};

/** The job record that accompanies the draft on export. */
export const EP061126_1_JOB = { id: 'ep061126-1', reference: 'EP061126-1' };
