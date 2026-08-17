/**
 * Dates, rendered the way an Indian customs desk reads them: DD/MM/YYYY.
 *
 * Not `server-only` — client components format dates too.
 *
 * There are two kinds of date in this system and they are not interchangeable:
 *
 * - **Calendar days** (`date` columns: eta, planned_for, duty_paid_on…). These
 *   have no time and no zone. They are formatted by string surgery, never by
 *   constructing a Date — `new Date('2026-08-20')` is midnight *UTC*, which
 *   renders as the 19th anywhere west of Greenwich.
 * - **Instants** (`timestamptz` columns: created_at, bl_checked_at…). These are
 *   real moments and need a zone to become a day at all.
 */

/**
 * The zone instants are read in.
 *
 * Hardcoded rather than left to the runtime: server components format on the
 * server, and a Render or Vercel box runs in UTC — so "checked at 9pm IST"
 * would render as the previous day for everyone looking at it. The desk this
 * serves is in India.
 */
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

/** DD/MM/YYYY from a `date` string. No Date object, so no zone can shift it. */
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DAY_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** DD/MM/YYYY for a timestamp, read in the display zone. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : DAY_FORMAT.format(at);
}

/** DD/MM/YYYY HH:mm, for the few places the time of day matters. */
export function formatStampTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = new Date(iso);
  // en-GB renders this as "20/08/2026, 14:30"; the comma reads as noise here.
  return Number.isNaN(at.getTime()) ? '—' : DAY_TIME_FORMAT.format(at).replace(',', '');
}

// --------------------------------------------------------- calendar maths ----

/**
 * Postgres `date` is a calendar day, so every deadline in this app is computed
 * on UTC parts only — the arithmetic must not care where the server sits.
 */
function parseDay(isoDate: string): number {
  const [y = 1970, m = 1, d = 1] = isoDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today as a calendar day, in the display zone rather than the server's. */
function todayMs(): number {
  // en-CA gives YYYY-MM-DD, which parseDay already understands.
  return parseDay(
    new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE }).format(new Date()),
  );
}

/** `2026-08-11` + 7 → `2026-08-18`. Calendar days, never hours. */
export function addDays(isoDate: string, days: number): string {
  return toIsoDay(parseDay(isoDate) + days * 86_400_000);
}

/** Negative once the date is in the past. 0 means today. */
export function daysUntil(isoDate: string): number {
  return Math.round((parseDay(isoDate) - todayMs()) / 86_400_000);
}
