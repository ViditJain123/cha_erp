import { describe, expect, it } from 'vitest';
import { numberToIndianWords, rupeesInWords } from '../src/words.js';

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
