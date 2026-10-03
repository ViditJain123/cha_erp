import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aidcLevyFor,
  compCessForCth,
  compCessMatches,
  computeBeDuty,
  igstRateForCth,
  tradeRemedyEntries,
  type InvoiceInput,
  type ItemInput,
} from '../src/index.js';

/**
 * The duty engine against what Customs actually assessed.
 *
 * Each fixture is a processed Bill of Entry — ICES' own assessed copy — read by
 * scripts/build-processed-be-fixtures.py: per item, the assessable value ICES
 * arrived at and every duty it charged, with the notification, serial and rate
 * it applied. Our checklist is a prediction of exactly this document.
 *
 * Two layers are tested:
 *
 *  - **The engine.** Fed the invoice and the rates ICES applied, `computeBeDuty`
 *    must reproduce ICES' assessable value to the paisa and every duty amount
 *    as ICES prints it.
 *  - **The masters.** For the serials ICES filed, our masters must name the
 *    same serial at the same rate for the code and date.
 *
 * The BE prints outcomes, not claims, so how each consignment claimed its
 * relief is stated below from its Part IV (F. licence, G. scheme and duty
 * foregone). That is the one thing a person supplies here.
 */

interface Duty {
  notification?: string;
  serial?: string;
  rate?: number;
  amount?: number;
  foregone?: number;
}
interface BeItem {
  invoice: number;
  item: number;
  cth: string;
  origin: string;
  quantity: number;
  uqc: string;
  unitPrice: number;
  assessableValue: number;
  totalDuty: number;
  duties: Record<string, Duty>;
}
interface BeInvoice {
  sno: number;
  invoiceValue: number;
  currency: string;
  terms: string;
  assessableValue: number;
  hss?: string;
  items: { sno: number; cth: string; unitPrice: number; quantity: number; uqc: string; amount: number }[];
}
interface Bill {
  folder: string;
  job: string;
  be: { port: string; number: string; date: string; type: 'H' | 'W' | 'X' };
  exchangeRates: Record<string, number>;
  invoices: BeInvoice[];
  items: BeItem[];
}

const bills: Bill[] = JSON.parse(
  readFileSync(new URL('./fixtures/processed-be.json', import.meta.url), 'utf8'),
).bills;

/** How each consignment claimed relief, from its Part IV. */
type Claim =
  | { kind: 'none' }
  /** An export-promotion scheme: BCD foregone, IGST exempt (licence debited). */
  | { kind: 'scheme'; notification: string; why: string }
  /**
   * RoDTEP scrip: BCD is charged in full and debited from the scrip; SWS and
   * IGST are charged in cash on top of it. A way of paying BCD, not an
   * exemption — so the cash duty is the engine's total less its BCD.
   */
  | { kind: 'rodtep'; debited: number };

const CLAIMS: Record<string, Claim> = {
  ex_job12: { kind: 'none' },
  ex_job13: { kind: 'scheme', notification: '026/2023', why: 'EPCG, licence code 12' },
  ex_job14: { kind: 'scheme', notification: '021/2023', why: 'Advance Authorisation, licence code 03' },
  ex_job15: { kind: 'rodtep', debited: 2_414_430 },
  ex_job16: { kind: 'scheme', notification: '052/2003', why: 'EOU, 52/2003 S.No. I-7, BCD foregone' },
  ex_job17: { kind: 'none' },
  ex_job23: { kind: 'rodtep', debited: 65_508.8 },
  ex_job31: { kind: 'none' },
};

/**
 * Anti-dumping rates the trade-remedies master does not hold, with where each
 * number came from. 16/2025-Customs (ADD), acetonitrile from China, is a
 * scanned notification whose duty table the build could not read
 * (trade-remedies.REPORT.md); 202 USD per tonne is what ex_job17 was assessed
 * at — ₹4,47,024.40 on 23.04 t at 96.05 — and is checked against the master
 * below so the gap closes loudly when the table is read.
 */
const ADD_NOT_IN_MASTERS: Record<string, { amountPerUnit: number; currency: string; unit: 'MT' }> = {
  '016/2025': { amountPerUnit: 202, currency: 'USD', unit: 'MT' },
};

