import { describe, expect, it } from 'vitest';
import { declarationStatements, declarationTexts, type DeclarationInput } from '../src/index.js';

/**
 * The STATEMENT rules, each case one of the Logi-Sys checklists they were read
 * off. What is asserted is the "DECLARATIONS DETAILS" block of that checklist,
 * as `inv/item code` strings in print order.
 */
const filed = (input: DeclarationInput) =>
  declarationStatements(input).map((s) => `${s.invSrNo}/${s.itemSrNo} ${s.code}`);

const HEADER = ['0/0 CUG00', '0/0 CUG01'];
const invoiceCodes = (inv: number) => [`${inv}/0 CUV01`, `${inv}/0 CUV02`, `${inv}/0 CUV03`];

describe('declarationStatements', () => {
  it('ex_job2 — lactose under DFTP with a drug category: DC007 then CUF02, no PC002', () => {
    expect(
      filed({
        invoices: [{ srNo: 1 }],
        items: [
          {
            invoiceSrNo: 1,
            slNo: 1,
            ritc: '17021110',
            bcdExemption: { notification: '096/2008', scheme: 'DFTP' },
          },
        ],
        singleWindowInfo: [
          { itemSlNo: 1, infoType: 'Item Characteristics', qualifier: 'Standard UQC' },
          { itemSlNo: 1, infoType: 'Item Category', qualifier: 'Drug Related Category' },
        ],
      }),
    ).toEqual([...HEADER, ...invoiceCodes(1), '1/1 DC007', '1/1 CUF02']);
  });

  it('ex_job3 — sesame with FSSAI rows but no drug category: header and invoice codes only', () => {
    expect(
      filed({
        invoices: [{ srNo: 1 }],
        items: [{ invoiceSrNo: 1, slNo: 1, ritc: '12074090' }],
        singleWindowInfo: [
          { itemSlNo: 1, infoType: 'Item Category', qualifier: 'Foods & Supplement Proprietry Status' },
        ],
      }),
    ).toEqual([...HEADER, ...invoiceCodes(1)]);
  });

  it('ex_job4 — two chapter 39 lines: PC002 on each', () => {
    expect(
      filed({
        invoices: [{ srNo: 1 }],
        items: [
          { invoiceSrNo: 1, slNo: 1, ritc: '39046100' },
          { invoiceSrNo: 1, slNo: 2, ritc: '39046100' },
        ],
      }),
    ).toEqual([...HEADER, ...invoiceCodes(1), '1/1 PC002', '1/2 PC002']);
  });

  it('ex_job5 — twelve invoices of electronics under a non-FTA exemption: CUV per invoice, nothing per line', () => {
    const invoices = Array.from({ length: 12 }, (_, i) => ({ srNo: i + 1 }));
    expect(
      filed({
        invoices,
        items: invoices.map((inv) => ({
          invoiceSrNo: inv.srNo,
          slNo: 1,
          ritc: '85411000',
          bcdExemption: { notification: '024/2005' },
        })),
      }),
    ).toEqual([...HEADER, ...invoices.flatMap((inv) => invoiceCodes(inv.srNo))]);
  });

  it('ex_job6 — polymer under India-Japan CEPA: PC002 then CUF02', () => {
    expect(
      filed({
        invoices: [{ srNo: 1 }],
        items: [{ invoiceSrNo: 1, slNo: 1, ritc: '39021000', bcdExemption: { notification: '069/2011' } }],
      }),
    ).toEqual([...HEADER, ...invoiceCodes(1), '1/1 PC002', '1/1 CUF02']);
  });

  it('keeps each line under its own invoice when serials restart per invoice', () => {
    expect(
      filed({
        invoices: [{ srNo: 1 }, { srNo: 2 }],
        items: [
          { invoiceSrNo: 1, slNo: 1, ritc: '29171400' },
          { invoiceSrNo: 2, slNo: 1, ritc: '85411000' },
        ],
      }),
    ).toEqual([...HEADER, ...invoiceCodes(1), '1/1 PC002', ...invoiceCodes(2)]);
  });

  it('gives each filed code its text once, in master order', () => {
    const texts = declarationTexts(
      declarationStatements({
        invoices: [{ srNo: 1 }],
        items: [
          { invoiceSrNo: 1, slNo: 1, ritc: '39046100' },
          { invoiceSrNo: 1, slNo: 2, ritc: '39046100' },
        ],
      }),
    );
    expect(texts.map((t) => t.code)).toEqual(['CUG00', 'CUG01', 'CUV01', 'CUV02', 'CUV03', 'PC002']);
    expect(texts.every((t) => t.text.length > 20)).toBe(true);
  });
});
