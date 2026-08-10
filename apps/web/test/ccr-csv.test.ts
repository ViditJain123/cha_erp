import { describe, expect, it } from 'vitest';
import { parseCcrCsv } from '../lib/ccr-csv';

describe('parseCcrCsv', () => {
  it('reads a plain file', () => {
    const { rows, errors } = parseCcrCsv(
      '3304,FSSAI-01,FSSAI registration,Importer must hold a valid FSSAI licence.',
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        hsCode: '3304',
        code: 'FSSAI-01',
        title: 'FSSAI registration',
        requirementText: 'Importer must hold a valid FSSAI licence.',
      },
    ]);
  });

  it('skips a header row instead of failing on it', () => {
    const { rows, errors } = parseCcrCsv(
      'hs_code,code,title,requirement_text\n3304,A,B,C',
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('keeps commas inside quotes', () => {
    // The common real case: requirement text is prose.
    const { rows } = parseCcrCsv('3304,A,Title,"Needs a licence, a test report, and a COO."');
    expect(rows[0]?.requirementText).toBe('Needs a licence, a test report, and a COO.');
  });

  it('keeps newlines inside quotes', () => {
    const { rows } = parseCcrCsv('3304,A,Title,"Line one\nLine two"');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requirementText).toBe('Line one\nLine two');
  });

  it('unescapes doubled quotes', () => {
    const { rows } = parseCcrCsv('3304,A,Title,"He said ""no"" twice"');
    expect(rows[0]?.requirementText).toBe('He said "no" twice');
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseCcrCsv('3304,A,T,One\r\n3305,B,T,Two\r\n');
    expect(rows.map((r) => r.hsCode)).toEqual(['3304', '3305']);
  });

  it('strips formatting from the HS code', () => {
    const { rows } = parseCcrCsv('3304.99.90,A,T,Text');
    expect(rows[0]?.hsCode).toBe('33049990');
  });

  it('reports bad lines without discarding the good ones', () => {
    const { rows, errors } = parseCcrCsv(
      '3304,A,T,Good\nnot-a-code,B,T,Bad\n3305,C,T,Also good',
    );
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Line 2');
  });

  it('requires a code and requirement text', () => {
    const { rows, errors } = parseCcrCsv('3304,,T,Text\n3305,B,T,');
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });

  it('ignores blank lines', () => {
    const { rows } = parseCcrCsv('3304,A,T,Text\n\n\n3305,B,T,Text\n');
    expect(rows).toHaveLength(2);
  });

  it('falls back to the code when the title is blank', () => {
    const { rows } = parseCcrCsv('3304,FSSAI-01,,Text');
    expect(rows[0]?.title).toBe('FSSAI-01');
  });
});
