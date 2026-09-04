/**
 * Indian-numbering amount-in-words, matching the Logi-Sys checklist style:
 * 419638 -> "Rs. Four Lakh Nineteen Thousand Six Hundred Thirty Eight Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Whole-rupee amount to Indian-system words (no "Rs."/"Only" wrapper). */
export function numberToIndianWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`cannot convert ${n} to words`);
  const whole = Math.floor(n);
  if (whole === 0) return 'Zero';

  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1_000);
  const hundreds = whole % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundreds) parts.push(threeDigits(hundreds));
  return parts.join(' ');
}

/** Checklist "Duty Payable" line: "Rs. <words> Only". */
export function rupeesInWords(amount: number): string {
  return `Rs. ${numberToIndianWords(amount)} Only`;
}

/**
 * The goods as a general description, with the manufacturer's grade code
 * stripped off the invoice description.
 *
 * The ITEMS sheet asks for `Product_Description` and `General_Description`
 * separately, and the difference is the grade: an invoice line reads "Random
 * Polypropylene RP2248N" and the Bill of Entry declares "Random Polypropylene"
 * beside it. That trailing token is a catalogue reference, not a description of
 * the goods, and customs classifies what the goods are.
 *
 * Deterministic and deliberately timid — it removes only trailing tokens that
 * cannot be words, and never returns nothing. A model refines this afterwards
 * (`describeGoodsGenerically` in @checklist/extraction) for the cases a rule
 * cannot reach, such as "PP GRANULES" declared as "PP PELLET"; when no model is
 * available this value stands, and it is always a legal answer because the
 * worst it can do is repeat the invoice description.
 */
export function tradeDescription(description: string): string {
  const words = description.replace(/\s+/g, ' ').trim().split(' ');
  // A grade code mixes letters and digits ("RP2248N", "880FG-UV-8LB") or is a
  // bare run of four or more digits. Two-token descriptions are left alone:
  // "MEK 2000" is more likely the product than a product plus a code.
  const isGradeCode = (word: string) => {
    const bare = word.replace(/[()[\],.]/g, '');
    if (!bare) return false;
    if (/^\d{4,}$/.test(bare)) return true;
    return /[A-Za-z]/.test(bare) && /\d/.test(bare);
  };
  const kept = [...words];
  while (kept.length > 2 && isGradeCode(kept[kept.length - 1]!)) kept.pop();
  return kept.length ? kept.join(' ') : description.trim();
}
