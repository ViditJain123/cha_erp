import { describe, expect, it } from 'vitest';
import type { DraftItem } from '../src/draft.js';
import { singleWindowRowsForItem } from '../src/single-window.js';

/**
 * The Single Window rows a line of goods carries, and the flags raised when it
 * cannot carry one it must.
 *
 * This is the seam the old defect lived in: the standard quantity was written
 * only `if (item.unit === 'KGS')`, so three of the fourteen filings in the
 * corpus would have gone to Customs with a quantity of zero and no unit.
 * Contract: docs/boe-mapping/11-sw-addl-info.md.
 */

function item(over: Partial<DraftItem> = {}): DraftItem {
  return {
    slNo: 1,
    invoiceSrNo: 1,
    description: 'POLYPROPYLENE GRANULES',
    ritc: '39021000',
    quantity: 59800,
    unit: 'KGS',
    unitPrice: 1.36,
    endUseCode: '',
    ...over,
  } as DraftItem;
}

const TODAY = '2026-09-18';

const qualifiers = (i: DraftItem) => singleWindowRowsForItem(i, TODAY).rows.map((r) => r.qualifier);
const messages = (i: DraftItem) => singleWindowRowsForItem(i, TODAY).flags.map((f) => f.message).join('\n');

describe('the standard-quantity row', () => {
  it('is on every line, whatever the chapter', () => {
    for (const ritc of ['27101979', '34039900', '48042100', '84051090', '88022000']) {
      expect(qualifiers(item({ ritc, quantity: 1, unit: 'NOS' }))).toContain('Standard UQC');
    }
  });

  it('states a kilogram line in kilograms', () => {
    const [row] = singleWindowRowsForItem(item(), TODAY).rows;
    expect(row).toMatchObject({ qualifier: 'Standard UQC', measurement: 59800, unit: 'KGS' });
  });

  /**
   * I-60133: invoiced 1 SET, assessed as 1 NOS. I-20271: invoiced 1 UNT on
   * each of four invoices, assessed as 1 NOS on each. Under the old rule both
   * filed 0.000000 with no unit.
   */
  it.each([
    ['84051090', 'SET'],
    ['88022000', 'UNT'],
  ])('renames a count for %s invoiced in %s', (ritc, unit) => {
    const [row] = singleWindowRowsForItem(item({ ritc, quantity: 1, unit }), TODAY).rows;
    expect(row).toMatchObject({ measurement: 1, unit: 'NOS' });
  });

  it('converts a line invoiced in tonnes', () => {
    const [row] = singleWindowRowsForItem(item({ quantity: 59.8, unit: 'MTS' }), TODAY).rows;
    expect(row).toMatchObject({ measurement: 59800, unit: 'KGS' });
  });

  /** The row is still written, so the operator can see what is missing. */
  it('raises an error and leaves the measure empty when it cannot convert', () => {
    const line = item({ ritc: '84051090', quantity: 500, unit: 'KGS' });
    const { rows, flags } = singleWindowRowsForItem(line, TODAY);
    expect(rows[0]).toMatchObject({ qualifier: 'Standard UQC' });
    expect(rows[0]!.measurement).toBeUndefined();
    expect(flags.some((f) => f.severity === 'error')).toBe(true);
    expect(messages(line)).toMatch(/493\/494/);
  });

  it('notes when the tariff unit differs from the invoice unit', () => {
    expect(messages(item({ ritc: '84051090', quantity: 1, unit: 'SET' }))).toMatch(
      /stated as 1 NOS .* against an invoice unit of SET/,
    );
  });
});

describe('the chemical declaration', () => {
  const chem = { category: 'CPCBB', casNumber: '9003-07-0', iupacName: 'POLYPROPYLENE' };

  it('writes the category, CAS and IUPAC rows on a chapter-39 line', () => {
    expect(qualifiers(item({ chemical: chem }))).toEqual([
      'Standard UQC',
      'Chemical Category (CPC)',
      'Chemical Abstract Service registration number.',
      'Name as per the IUPAC Nomenclature',
    ]);
  });

  it('writes nothing chemical on a line outside the circular scope', () => {
    expect(qualifiers(item({ ritc: '34039900', quantity: 17600 }))).toEqual(['Standard UQC']);
  });

  it('warns rather than inventing a category when nobody has chosen one', () => {
    expect(messages(item())).toMatch(/must declare a chemical category/);
    expect(qualifiers(item())).toEqual(['Standard UQC']);
  });

  /** Circular 23/2023 para 4.1(b): bulk and basic needs both. */
  it('warns when the declared category is not backed by what it obliges', () => {
    expect(messages(item({ chemical: { category: 'CPCBB', casNumber: '9003-07-0' } }))).toMatch(
      /Bulk and Basic Chemicals requires both/,
    );
  });

  /** `ex_job29` and `ex_job23` file CPCPR with neither, leaning on PC002. */
  it('accepts a proprietary category with only one of the two', () => {
    const line = item({ ritc: '39046990', chemical: { category: 'CPCPR', casNumber: '25213-24-5' } });
    expect(messages(line)).not.toMatch(/requires/);
  });

  it('holds back chemical particulars recorded against a CTH out of scope', () => {
    const line = item({ ritc: '84051090', quantity: 1, unit: 'SET', chemical: chem });
    expect(qualifiers(line)).toEqual(['Standard UQC']);
    expect(messages(line)).toMatch(/outside chapters 28\/29\/32\/39/);
  });
});

