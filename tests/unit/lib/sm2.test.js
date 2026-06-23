import { describe, it, expect } from 'vitest';
import { nextReview, isDue, updateAvgTime, DEFAULT_STATE } from '../../../src/lib/sm2.js';

describe('sm2.js', () => {
  it('first Good rating gives interval 1, easeFactor stays 2.5', () => {
    const result = nextReview(DEFAULT_STATE, 2);
    expect(result.interval).toBe(1);
    expect(result.easeFactor).toBe(2.5);
    expect(result.repetitions).toBe(1);
    expect(result.totalReviews).toBe(1);
  });

  it('second Good rating gives interval 6', () => {
    const s = nextReview(DEFAULT_STATE, 2);
    const result = nextReview(s, 2);
    expect(result.interval).toBe(6);
    expect(result.repetitions).toBe(2);
  });

  it('third Good rating gives interval 15 (6 * 2.5)', () => {
    let s = nextReview(DEFAULT_STATE, 2);
    s = nextReview(s, 2);
    s = nextReview(s, 2);
    expect(s.interval).toBe(15);
    expect(s.repetitions).toBe(3);
  });

  it('Again rating resets repetitions, interval to 1, lapses +1', () => {
    let s = nextReview(DEFAULT_STATE, 2);
    s = nextReview(s, 2);
    const beforeLapses = s.lapses;
    const result = nextReview(s, 0);
    expect(result.repetitions).toBe(0);
    expect(result.interval).toBe(1);
    expect(result.lapses).toBe(beforeLapses + 1);
  });

  it('Hard rating decreases easeFactor', () => {
    const result = nextReview(DEFAULT_STATE, 1);
    expect(result.easeFactor).toBeLessThan(2.5);
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('Easy rating increases easeFactor', () => {
    const result = nextReview(DEFAULT_STATE, 3);
    expect(result.easeFactor).toBeGreaterThan(2.5);
  });

  it('easeFactor never drops below 1.3', () => {
    let s = { ...DEFAULT_STATE, easeFactor: 1.3 };
    for (let i = 0; i < 10; i++) {
      s = nextReview(s, 0);
      expect(s.easeFactor).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('isDue returns true for never-reviewed cards', () => {
    expect(isDue(DEFAULT_STATE)).toBe(true);
  });

  it('isDue returns false for a card reviewed far in the future', () => {
    const future = new Date(Date.now() + 365 * 86400000).toISOString();
    expect(isDue({ ...DEFAULT_STATE, nextReviewAt: future })).toBe(false);
  });

  it('updateAvgTime correctly computes rolling average', () => {
    const s = { ...DEFAULT_STATE, totalReviews: 2, avgTimePerReview: 5000 };
    const newAvg = updateAvgTime(s, 10000);
    expect(newAvg).toBeCloseTo(6666.67, 0);
  });
});
