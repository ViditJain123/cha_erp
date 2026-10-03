import { describe, expect, it } from 'vitest';
import { bcdReasonRefuses } from '../src/notification-choose.js';

/**
 * A concession whose own reason says the condition is not met is not chosen,
 * whatever index sits beside the reason. The three sentences below are the
 * ones the corpus filed a serial on.
 */
describe('a reason that argues against the entry refuses it', () => {
  it('catches the corpus sentences', () => {
    expect(
      bcdReasonRefuses(
        'The entry is limited to goods imported by a "specified person" for a stated purpose, which the invoice does not establish.',
      ),
    ).toBe(true);
    expect(bcdReasonRefuses('the supplied entry does not identify the hydrogen plant as a List 12 good')).toBe(true);
    expect(bcdReasonRefuses('limited to "Bulk drugs … List 2", which the invoice does not establish.')).toBe(true);
    expect(bcdReasonRefuses('No evidence on the invoice that the importer is a registered unit.')).toBe(true);
    expect(bcdReasonRefuses('It is unclear whether the goods are for the stated end use.')).toBe(true);
  });

  it('lets a positive reason through', () => {
    expect(bcdReasonRefuses('The invoice describes "PP GRANULES", which is the entry\'s "polypropylene in primary forms".')).toBe(false);
    expect(bcdReasonRefuses('Entry names the exact CTH and carries no condition.')).toBe(false);
  });
});
