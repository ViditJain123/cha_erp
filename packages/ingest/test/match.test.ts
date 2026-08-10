import { describe, expect, it } from 'vitest';
import { MATCH_THRESHOLD, scoreMatches, type CandidateIdentifier } from '../src/match.js';
import type { Identifier } from '../src/normalise.js';

const id = (kind: Identifier['kind'], value: string): Identifier => ({ kind, value, raw: value });
const cand = (job_id: string, kind: Identifier['kind'], value: string): CandidateIdentifier => ({
  job_id,
  kind,
  value,
});

describe('scoreMatches', () => {
  it('finds nothing when no identifier overlaps', () => {
    const result = scoreMatches([id('bl', 'AAAA1111')], [cand('job-1', 'bl', 'BBBB2222')]);
    expect(result.decision).toBe('none');
  });

  it('attaches on a bill of lading alone', () => {
    const result = scoreMatches([id('bl', 'MEDIU12345678')], [cand('job-1', 'bl', 'MEDIU12345678')]);
    expect(result.decision).toBe('attach');
    expect(result.jobId).toBe('job-1');
    expect(result.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('scores a conversation thread below the threshold on its own', () => {
    // A reply-all chain drifts onto unrelated shipments, so a thread is a
    // tiebreaker rather than a sole signal. It only carries a match by itself
    // through the explicit fallback below, when the email names no shipment.
    const result = scoreMatches(
      [id('conversation', 'AAQk123'), id('bl', 'ELSEWHERE1234')],
      [cand('job-1', 'conversation', 'AAQk123')],
    );
    expect(result.decision).toBe('none');
  });

  it('attaches when a thread is corroborated by an invoice number', () => {
    const result = scoreMatches(
      [id('conversation', 'AAQk123'), id('invoice', 'INV20260044')],
      [cand('job-1', 'conversation', 'AAQk123'), cand('job-1', 'invoice', 'INV20260044')],
    );
    expect(result.decision).toBe('attach');
    expect(result.score).toBe(7);
    expect(result.matched).toHaveLength(2);
  });

  it('reports ambiguity instead of guessing between two equally matched jobs', () => {
    const result = scoreMatches(
      [id('bl', 'MEDIU12345678')],
      [cand('job-1', 'bl', 'MEDIU12345678'), cand('job-2', 'bl', 'MEDIU12345678')],
    );
    expect(result.decision).toBe('ambiguous');
    expect(result.tiedJobIds?.sort()).toEqual(['job-1', 'job-2']);
  });

  it('picks the stronger job when scores differ', () => {
    const result = scoreMatches(
      [id('conversation', 'AAQk123'), id('bl', 'MEDIU12345678')],
      [cand('job-1', 'conversation', 'AAQk123'), cand('job-2', 'bl', 'MEDIU12345678')],
    );
    expect(result.decision).toBe('attach');
    expect(result.jobId).toBe('job-2');
  });

  it('does not let a duplicated identifier inflate a job score', () => {
    // job-1 holds the same B/L twice; job-2 matches on two distinct identifiers
    // and should win.
    const result = scoreMatches(
      [id('bl', 'MEDIU12345678'), id('invoice', 'INV20260044'), id('container', 'CSQU3054383')],
      [
        cand('job-1', 'bl', 'MEDIU12345678'),
        cand('job-1', 'bl', 'MEDIU12345678'),
        cand('job-2', 'invoice', 'INV20260044'),
        cand('job-2', 'container', 'CSQU3054383'),
      ],
    );
    expect(result.decision).toBe('attach');
    expect(result.jobId).toBe('job-2');
    expect(result.score).toBe(9);
  });

  it('returns the identifiers that caused the match, for the audit trail', () => {
    const result = scoreMatches(
      [id('container', 'CSQU3054383')],
      [cand('job-1', 'container', 'CSQU3054383')],
    );
    expect(result.matched).toEqual([{ kind: 'container', value: 'CSQU3054383' }]);
  });
});

describe('thread-only fallback', () => {
  it('attaches a reply whose documents yielded no identifiers at all', () => {
    // A scanned certificate that the classifier could read nothing off. The
    // thread is the only evidence, and a duplicate job would be worse.
    const result = scoreMatches(
      [id('conversation', 'AAQk123')],
      [cand('job-1', 'conversation', 'AAQk123')],
    );
    expect(result.decision).toBe('attach');
    expect(result.jobId).toBe('job-1');
    expect(result.weak).toBe(true);
  });

  it('does not fire when the email names a different shipment', () => {
    // The documents do carry a B/L; it just belongs to another job. Trust the
    // identifier over the thread — reply-all chains drift across shipments.
    const result = scoreMatches(
      [id('conversation', 'AAQk123'), id('bl', 'OTHER99999999')],
      [cand('job-1', 'conversation', 'AAQk123')],
    );
    expect(result.decision).toBe('none');
  });

  it('does not fire when two jobs share the thread', () => {
    const result = scoreMatches(
      [id('conversation', 'AAQk123')],
      [cand('job-1', 'conversation', 'AAQk123'), cand('job-2', 'conversation', 'AAQk123')],
    );
    expect(result.decision).toBe('none');
  });

  it('is not marked weak when a strong identifier carried the match', () => {
    const result = scoreMatches([id('bl', 'MEDIU12345678')], [cand('job-1', 'bl', 'MEDIU12345678')]);
    expect(result.weak).toBeUndefined();
  });
});
