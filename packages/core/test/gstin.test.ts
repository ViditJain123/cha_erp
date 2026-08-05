import { describe, expect, it } from 'vitest';
import { validateGstin } from '../src/gstin.js';

describe('validateGstin', () => {
  // real GSTINs from the reference checklists
  it.each(['27AABCB0983D1ZY', '07AAFCF4316C1Z3', '05AABCO6103C1Z5'])('accepts %s', (g) => {
    expect(validateGstin(g).valid).toBe(true);
  });

  it('catches a wrong check digit', () => {
    const r = validateGstin('27AABCB0983D1ZZ');
    expect(r.valid).toBe(false);
    expect(r.problems[0]).toContain('check digit');
  });

  it('catches a malformed value', () => {
    expect(validateGstin('NOT-A-GSTIN').valid).toBe(false);
  });

  it('cross-checks embedded PAN and state code', () => {
    expect(validateGstin('27AABCB0983D1ZY', { pan: 'AABCB0983D', stateCode: '27' }).valid).toBe(true);
    expect(validateGstin('27AABCB0983D1ZY', { pan: 'ZZZZZ9999Z' }).problems[0]).toContain('PAN');
    expect(validateGstin('27AABCB0983D1ZY', { stateCode: '07' }).problems[0]).toContain('state code');
  });
});
