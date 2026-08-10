import { randomInt } from 'node:crypto';

/**
 * Alphabets with the confusable glyphs removed (I/l/1, O/0). People retype
 * these out of an email, so a password that reads unambiguously in a sans-serif
 * font is worth more than the ~2 bits of entropy it costs.
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const ALL = UPPER + LOWER + DIGIT;

const LENGTH = 16;

function pick(alphabet: string): string {
  // randomInt is uniform (Node rejection-samples internally). `% length` on raw
  // random bytes would bias toward the front of the alphabet.
  return alphabet[randomInt(alphabet.length)] as string;
}

/**
 * A temporary password for a newly invited user. Satisfies Supabase's
 * `lower_upper_letters_digits` requirement by construction, and is replaced on
 * the user's first login anyway.
 */
export function generateTempPassword(): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  while (chars.length < LENGTH) chars.push(pick(ALL));

  // Fisher-Yates, so the guaranteed characters are not always in positions 0-2.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
