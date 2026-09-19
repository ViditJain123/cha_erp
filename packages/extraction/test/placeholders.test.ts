import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scrubPlaceholders } from '../src/openai.js';

/**
 * The words a model returns when it means null — see `PLACEHOLDERS` in
 * `openai.ts`. Every case here was produced by a real extraction in the corpus
 * run over `ex_job1..31`, against a different field each time.
 */
describe('a placeholder is not an answer', () => {
  const schema = z.object({
    consigneeName: z.string().nullable(),
    countryOfOrigin: z.string().nullable(),
    invoiceDate: z.string().nullable(),
    items: z.array(z.object({ description: z.string().nullable() })),
  });

  it('nulls the ones the models actually returned', () => {
    const out = scrubPlaceholders(schema, {
      consigneeName: '>null',
      countryOfOrigin: ':null',
      invoiceDate: '/null',
      items: [{ description: 'N/A' }],
    });
    expect(out).toEqual({
      consigneeName: null,
      countryOfOrigin: null,
      invoiceDate: null,
      items: [{ description: null }],
    });
  });

  it('nulls the placeholders a person writes, including punctuation alone', () => {
    for (const placeholder of ['NIL', 'n/a', '-', '--', 'Not Applicable', 'NONE']) {
      const out = scrubPlaceholders(schema, {
        consigneeName: placeholder,
        countryOfOrigin: null,
        invoiceDate: null,
        items: [],
      });
      expect(out.consigneeName, placeholder).toBeNull();
    }
  });

  it('nulls a box struck out with a run of X\'s', () => {
    // ex_job4's bill of lading prints XXXXXXXXXXXXXXXX as its place of
    // delivery. Read as a value, it resolved to no station and the export
    // refused for want of a custom house the port of discharge would have given.
    const out = scrubPlaceholders(schema, {
      consigneeName: null,
      countryOfOrigin: null,
      invoiceDate: null,
      items: [{ description: 'XXXXXXXXXXXXXXXX' }],
    });
    expect(out.items[0]!.description).toBeNull();
  });

  it('leaves a real value alone, including one that merely contains "na"', () => {
    const out = scrubPlaceholders(schema, {
      consigneeName: 'NATIONAL TRADING LLC',
      countryOfOrigin: 'Namibia',
      invoiceDate: '2026-06-01',
      items: [{ description: 'NILKAMAL CRATES' }],
    });
    expect(out.consigneeName).toBe('NATIONAL TRADING LLC');
    expect(out.countryOfOrigin).toBe('Namibia');
    expect(out.items[0]!.description).toBe('NILKAMAL CRATES');
  });

  it('empties rather than nulls a field the schema will not allow null', () => {
    // `invoiceNumber` is a plain string on the invoice schema. Nulling it would
    // break the shape every later step reads, so the emptier of the two valid
    // forms is used and the value is still gone.
    const strict = z.object({ invoiceNumber: z.string() });
    expect(scrubPlaceholders(strict, { invoiceNumber: 'N/A' })).toEqual({ invoiceNumber: '' });
  });
});
