import { describe, it, expect } from 'vitest';
import { sm2Merge } from '../../../src/lib/sync.js';

describe('sm2Merge', () => {
  it('returns remote when local is null', () => {
    const local = null;
    const remote = { ef: 2.5, interval: 1, repetitions: 0, lapses: 0, lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 5 };
    expect(sm2Merge(local, remote)).toEqual(remote);
  });

  it('returns local when remote is null', () => {
    const local = { ef: 2.5, interval: 1, repetitions: 0, lapses: 0, lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 5 };
    const remote = null;
    expect(sm2Merge(local, remote)).toEqual(local);
  });

  it('later review wins state, totalReviews takes max', () => {
    const local = {
      ef: 2.5, interval: 1, repetitions: 0, lapses: 0,
      lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 3,
    };
    const remote = {
      ef: 1.8, interval: 4, repetitions: 2, lapses: 2,
      lastReviewedAt: '2026-06-02T10:00:00Z', totalReviews: 7,
    };
    const result = sm2Merge(local, remote);
    expect(result.ef).toBe(1.8);
    expect(result.interval).toBe(4);
    expect(result.repetitions).toBe(2);
    expect(result.lapses).toBe(2);
    expect(result.totalReviews).toBe(7);
  });

  it('totalReviews aggregates to max of both', () => {
    const local = {
      ef: 2.5, interval: 1, repetitions: 0, lapses: 0,
      lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 10,
    };
    const remote = {
      ef: 2.5, interval: 1, repetitions: 0, lapses: 0,
      lastReviewedAt: '2026-06-01T09:00:00Z', totalReviews: 5,
    };
    const result = sm2Merge(local, remote);
    expect(result.totalReviews).toBe(10);
  });
});
