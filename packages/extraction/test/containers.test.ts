import { describe, expect, it } from 'vitest';
import { mergeContainerLists, needsContainerReread } from '../src/containers.js';
import type { BlExtract } from '../src/schemas.js';

/**
 * The container re-read: when it fires, and what it does with what comes back.
 *
 * The main B/L extraction carries forty fields and the container list is the
 * one that has gone missing on every job in the corpus, so a second, focused
 * read confirms it. These are the rules for that second read.
 */

const bl = (over: Partial<Pick<BlExtract, 'containers' | 'containerCount'>>) => ({
  containers: [],
  containerCount: null,
  ...over,
}) as Pick<BlExtract, 'containers' | 'containerCount'>;

describe('when a container list gets read again', () => {
  it('re-reads an empty or single-container list', () => {
    expect(needsContainerReread(bl({}))).toBe(true);
    expect(
      needsContainerReread(bl({ containers: [{ number: 'CAIU3686895', sizeType: null, sealNo: null }] })),
    ).toBe(true);
  });

  it('re-reads when the B/L states a different total', () => {
    expect(
      needsContainerReread(
        bl({
          containerCount: 6,
          containers: [
            { number: 'IAAU1141498', sizeType: null, sealNo: null },
            { number: 'IAAU1730986', sizeType: null, sealNo: null },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('re-reads when a number fails its check digit', () => {
    expect(
      needsContainerReread(
        bl({
          containerCount: 2,
          containers: [
            { number: 'IAAU1141499', sizeType: null, sealNo: null },
            { number: 'IAAU1730986', sizeType: null, sealNo: null },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('leaves a list alone when it agrees with the stated total and validates', () => {
    expect(
      needsContainerReread(
        bl({
          containerCount: 2,
          containers: [
            { number: 'IAAU1141498', sizeType: null, sealNo: null },
            { number: 'IAAU1730986', sizeType: null, sealNo: null },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe('merging two readings of the same page', () => {
  it('is a union, so a box either pass saw survives', () => {
    const merged = mergeContainerLists(
      [{ number: 'CAIU3686895', sizeType: '20GP', sealNo: null }],
      [
        { number: 'CAIU3772397', sizeType: '20GP', sealNo: 'QIN2509082' },
        { number: 'SEGU1294439', sizeType: '20GP', sealNo: null },
      ],
    );
    expect(merged.map((c) => c.number)).toEqual(['CAIU3686895', 'CAIU3772397', 'SEGU1294439']);
  });

  it('matches the same box however it was punctuated', () => {
    const merged = mergeContainerLists(
      [{ number: 'CAIU 3686895', sizeType: null, sealNo: null }],
      [{ number: 'CAIU-3686895', sizeType: '20GP', sealNo: 'QIN2410658' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sealNo).toBe('QIN2410658');
  });
});
