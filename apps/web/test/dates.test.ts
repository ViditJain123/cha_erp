import { describe, expect, it } from 'vitest';
import { formatDay, formatStamp, formatStampTime } from '../lib/dates';

/**
 * The whole point of this module is that a date reads the same wherever the
 * server happens to run. These tests exist to catch a regression to
 * `toLocaleDateString()`, which silently renders MM/DD/YYYY on a US-locale box
 * and the previous day for an evening IST timestamp on a UTC one.
 */

describe('formatDay — calendar days', () => {
  it('renders DD/MM/YYYY', () => {
    expect(formatDay('2026-08-20')).toBe('20/08/2026');
    expect(formatDay('2026-01-01')).toBe('01/01/2026');
    expect(formatDay('2026-12-31')).toBe('31/12/2026');
  });

  it('keeps the leading zeros', () => {
    expect(formatDay('2026-03-07')).toBe('07/03/2026');
  });

  it('never shifts the day, whatever the runtime zone', () => {
    // The bug this replaces: new Date('2026-08-20') is midnight UTC, which is
    // the 19th anywhere west of Greenwich. No Date is constructed here at all.
    const original = process.env.TZ;
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      expect(formatDay('2026-08-20')).toBe('20/08/2026');
    }
    process.env.TZ = original;
  });

  it('tolerates a full timestamp being passed by mistake', () => {
    expect(formatDay('2026-08-20T18:30:00Z')).toBe('20/08/2026');
  });

  it('renders an em dash for nothing', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay(undefined)).toBe('—');
    expect(formatDay('')).toBe('—');
  });
});

describe('formatStamp — instants', () => {
  it('renders DD/MM/YYYY', () => {
    expect(formatStamp('2026-08-20T09:00:00Z')).toBe('20/08/2026');
  });

  it('reads an instant in Indian time, not the server’s', () => {
    // 20:00 UTC is 01:30 the next morning in Kolkata. A desk in India filing at
    // half past one would otherwise see the previous day on a UTC server.
    expect(formatStamp('2026-08-20T20:00:00Z')).toBe('21/08/2026');
    // And the other way: 18:00 IST is still the 20th.
    expect(formatStamp('2026-08-20T12:30:00Z')).toBe('20/08/2026');
  });

  it('renders an em dash for nothing, and for nonsense', () => {
    expect(formatStamp(null)).toBe('—');
    expect(formatStamp('not a date')).toBe('—');
  });
});

describe('formatStampTime', () => {
  it('renders DD/MM/YYYY HH:mm on a 24-hour clock, with no comma', () => {
    // 09:00 UTC is 14:30 IST.
    expect(formatStampTime('2026-08-20T09:00:00Z')).toBe('20/08/2026 14:30');
  });

  it('pads the hour', () => {
    // 01:00 UTC is 06:30 IST.
    expect(formatStampTime('2026-08-20T01:00:00Z')).toBe('20/08/2026 06:30');
  });

  it('renders an em dash for nothing', () => {
    expect(formatStampTime(null)).toBe('—');
  });
});
