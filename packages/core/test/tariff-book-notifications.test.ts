import { describe, expect, it } from 'vitest';
import { tariffBookNotification, tariffBookNotificationsFile } from '../src/masters/tariff-book-notifications.js';
import { tariffBook } from '../src/masters/tariff-book.js';

describe('Volume II notification map', () => {
  const file = tariffBookNotificationsFile();

  it('maps the notifications the Contents lists', () => {
    expect(file).not.toBeNull();
    // Built from the Contents, not from body headings: the heading-only
    // approach found 31 of the cited notifications before this was changed.
    expect(file!.notificationCount).toBeGreaterThan(250);
  });

  it('places the jumbo exemption where it is printed', () => {
    // Its Contents line reads "Ntfn4Sdated24.10.202S" — the case a strict
    // digit match drops.
    const jumbo = tariffBookNotification('045/2025');
    expect(jumbo?.startPage).toBe(35);
    expect(jumbo!.endPage).toBeGreaterThan(130);
  });

  it('gives every placed notification a sane page range', () => {
    for (const n of file!.notifications) {
      if (!n.startPage) continue;
      expect(n.endPage!).toBeGreaterThanOrEqual(n.startPage);
      expect(n.endPage!).toBeLessThanOrEqual(1456);
    }
  });

  /**
   * DGFT numbers against a policy period ("20/2015-2020") and CBIC against the
   * year. They are the two most-cited references in the schedule, and reading
   * the DGFT one as a customs notification joins policy text to the wrong
   * instrument.
   */
  it('never files a DGFT policy notification as a customs one', () => {
    const refs = tariffBook()!.rows.flatMap((r) => r.notificationRefs ?? []);
    const dgft = refs.filter((r) => r.authority === 'DGFT');
    expect(dgft.length).toBeGreaterThan(100);
    for (const r of dgft) expect(r.notification).toMatch(/^\d{3}\/\d{4}-(\d{2}|\?\?)$/);
    expect(refs.some((r) => r.authority === 'CBIC' && r.notification === '020/2015')).toBe(false);
  });
});
