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
