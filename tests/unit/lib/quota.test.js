import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('quota.js', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('getUsage returns estimate from navigator.storage', async () => {
    const mockEstimate = vi.fn().mockResolvedValue({ usage: 50000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const { getUsage } = await import('../../../src/lib/quota.js');
    const result = await getUsage();
    expect(result.usage).toBe(50000000);
    expect(result.quota).toBe(100000000);
  });

  it('getUsagePercent returns correct percentage', async () => {
    const mockEstimate = vi.fn().mockResolvedValue({ usage: 90000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const { getUsagePercent } = await import('../../../src/lib/quota.js');
    const pct = await getUsagePercent();
    expect(pct).toBe(90);
  });

  it('evict returns results object with stage counts', async () => {
    const mockEstimate = vi.fn().mockResolvedValue({ usage: 96000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const { evict } = await import('../../../src/lib/quota.js');
    const result = await evict();
    expect(result).toHaveProperty('stage1');
    expect(result).toHaveProperty('stage2');
    expect(result).toHaveProperty('stage3');
  });

  it('Stage 3 evicts MATURE cards (scheduled far in the future), not overdue ones', async () => {
    // Usage at 96% → triggers Stage 3 (>95%)
    const mockEstimate = vi.fn().mockResolvedValue({ usage: 96000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    // Capture the predicate passed to evictFromStore so we can verify the sign.
    let capturedPredicate = null;
    vi.doMock('../../../src/lib/storage.js', () => ({
      evictFromStore: async (storeName, predicate) => {
        if (storeName === 'flashcardTracker') capturedPredicate = predicate;
        return 0;
      },
    }));

    const { evict } = await import('../../../src/lib/quota.js');
    await evict();

    expect(capturedPredicate).toBeTruthy();

    const DAY_MS = 86400000;
    const matureCard = {
      repetitions: 10,
      nextReviewAt: new Date(Date.now() + 400 * DAY_MS).toISOString(), // 400 days in future
    };
    const overdueCard = {
      repetitions: 10,
      nextReviewAt: new Date(Date.now() - 400 * DAY_MS).toISOString(), // 400 days overdue
    };
    const youngCard = {
      repetitions: 2,
      nextReviewAt: new Date(Date.now() + 400 * DAY_MS).toISOString(),
    };

    expect(capturedPredicate(matureCard)).toBe(true);   // mature + future → evict
    expect(capturedPredicate(overdueCard)).toBe(false); // overdue → KEEP (user should review)
    expect(capturedPredicate(youngCard)).toBe(false);   // young → KEEP
  });

  it('Stage 1 evicts studyEvents older than 90 days using `ts` field', async () => {
    const mockEstimate = vi.fn().mockResolvedValue({ usage: 86000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    let capturedPredicate = null;
    vi.doMock('../../../src/lib/storage.js', () => ({
      evictFromStore: async (storeName, predicate) => {
        if (storeName === 'studyEvents') capturedPredicate = predicate;
        return 0;
      },
    }));

    const { evict } = await import('../../../src/lib/quota.js');
    await evict();

    expect(capturedPredicate).toBeTruthy();
    const DAY_MS = 86400000;
    const oldEvent = { ts: new Date(Date.now() - 100 * DAY_MS).toISOString() };
    const newEvent = { ts: new Date(Date.now() - 10 * DAY_MS).toISOString() };
    expect(capturedPredicate(oldEvent)).toBe(true);
    expect(capturedPredicate(newEvent)).toBe(false);
  });
});
