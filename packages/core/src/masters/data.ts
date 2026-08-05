/**
 * Global + tenant masters, seeded from the two reference jobs.
 * In production these move to Postgres tables (global vs tenant-scoped);
 * the lookup API in masters/index.ts is the stable interface.
 */

export interface PortMaster {
  code: string;
  name: string;
  mode: 'sea' | 'air' | 'icd';
}

export const PORTS: PortMaster[] = [
  { code: 'INBOM4', name: 'Sahar Air Cargo', mode: 'air' },
  { code: 'INNSA1', name: 'Nhava Sheva Sea', mode: 'sea' },
  { code: 'INBOM1', name: 'Mumbai Sea', mode: 'sea' },
  { code: 'INDEL4', name: 'Delhi Air Cargo', mode: 'air' },
  { code: 'INTKD6', name: 'Tughlakabad ICD', mode: 'icd' },
  { code: 'INMUN1', name: 'Mundra Sea', mode: 'sea' },
];

export interface TariffMaster {
  /** 8-digit CTH/RITC */
  cth: string;
  description: string;
  bcdRate: number;
  unit: string;
  igstRate: number;
  igstNotification: string;
  aidcRate: number;
  aidcNotification: string;
  compCessRate: number;
  compCessNotification: string;
  /** chapter-level flags for Single Window / PGA requirements */
  pga?: 'FSSAI' | 'CDSCO' | 'PQ' | 'AQ';
}

export const TARIFF: TariffMaster[] = [
  {
    cth: '34039900',
    description: 'Lubricating preparations — other',
    bcdRate: 7.5,
    unit: 'KGS',
    igstRate: 18,
    igstNotification: '009/2025',
    aidcRate: 0,
    aidcNotification: '011/2021',
    compCessRate: 0,
    compCessNotification: '001/2017',
  },
  {
    cth: '17021110',
    description: 'Lactose, containing >=99% lactose by weight',
    bcdRate: 25,
    unit: 'KGS',
    igstRate: 5,
    igstNotification: '009/2025',
    aidcRate: 0,
    aidcNotification: '011/2021',
    compCessRate: 0,
    compCessNotification: '001/2017',
    pga: 'FSSAI',
  },
];

export interface FtaSchemeMaster {
  scheme: string;
  /** Matching hints found on COO headings. */
  cooHeadingPattern: string;
  notification: string;
  serial: string;
  bcdExemptionPercent: number;
  /** ISO-ish country names this scheme covers (subset seeded). */
  countries: string[];
}

export const FTA_SCHEMES: FtaSchemeMaster[] = [
  {
    scheme: 'DFTP',
    cooHeadingPattern: 'Duty Free Tariff Preference',
    notification: '096/2008',
    serial: '(i)',
    bcdExemptionPercent: 100,
    countries: ['Uganda', 'Tanzania', 'Ethiopia', 'Rwanda', 'Malawi', 'Mozambique', 'Zambia', 'Benin'],
  },
];

export interface DeclarationMaster {
  code: string;
  text: string;
  /** When the code applies. */
  rule: 'always' | 'invoice' | 'fta' | 'chemical-no-cas' | 'food' | 'manual';
}

