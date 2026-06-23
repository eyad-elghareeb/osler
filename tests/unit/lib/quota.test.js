import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('quota.js', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
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
});