/**
 * A high-sea-sale loading is a percentage of the invoice value. The engine
 * takes charges as amounts, so the percentage is turned into one here.
 */
function hssCharge(invoice: BeInvoice): InvoiceInput['miscCharges'] {
  if (!invoice.hss) return undefined;
  const percent = Number(invoice.hss.replace('%', ''));
  return { amount: (invoice.invoiceValue * percent) / 100, currency: invoice.currency };
}

function itemInput(bill: Bill, inv: BeInvoice, line: BeInvoice['items'][number]): ItemInput {
  const be = bill.items.find((i) => i.invoice === inv.sno && i.item === line.sno)!;
  const claim = CLAIMS[bill.folder]!;
  const d = be.duties;
  const add = d.ADD;
  const fromMaster = add
    ? tradeRemedyEntries().find((e) => (e.notificationShort ?? e.notification) === add.notification && e.kind === 'ADD')
    : undefined;
  const addEntry = add
    ? fromMaster
      ? { amountPerUnit: fromMaster.amount!, currency: fromMaster.currency!, unit: fromMaster.unit }
      : ADD_NOT_IN_MASTERS[add.notification!]
    : undefined;
  return {
    slNo: line.sno,
    description: be.cth,
    ritc: be.cth,
    quantity: line.quantity,
    unit: line.uqc,
    unitPrice: line.unitPrice,
    bcdRate: d.BCD?.rate ?? 0,
    swsRate: d.SWS?.rate ?? 10,
    igstRate: d.IGST?.rate ?? 0,
    ...(claim.kind === 'scheme' && {
      bcdExemption: { notification: claim.notification, percent: 100, kind: 'scheme' as const },
      igstExemption: { notification: claim.notification, percent: 100 },
    }),
    ...(addEntry && {
      tradeRemedies: [
        {
          kind: 'ADD' as const,
          amountPerUnit: addEntry.amountPerUnit,
          currency: addEntry.currency,
          // The notification's unit is the tonne; the invoice counts kilograms.
          quantity: addEntry.unit === 'MT' && line.uqc === 'KGS' ? line.quantity / 1000 : line.quantity,
        },
      ],
    }),
  };
}

function invoiceInput(bill: Bill, inv: BeInvoice): InvoiceInput {
  const misc = hssCharge(inv);
  return {
    invoiceNumber: String(inv.sno),
    invoiceDate: bill.be.date,
    termsOfInvoice: inv.terms as InvoiceInput['termsOfInvoice'],
    currency: inv.currency,
    invoiceValue: inv.invoiceValue,
    ...(misc && { miscCharges: misc }),
    items: inv.items.map((line) => itemInput(bill, inv, line)),
  };
}

describe('the duty engine against assessed Bills of Entry', () => {
  it('has a claim stated for every processed BE in the corpus', () => {
    expect(bills.length).toBe(8);
    for (const bill of bills) expect(CLAIMS[bill.folder], bill.folder).toBeDefined();
  });

  for (const bill of bills) {
    const claim = CLAIMS[bill.folder]!;
    describe(`${bill.folder} ${bill.job} — BE ${bill.be.number} (${bill.be.type}), ${claim.kind}`, () => {
      const result = computeBeDuty(
        bill.invoices.map((inv) => invoiceInput(bill, inv)),
        bill.exchangeRates,
      );
      // computeBeDuty numbers items across invoices in order.
      const ours = (be: BeItem) => {
        const index = bill.items.indexOf(be);
        return result.items[index]!;
      };

      for (const be of bill.items) {
        const label = `item ${be.invoice}/${be.item} ${be.cth}`;

        it(`${label}: assessable value ${be.assessableValue}`, () => {
          expect(ours(be).assessableValue).toBe(be.assessableValue);
        });

        it(`${label}: every duty as ICES assessed it`, () => {
          const a = ours(be).assessed;
          const d = be.duties;
          if (claim.kind === 'rodtep') {
            // BCD is the scrip debit, printed in section G; the BCD column is 0.
            expect(d.BCD?.amount ?? 0).toBe(0);
            expect(a.bcd).toBe(claim.debited);
          } else {
            expect(a.bcd).toBe(d.BCD?.amount ?? 0);
          }
          expect(a.sws).toBe(d.SWS?.amount ?? 0);
          expect(a.igst).toBe(d.IGST?.amount ?? 0);
          expect(a.antiDumping).toBe(d.ADD?.amount ?? 0);
          expect(a.compCess).toBe(d['G. CESS']?.amount ?? 0);
        });

        it(`${label}: total duty ${be.totalDuty}`, () => {
          const a = ours(be).assessed;
          // A scrip-paid BCD is not cash duty, and the BE's total leaves it out.
          const cash = claim.kind === 'rodtep' ? Math.round((a.totalDuty - a.bcd) * 10) / 10 : a.totalDuty;
          expect(cash).toBe(be.totalDuty);
        });
      }
    });
  }
});

