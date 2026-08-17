import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DUTY_MATCH_TOLERANCE,
  QUERY_CHASE_DAYS,
  clearanceAlerts,
  dutyVariance,
  type ClearanceAlertInput,
} from '../lib/clearance';

/**
 * The duty comparison is the control this whole track exists for: it is what
 * catches customs having re-classified or re-valued the consignment. A false
 * match here means a wrong Bill of Entry gets paid without anyone looking.
 */

function freeze(day: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${day}T12:00:00Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

const BASE: ClearanceAlertInput = {
  status: 'noting',
  checklistDuty: null,
  assessedDuty: null,
  varianceRaisedAt: null,
  varianceResolvedAt: null,
  dutyPaidOn: null,
  outOfChargeOn: null,
  deliveredOn: null,
  openQueries: [],
  pendingNocs: [],
  pendingPlans: [],
};

describe('dutyVariance', () => {
  it('matches on an exact figure', () => {
    const v = dutyVariance(452318, 452318);
    expect(v.matches).toBe(true);
    expect(v.comparable).toBe(true);
    expect(v.difference).toBe(0);
  });

  it('absorbs rounding up to the tolerance, in both directions', () => {
    expect(dutyVariance(452318, 452318 + DUTY_MATCH_TOLERANCE).matches).toBe(true);
    expect(dutyVariance(452318, 452318 - DUTY_MATCH_TOLERANCE).matches).toBe(true);
  });

  it('flags anything past the tolerance', () => {
    expect(dutyVariance(452318, 452318 + DUTY_MATCH_TOLERANCE + 0.01).matches).toBe(false);
    expect(dutyVariance(452318, 460000).matches).toBe(false);
    expect(dutyVariance(452318, 440000).matches).toBe(false);
  });

  it('signs the difference by what customs did', () => {
    expect(dutyVariance(100000, 120000).difference).toBe(20000);
    expect(dutyVariance(100000, 80000).difference).toBe(-20000);
  });

  it('is never a match when either figure is missing', () => {
    // The dangerous case: an unchecked job must not read as agreeing.
    for (const [c, a] of [
      [null, 100000],
      [100000, null],
      [null, null],
    ] as const) {
      const v = dutyVariance(c, a);
      expect(v.matches).toBe(false);
      expect(v.comparable).toBe(false);
    }
  });

  it('does not accumulate floating point error on paise', () => {
    expect(dutyVariance(0.1 + 0.2, 0.3).difference).toBe(0);
  });
});

describe('clearanceAlerts — the duty variance', () => {
  it('is raised, and outranks everything else', () => {
    freeze('2026-08-11');
    const [alert] = clearanceAlerts({
      ...BASE,
      status: 'duty_variance',
      checklistDuty: 452318,
      assessedDuty: 460000,
      varianceRaisedAt: '2026-08-10T00:00:00Z',
    });
    expect(alert?.kind).toBe('duty_variance');
    expect(alert?.level).toBe('overdue');
    expect(alert?.label).toContain('more');
  });

  it('says when customs assessed less', () => {
    freeze('2026-08-11');
    const [alert] = clearanceAlerts({
      ...BASE,
      checklistDuty: 452318,
      assessedDuty: 440000,
      varianceRaisedAt: '2026-08-10T00:00:00Z',
    });
    expect(alert?.label).toContain('less');
  });

  it('clears once resolved', () => {
    freeze('2026-08-11');
    expect(
      clearanceAlerts({
        ...BASE,
        checklistDuty: 452318,
        assessedDuty: 460000,
        varianceRaisedAt: '2026-08-10T00:00:00Z',
        varianceResolvedAt: '2026-08-11T00:00:00Z',
      }),
    ).toEqual([]);
  });
});

describe('clearanceAlerts — customs queries', () => {
  it('stays quiet while a query is fresh', () => {
    freeze('2026-08-11');
    expect(clearanceAlerts({ ...BASE, openQueries: [{ raisedOn: '2026-08-11' }] })).toEqual([]);
  });

  it('chases after the grace period and escalates at double it', () => {
    freeze('2026-08-11');
    const [due] = clearanceAlerts({
      ...BASE,
      openQueries: [{ raisedOn: '2026-08-09' }],
    });
    expect(due?.kind).toBe('query_open');
    expect(due?.level).toBe('due');

    const [overdue] = clearanceAlerts({
      ...BASE,
      openQueries: [{ raisedOn: '2026-08-07' }],
    });
    expect(overdue?.level).toBe('overdue');
  });

  it('raises one per open query', () => {
    freeze('2026-08-11');
    const alerts = clearanceAlerts({
      ...BASE,
      openQueries: [{ raisedOn: '2026-08-01' }, { raisedOn: '2026-08-02' }],
    });
    expect(alerts.filter((a) => a.kind === 'query_open')).toHaveLength(2);
  });

  it('uses the documented grace period', () => {
    freeze('2026-08-11');
    const justInside = clearanceAlerts({
      ...BASE,
      openQueries: [{ raisedOn: `2026-08-${String(11 - QUERY_CHASE_DAYS + 1).padStart(2, '0')}` }],
    });
    expect(justInside).toEqual([]);
  });
});

describe('clearanceAlerts — NOCs', () => {
  it('warns while one is pending and names the authority', () => {
    freeze('2026-08-11');
    const [alert] = clearanceAlerts({
      ...BASE,
      status: 'out_of_charge',
      pendingNocs: [{ authority: 'Pollution Control Board' }],
    });
    expect(alert?.kind).toBe('noc_pending');
    expect(alert?.label).toContain('Pollution Control Board');
    expect(alert?.level).toBe('due');
  });

  it('stops once out of charge is granted', () => {
    freeze('2026-08-11');
    expect(
      clearanceAlerts({
        ...BASE,
        status: 'delivery_planning',
        dutyPaidOn: '2026-08-05',
        outOfChargeOn: '2026-08-10',
        pendingNocs: [{ authority: 'FSSAI' }],
      }),
    ).toEqual([]);
  });
});

describe('clearanceAlerts — awaiting the CFS', () => {
  it('escalates as the planned day arrives and passes', () => {
    freeze('2026-08-11');
    const [soon] = clearanceAlerts({ ...BASE, pendingPlans: [{ plannedFor: '2026-08-15' }] });
    expect(soon?.level).toBe('soon');

    const [today] = clearanceAlerts({ ...BASE, pendingPlans: [{ plannedFor: '2026-08-11' }] });
    expect(today?.level).toBe('due');
    expect(today?.label).toContain('today');

    const [missed] = clearanceAlerts({ ...BASE, pendingPlans: [{ plannedFor: '2026-08-09' }] });
    expect(missed?.level).toBe('overdue');
    expect(missed?.label).toContain('never answered');
  });
});

describe('clearanceAlerts — integrity', () => {
  it('flags out of charge with no duty payment behind it', () => {
    freeze('2026-08-11');
    const [alert] = clearanceAlerts({ ...BASE, outOfChargeOn: '2026-08-10' });
    expect(alert?.kind).toBe('ooc_without_duty');
    expect(alert?.level).toBe('overdue');
  });

  it('says nothing when the duty was paid', () => {
    freeze('2026-08-11');
    expect(
      clearanceAlerts({ ...BASE, outOfChargeOn: '2026-08-10', dutyPaidOn: '2026-08-05' }),
    ).toEqual([]);
  });
});

describe('clearanceAlerts — ordering', () => {
  it('puts the most overdue first', () => {
    freeze('2026-08-11');
    const alerts = clearanceAlerts({
      ...BASE,
      openQueries: [{ raisedOn: '2026-08-01' }],
      pendingPlans: [{ plannedFor: '2026-08-20' }],
    });
    expect(alerts.length).toBeGreaterThan(1);
    expect(alerts[0]?.daysLeft).toBeLessThanOrEqual(alerts[1]?.daysLeft ?? 0);
  });
});