describe('the hazardous-cargo declaration', () => {
  /** ex_job17, CTH 29269090 — sl. 19 of Annexure-A. It filed N. */
  it('writes the answer a person gave', () => {
    const line = item({ ritc: '29269090', hazardous: false, chemical: { category: 'CPCPR', casNumber: '75-05-8' } });
    const row = singleWindowRowsForItem(line, TODAY).rows.find((r) => r.qualifier === 'Hazardous');
    expect(row).toMatchObject({ infoType: 'Item Characteristics', code: 'N' });
  });

  it('writes Y as readily as N', () => {
    const line = item({ ritc: '29171400', hazardous: true });
    expect(singleWindowRowsForItem(line, TODAY).rows.find((r) => r.qualifier === 'Hazardous')?.code).toBe('Y');
  });

  /** The Y/N is the importer's declaration; a default would be us making it. */
  it('asks rather than answers when nobody has', () => {
    const line = item({ ritc: '29269090' });
    expect(qualifiers(line)).not.toContain('Hazardous');
    expect(messages(line)).toMatch(/Annexure-A of Circular 24\/2026/);
  });

  /** ex_job15 and ex_job23 are chapter 29 and not on the list. */
  it('stays silent on a chapter-29 line that is not listed', () => {
    for (const ritc of ['29091990', '29321100']) {
      const line = item({ ritc, chemical: { category: 'CPCPR', casNumber: '1' } });
      expect(qualifiers(line)).not.toContain('Hazardous');
      expect(messages(line)).not.toMatch(/Circular 24\/2026/);
    }
  });
});

describe('the invoice serial', () => {
  /** I-20271: four invoices, one line each, four rows — never the literal 1. */
  it('belongs to the line, not to the first invoice', () => {
    const rows = [1, 2, 3, 4].flatMap(
      (n) =>
        singleWindowRowsForItem(
          item({ invoiceSrNo: n, ritc: '88022000', quantity: 1, unit: 'UNT' }),
          TODAY,
        ).rows,
    );
    expect(rows.map((r) => [r.invoiceSrNo, r.itemSlNo, r.measurement, r.unit])).toEqual([
      [1, 1, 1, 'NOS'],
      [2, 1, 1, 'NOS'],
      [3, 1, 1, 'NOS'],
      [4, 1, 1, 'NOS'],
    ]);
  });
});

describe('the FSSAI qualifiers', () => {
  /**
   * `ex_job24` files STCNR/MSC/FC0102 on its lactose and STCCT18/AYU/FC0101 on
   * its whey protein — one Bill of Entry, the same four questions, different
   * answers. A code from the chapter rule would declare one line's facts about
   * the other line's goods.
   */
  it('names the questions and files no answer nobody gave', () => {
    const line = item({ ritc: '17021110', quantity: 25000 });
    expect(qualifiers(line)).toEqual(['Standard UQC']);
    const m = messages(line);
    expect(m).toMatch(/FSSAI line must answer/);
    for (const q of [
      'Storage Condition',
      'Drug Related Category',
      'Foods & Supplement Proprietry Status',
      'Retail Pre-pack Food Article',
    ]) {
      expect(m).toContain(q);
    }
  });

  /** ex_job24 item 2 is chapter 35, outside the 2–22 the rule was written for. */
  it('covers chapter 35, which the original range missed', () => {
    expect(messages(item({ ritc: '35022000', quantity: 15000 }))).toMatch(/FSSAI line must answer/);
  });

  it('says nothing on a line no PGA rule covers', () => {
    expect(messages(item({ ritc: '88022000', quantity: 1, unit: 'UNT' }))).not.toMatch(/must answer/);
  });
});