describe('the masters name the serials ICES applied', () => {
  for (const bill of bills) {
    for (const be of bill.items) {
      const label = `${bill.folder} item ${be.invoice}/${be.item} ${be.cth} on ${bill.be.date}`;
      const igst = be.duties.IGST;

      // Only 9/2025-IT(R) is a rate schedule; a scheme's IGST notification is an exemption.
      if (igst?.notification === '009/2025') {
        it(`${label}: IGST ${igst.serial} at ${igst.rate}%`, () => {
          const r = igstRateForCth(be.cth, { onIsoDate: bill.be.date })!;
          expect(r.notification).toBe('009/2025');
          const serial = (e: typeof r.entry) => `${e.schedule}${e.serial}`;
          if (!r.alternatives.length) {
            // The code alone decides: the default must be ICES' answer.
            expect(serial(r.entry)).toBe(igst.serial);
            expect(r.rate).toBe(igst.rate);
          } else {
            // The description decides — 88022000 is I463 at 5%, or III9 at 28%
            // "for personal use" — so the default is the higher rate and the
            // masters owe the picker ICES' serial among the candidates.
            const hit = [r.entry, ...r.alternatives].find((e) => serial(e) === igst.serial);
            expect(hit, `offered ${[r.entry, ...r.alternatives].map(serial).join(', ')}`).toBeDefined();
            expect(hit!.rate).toBe(igst.rate);
          }
        });
      }

      const cess = be.duties['G. CESS'];
      if (cess?.notification === '001/2017') {
        it(`${label}: compensation cess ${cess.serial} is among the candidates`, () => {
          // The cess turns on the goods: aircraft "for personal use" are
          // S.No. 54 at 3%, ex_job31's training aircraft the residual 56. A
          // code cannot tell them apart, so what the masters owe the picker
          // is the right serial on the list, at the right rate.
          const residual = compCessForCth(be.cth)!;
          const offered = [...compCessMatches(be.cth), residual.entry];
          const hit = offered.find((e) => e.serial === cess.serial);
          expect(hit, `offered ${offered.map((e) => e.serial).join(', ')}`).toBeDefined();
          expect(hit!.rate ?? 0).toBe(cess.rate ?? 0);
        });
      }

      const aidc = be.duties.CAIDC;
      if (aidc?.notification === '011/2021' && CLAIMS[bill.folder]!.kind !== 'scheme') {
        it(`${label}: AIDC 011/2021 S.No. ${aidc.serial}`, () => {
          // AIDC can turn on the BCD exemption claimed, so pass the one ICES applied.
          const bcd = be.duties.BCD;
          const claim = bcd?.notification ? { notification: bcd.notification, ...(bcd.serial && { serial: bcd.serial }) } : undefined;
          const r = aidcLevyFor(be.cth, bill.be.date, claim)!;
          expect(r.serial).toBe(aidc.serial);
          expect(r.rate ?? 0).toBe(aidc.rate ?? 0);
        });
      }

      const add = be.duties.ADD;
      if (add?.notification && ADD_NOT_IN_MASTERS[add.notification]) {
        // Fails today on purpose: when the 16/2025 duty table is read into the
        // master, this starts passing and vitest says so — delete the override then.
        it.fails(`${label}: anti-dumping ${add.notification} is in the trade-remedies master`, () => {
          expect(tradeRemedyEntries().some((e) => (e.notificationShort ?? e.notification) === add.notification)).toBe(true);
        });
      }
    }
  }
});