export const DECLARATIONS: DeclarationMaster[] = [
  {
    code: 'CUG00',
    rule: 'always',
    text: 'I/We declare that the contents of this Bill of Entry for goods imported against above mentioned Bill of Lading/ Airway Bill /Lorry Receipt/Railway Receipt numbers are in accordance with the above mentioned invoice(s) No(s)and other documents presented herewith.',
  },
  {
    code: 'CUG01',
    rule: 'always',
    text: 'I/We declare that the contents of the above mentioned invoice(s) and documents are true and correct in every respect.I/We have not received and do not know of any other documents or information showing a different description, quantity, price, value, of the said goods and that if at any time hereafter I/We discover any document / information showing different facts, I/We will immediately make the same known to the Commissioner of Customs.',
  },
  {
    code: 'CUV01',
    rule: 'invoice',
    text: 'I/We declare that all conditions or restrictions, if any, imposed by the seller of any third party on the disposition or use of the imported goods [as per proviso to Rule 3(2)) of the Customs Valuation Rules, 2007] are specified above.',
  },
  {
    code: 'CUV02',
    rule: 'invoice',
    text: 'I/We declare that the price paid or payable by the importer is as per the details provided above, and any price paid or payable in addition to the above will be settled with the seller at the end of a defined period by means of debit note / credit note (post – import price adjustment), which are as per the contract attached as a supporting document.',
  },
  {
    code: 'CUV03',
    rule: 'invoice',
    text: 'I/We declare that there are no payments actually paid or payable for the imported goods by way of cost and services [in terms of Rules 10(1)(a)(i), Rule 10(1)(a)(ii), Rule 10 (1) (a) (iii) and Rule 10 (1) (b) of Customs Valuation Rules, 2007], Royalty / Licence Fee / subsequent resale or use of goods /other payment as a condition of sale [(Please see Rule 10 (1) (c), (d) & (e) of Customs Valuation Rules, 2007] other than those declared in the invoice which are mentioned as miscellaneous charges in this Bill of Entry.',
  },
  {
    code: 'PC002',
    rule: 'chemical-no-cas',
    text: 'I certify that the information related to IUPAC & CAS number is not in my possession as the same is not provided by my supplier due to confidentiality',
  },
  {
    code: 'CUF02',
    rule: 'fta',
    text: 'I/We declare that these goods qualify as originating goods for preferential rate of duty under the Customs (Administration of Rules of Origin under Trade Agreements) Rules, 2020 notified vide Customs Notification No. 81/2020 - Customs (N.T.) dated 21.08.2020.',
  },
  {
    code: 'DC007',
    rule: 'food',
    text: 'I/We the importer of this consignment undertake that the drug/cosmetic packages seal for this item is intact, the packaging is not damaged/broken/destroyed and the content of drug/cosmetic has not deteriorated.',
  },
];

export interface ExchangeRateMaster {
  effectiveFrom: string; // ISO date
  rates: { [currency: string]: number };
}

/** CBIC customs exchange rates (ERAM). Refreshed fortnightly — Phase 2 automates this. */
export const EXCHANGE_RATES: ExchangeRateMaster[] = [
  {
    effectiveFrom: '2026-06-01',
    rates: { USD: 95.3, EUR: 103.15, GBP: 121.4, JPY: 0.6412, CNY: 13.25, AED: 26.1, SGD: 71.2, CHF: 105.9 },
  },
];

export interface ImporterMaster {
  name: string;
  /** Names as they appear on shipping docs, for matching. */
  aliases: string[];
  iec: string;
  pan: string;
  gstin: string;
  gstStateCode: string;
  gstStateName: string;
  adCode: string;
  branchSno: string;
  address: string[];
  city: string;
  state: string;
}

export const IMPORTERS: ImporterMaster[] = [
  {
    name: 'FUCHS LUBRICANTS (INDIA) PRIVATE LIMITED',
    aliases: ['FUCHS LUBRICANTS (INDIA) PVT. LTD.', 'FUCHS LUBRICANTS INDIA'],
    iec: '0394065816',
    pan: 'AABCB0983D',
    gstin: '27AABCB0983D1ZY',
    gstStateCode: '27',
    gstStateName: 'MAHARASHTRA',
    adCode: '6550001',
    branchSno: '8',
    address: ['PLOT N-69, ANAND NAGAR, AMBERNATH', 'ADDITIONAL MIDC'],
    city: 'Ambernath',
    state: 'Maharashtra',
  },
  {
    name: 'FRESHCARE INDUSTRIES PRIVATE LIMITED',
    aliases: ['FRESHCARE INDUSTRIES PVT LTD'],
    iec: 'AAFCF4316C',
    pan: 'AAFCF4316C',
    gstin: '07AAFCF4316C1Z3',
    gstStateCode: '07',
    gstStateName: 'DELHI',
    adCode: '6470051',
    branchSno: '0',
    address: ['C-724 F/F, NEW FRIENDS COLONY,', 'NEW DELHI,SOUTH EAST,DELHI - 110065'],
    city: 'New Delhi',
    state: 'Delhi',
  },
];

export interface ChaProfile {
  tenantId: string;
  name: string;
  licence: string;
  icegateId: string;
  address: string[];
}

export const CHA_PROFILE: ChaProfile = {
  tenantId: 'kuberr',
  name: 'KUBERR INDIA EXIM LLP',
  licence: 'AAPFK6460KCH001',
  icegateId: 'KUBERR007',
  address: [
    '302, K. P. Aurum, K.P. Engineering Compound,',
    'Marol Maroshi Rd, Marol, Andheri East,',
    'Mumbai, Maharashtra 400059',
  ],
};
