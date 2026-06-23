import { describe, it, expect } from 'vitest';
import { sm2Merge } from '../../../src/lib/sync.js';

describe('sm2Merge', () => {
  it('returns remote when local is null', () => {
    const local = null;
    const remote = { easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0, lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 5 };
    expect(sm2Merge(local, remote)).toEqual(remote);
  });

  it('returns local when remote is null', () => {
    const local = { easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0, lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 5 };
    const remote = null;
    expect(sm2Merge(local, remote)).toEqual(local);
  });

  it('later review wins state, totalReviews SUMS both (Appendix D spec)', () => {
    const local = {
      easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0,
      lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 3,
      avgTimePerReview: 5000,
    };
    const remote = {
      easeFactor: 1.8, interval: 4, repetitions: 2, lapses: 2,
      lastReviewedAt: '2026-06-02T10:00:00Z', totalReviews: 7,
      avgTimePerReview: 7000,
    };
    const result = sm2Merge(local, remote);
    // Later review wins state:
    expect(result.easeFactor).toBe(1.8);
    expect(result.interval).toBe(4);
    expect(result.repetitions).toBe(2);
    expect(result.lapses).toBe(2); // SUM (was max in old impl)
    // totalReviews SUMs both per Appendix D "both count toward totals":
    expect(result.totalReviews).toBe(10);
    // avgTimePerReview is weighted average across both devices:
    expect(result.avgTimePerReview).toBeCloseTo((5000*3 + 7000*7) / 10, 0);
  });

  it('totalReviews aggregates to SUM of both, not max', () => {
    const local = {
      easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0,
      lastReviewedAt: '2026-06-01T10:00:00Z', totalReviews: 10,
      avgTimePerReview: 4000,
    };
    const remote = {
      easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0,
      lastReviewedAt: '2026-06-01T09:00:00Z', totalReviews: 5,
      avgTimePerReview: 8000,
    };
    const result = sm2Merge(local, remote);
    // SUM, not max — Appendix D "both count toward totals":
    expect(result.totalReviews).toBe(15);
    expect(result.avgTimePerReview).toBeCloseTo((4000*10 + 8000*5) / 15, 0);
  });

  it('handles zero totalReviews without divide-by-zero', () => {
    const local = { easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0, lastReviewedAt: '', totalReviews: 0, avgTimePerReview: 0 };
    const remote = { easeFactor: 2.5, interval: 1, repetitions: 0, lapses: 0, lastReviewedAt: '', totalReviews: 0, avgTimePerReview: 0 };
    const result = sm2Merge(local, remote);
    expect(result.totalReviews).toBe(0);
    expect(result.lapses).toBe(0);
    // Should not crash; avgTimePerReview stays at 0 when no reviews.
    expect(result.avgTimePerReview).toBe(0);
  });
});
