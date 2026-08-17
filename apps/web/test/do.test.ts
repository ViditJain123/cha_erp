import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEPOSIT_REFUND_DAYS,
  addDays,
  daysUntil,
  doAlerts,
  lastFreeDay,
  worstLevel,
  type DoAlertInput,
} from '../lib/do';

/**
 * Every deadline in the delivery order is derived rather than stored, so this
 * file is the only thing standing between a corrected ETA and a container
 * quietly running into detention.
 */

/** Pins "today" so the relative assertions below mean something. */
function freeze(day: string) {
  vi.useFakeTimers();
  // Midday UTC: any honest implementation lands on the same calendar day
  // whichever side of Greenwich the machine sits.
  vi.setSystemTime(new Date(`${day}T12:00:00Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

const BASE: DoAlertInput = {
  eta: null,
  status: 'open',
  freeDays: null,
  freeTimeFrom: null,
  deliveredAt: null,
  doValidUntil: null,
  proformaScrutinised: false,
  containers: [],
};

describe('addDays', () => {
  it('adds calendar days', () => {
    expect(addDays('2026-08-11', 7)).toBe('2026-08-18');
    expect(addDays('2026-08-11', 0)).toBe('2026-08-11');
    expect(addDays('2026-08-11', -1)).toBe('2026-08-10');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-25', 21)).toBe('2026-09-15');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
  });

  it('handles the leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('does not drift across a DST change', () => {
    // India has no DST, but the server need not be in India. These are the
    // European and US switchover weekends.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('daysUntil', () => {
  it('counts whole days forward and back', () => {
    freeze('2026-08-11');
    expect(daysUntil('2026-08-11')).toBe(0);
    expect(daysUntil('2026-08-18')).toBe(7);
    expect(daysUntil('2026-08-04')).toBe(-7);
  });

  it('reads a date-time as its calendar day', () => {
    freeze('2026-08-11');
    expect(daysUntil('2026-08-12T23:59:59Z')).toBe(1);
  });
});

describe('lastFreeDay', () => {
  const fallback = { freeDays: 14, freeTimeFrom: '2026-08-01', eta: '2026-07-30' };

  it('uses the job terms when the container has none', () => {
    expect(lastFreeDay({ freeDays: null, freeTimeFrom: null }, fallback)).toBe('2026-08-15');
  });

  it('lets a container override either half independently', () => {
    expect(lastFreeDay({ freeDays: 21, freeTimeFrom: null }, fallback)).toBe('2026-08-22');
    expect(lastFreeDay({ freeDays: null, freeTimeFrom: '2026-08-05' }, fallback)).toBe('2026-08-19');
  });

  it('falls back to the ETA only when no anchor is set', () => {
    expect(
      lastFreeDay({ freeDays: null, freeTimeFrom: null }, { ...fallback, freeTimeFrom: null }),
    ).toBe('2026-08-13');
  });

  it('is null until the terms are known', () => {
    expect(lastFreeDay({ freeDays: null, freeTimeFrom: null }, { ...fallback, freeDays: null })).toBe(
      null,
    );
    expect(
      lastFreeDay(
        { freeDays: null, freeTimeFrom: null },
        { freeDays: 14, freeTimeFrom: null, eta: null },
      ),
    ).toBe(null);
  });
});

describe('doAlerts — the invoice call', () => {
  it('falls due the day before ETA', () => {
    freeze('2026-08-11');
    const alerts = doAlerts({ ...BASE, eta: '2026-08-12' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('invoice_call');
    expect(alerts[0]?.dueOn).toBe('2026-08-11');
    expect(alerts[0]?.level).toBe('due');
  });

  it('goes overdue once the ETA has passed', () => {
    freeze('2026-08-15');
    const [alert] = doAlerts({ ...BASE, eta: '2026-08-12' });
    expect(alert?.level).toBe('overdue');
    expect(alert?.label).toContain('ago');
  });

  it('stops once the proforma has been scrutinised', () => {
    freeze('2026-08-15');
    expect(doAlerts({ ...BASE, eta: '2026-08-12', proformaScrutinised: true })).toEqual([]);
  });

  it('stays quiet while the ETA is still far off', () => {
    freeze('2026-08-01');
    expect(doAlerts({ ...BASE, eta: '2026-08-30' })).toEqual([]);
  });

  it('stops on a closed DO', () => {
    freeze('2026-08-15');
    expect(doAlerts({ ...BASE, eta: '2026-08-12', status: 'closed' })).toEqual([]);
  });
});

describe('doAlerts — detention free time', () => {
  const container = {
    containerNo: 'MSCU1234567',
    freeDays: null,
    freeTimeFrom: null,
    returnedOn: null,
    depositStatus: 'pending' as const,
  };

  it('warns three days out and turns overdue after the last free day', () => {
    freeze('2026-08-13');
    const [alert] = doAlerts({
      ...BASE,
      freeDays: 14,
      freeTimeFrom: '2026-08-01',
      proformaScrutinised: true,
      containers: [container],
    });
    expect(alert?.kind).toBe('free_time');
    expect(alert?.dueOn).toBe('2026-08-15');
    expect(alert?.level).toBe('due');

    freeze('2026-08-20');
    const [late] = doAlerts({
      ...BASE,
      freeDays: 14,
      freeTimeFrom: '2026-08-01',
      proformaScrutinised: true,
      containers: [container],
    });
    expect(late?.level).toBe('overdue');
    expect(late?.label).toContain('MSCU1234567');
  });

  it('ignores a container already back with the line', () => {
    freeze('2026-08-20');
    expect(
      doAlerts({
        ...BASE,
        freeDays: 14,
        freeTimeFrom: '2026-08-01',
        proformaScrutinised: true,
        containers: [{ ...container, returnedOn: '2026-08-10' }],
      }),
    ).toEqual([]);
  });

  it('honours a container that carries its own longer terms', () => {
    freeze('2026-08-20');
    expect(
      doAlerts({
        ...BASE,
        freeDays: 14,
        freeTimeFrom: '2026-08-01',
        proformaScrutinised: true,
        containers: [{ ...container, freeDays: 30 }],
      }),
    ).toEqual([]);
  });

  it('says nothing while the free period is unknown', () => {
    freeze('2026-08-20');
    expect(doAlerts({ ...BASE, proformaScrutinised: true, containers: [container] })).toEqual([]);
  });

  it('raises one alert per container', () => {
    freeze('2026-08-20');
    const alerts = doAlerts({
      ...BASE,
      freeDays: 14,
      freeTimeFrom: '2026-08-01',
      proformaScrutinised: true,
      containers: [container, { ...container, containerNo: 'TCLU7654321' }],
    });
    expect(alerts).toHaveLength(2);
  });
});

describe('doAlerts — deposit recovery', () => {
  const paid = {
    containerNo: 'MSCU1234567',
    freeDays: null,
    freeTimeFrom: null,
    returnedOn: '2026-08-02',
    depositStatus: 'paid' as const,
  };

  it('runs 15 days from delivery and escalates in the last three', () => {
    freeze('2026-08-02');
    const [alert] = doAlerts({
      ...BASE,
      status: 'delivered',
      proformaScrutinised: true,
      deliveredAt: '2026-08-01',
      containers: [paid],
    });
    expect(alert?.kind).toBe('deposit_refund');
    expect(alert?.dueOn).toBe(addDays('2026-08-01', DEPOSIT_REFUND_DAYS));
    expect(alert?.level).toBe('soon');

    freeze('2026-08-14');
    const [urgent] = doAlerts({
      ...BASE,
      status: 'delivered',
      proformaScrutinised: true,
      deliveredAt: '2026-08-01',
      containers: [paid],
    });
    expect(urgent?.level).toBe('due');

    freeze('2026-08-20');
    const [late] = doAlerts({
      ...BASE,
      status: 'delivered',
      proformaScrutinised: true,
      deliveredAt: '2026-08-01',
      containers: [paid],
    });
    expect(late?.level).toBe('overdue');
  });

  it('says nothing when every deposit is already settled', () => {
    freeze('2026-08-14');
    for (const depositStatus of ['refunded', 'not_applicable', 'forfeited'] as const) {
      expect(
        doAlerts({
          ...BASE,
          status: 'delivered',
          proformaScrutinised: true,
          deliveredAt: '2026-08-01',
          containers: [{ ...paid, depositStatus }],
        }),
      ).toEqual([]);
    }
  });

  it('chases a claimed but unreturned deposit', () => {
    freeze('2026-08-14');
    const [alert] = doAlerts({
      ...BASE,
      status: 'delivered',
      proformaScrutinised: true,
      deliveredAt: '2026-08-01',
      containers: [{ ...paid, depositStatus: 'claimed' }],
    });
    expect(alert?.kind).toBe('deposit_refund');
  });
});

describe('doAlerts — DO expiry', () => {
  it('warns while the DO is unused and about to lapse', () => {
    freeze('2026-08-11');
    const [alert] = doAlerts({
      ...BASE,
      status: 'do_received',
      proformaScrutinised: true,
      doValidUntil: '2026-08-13',
    });
    expect(alert?.kind).toBe('do_expiry');
    expect(alert?.level).toBe('due');
  });

  it('stops once delivery has been taken', () => {
    freeze('2026-08-11');
    expect(
      doAlerts({
        ...BASE,
        status: 'delivered',
        proformaScrutinised: true,
        doValidUntil: '2026-08-13',
        deliveredAt: '2026-08-10',
      }),
    ).toEqual([]);
  });
});

describe('doAlerts — ordering and severity', () => {
  it('puts the most overdue first', () => {
    freeze('2026-08-20');
    const alerts = doAlerts({
      ...BASE,
      eta: '2026-08-18',
      freeDays: 7,
      freeTimeFrom: '2026-08-01',
      containers: [
        {
          containerNo: 'MSCU1234567',
          freeDays: null,
          freeTimeFrom: null,
          returnedOn: null,
          depositStatus: 'pending',
        },
      ],
    });
    expect(alerts.length).toBeGreaterThan(1);
    expect(alerts[0]?.daysLeft).toBeLessThanOrEqual(alerts[1]?.daysLeft ?? 0);
  });

  it('reports the worst level across a set', () => {
    expect(worstLevel([])).toBe(null);
    expect(
      worstLevel([
        { kind: 'free_time', level: 'soon', dueOn: '', daysLeft: 3, label: '' },
        { kind: 'do_expiry', level: 'overdue', dueOn: '', daysLeft: -1, label: '' },
      ]),
    ).toBe('overdue');
    expect(
      worstLevel([{ kind: 'free_time', level: 'due', dueOn: '', daysLeft: 1, label: '' }]),
    ).toBe('due');
  });
});
