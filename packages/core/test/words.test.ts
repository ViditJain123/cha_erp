import { describe, expect, it } from 'vitest';
import { numberToIndianWords, rupeesInWords, tradeDescription } from '../src/words.js';

describe('numberToIndianWords', () => {
  it.each([
    [0, 'Zero'],
    [7, 'Seven'],
    [19, 'Nineteen'],
    [42, 'Forty Two'],
    [100, 'One Hundred'],
    [950, 'Nine Hundred Fifty'],
    [1_000, 'One Thousand'],
    [142_950, 'One Lakh Forty Two Thousand Nine Hundred Fifty'],
    [419_638, 'Four Lakh Nineteen Thousand Six Hundred Thirty Eight'],
    [10_000_000, 'One Crore'],
    [12_34_56_789, 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine'],
    [1_00_00_00_000, 'One Hundred Crore'],
  ])('%i -> %s', (n, words) => {
    expect(numberToIndianWords(n)).toBe(words);
  });

  it('wraps with Rs./Only for the checklist duty line', () => {
    expect(rupeesInWords(419_638)).toBe(
      'Rs. Four Lakh Nineteen Thousand Six Hundred Thirty Eight Only',
    );
  });
});

describe('tradeDescription', () => {
  it('strips the manufacturer grade code off the invoice description', () => {
    // The reference sheet: Product_Description keeps the grade,
    // General_Description does not.
    expect(tradeDescription('Random Polypropylene RP2248N')).toBe('Random Polypropylene');
  });

  it('leaves a description that is already generic alone', () => {
    expect(tradeDescription('MALEIC ANHYDRIDE (MA)')).toBe('MALEIC ANHYDRIDE (MA)');
    expect(tradeDescription('PP GRANULES (POLYPROPYLENE)')).toBe('PP GRANULES (POLYPROPYLENE)');
  });

  it('strips several trailing codes, not just the last one', () => {
    expect(tradeDescription('FLUOROCARBON GEL 880FG UV8LB')).toBe('FLUOROCARBON GEL');
  });

  it('never strips a description down to nothing', () => {
    // Two tokens are left alone: "MEK 2000" is more likely the product than a
    // product plus a catalogue number.
    expect(tradeDescription('MEK 2000')).toBe('MEK 2000');
    expect(tradeDescription('RP2248N')).toBe('RP2248N');
  });

  it('collapses stray whitespace', () => {
    expect(tradeDescription('  Random   Polypropylene  ')).toBe('Random Polypropylene');
  });
});
