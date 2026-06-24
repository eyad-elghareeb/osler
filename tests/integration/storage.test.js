import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clear, get, put, deleteEntry, getAll } from '../../src/lib/storage.js';
import { STORES } from '../../src/lib/storage.js';

const TEST_PREFIX = 'integration-test-';

const testEntries = {
  quizTracker: { contentUid: 'test-quiz', itemId: 'q-001', wrongCount: 2, flag: false, updatedAt: new Date().toISOString() },
  flashcardTracker: { uid: 'test-fc-001', easeFactor: 2.5, interval: 1, totalReviews: 5, updatedAt: new Date().toISOString() },
  writtenTracker: { uid: 'test-written-001', contentUid: 'test-written', score: 85, updatedAt: new Date().toISOString() },
  osceTracker: { uid: 'test-osce-001', completed: false, updatedAt: new Date().toISOString() },
  studyEvents: { ts: new Date().toISOString(), deviceId: 'test-device', action: 'answer', outcome: 'correct', contentUid: 'test-quiz', itemId: 'q-001' },
  userContent: { uid: 'test-uc-001', title: 'My Quiz', body: 'test', schemaVersion: '1.0', updatedAt: new Date().toISOString() },
  streak: { key: 'global', currentStreak: 3, longestStreak: 5, xp: 100, level: 2, lastActivityDate: new Date().toISOString() },
  syncLog: { timestamp: new Date().toISOString(), deviceId: 'test-device', entryType: 'quizTracker', entryUid: 'test-quiz', operation: 'push' },
  settings: { key: 'theme', value: 'dark' },
};

const storeNames = STORES.map(s => s.name);

describe('Storage integration — CRUD across all stores', () => {
  afterAll(async () => {
    for (const name of storeNames) {
      await clear(name);
    }
  });

  it('has exactly 9 stores defined', () => {
    expect(storeNames).toHaveLength(9);
    expect(storeNames).toContain('quizTracker');
    expect(storeNames).toContain('flashcardTracker');
    expect(storeNames).toContain('writtenTracker');
    expect(storeNames).toContain('osceTracker');
    expect(storeNames).toContain('studyEvents');
    expect(storeNames).toContain('userContent');
    expect(storeNames).toContain('streak');
    expect(storeNames).toContain('syncLog');
    expect(storeNames).toContain('settings');
  });

  for (const name of storeNames) {
    describe(`store: ${name}`, () => {
      const entry = testEntries[name];
      const storeConfig = STORES.find(s => s.name === name);
      const isAutoInc = storeConfig?.autoIncrement;

      it('put and get round-trip', async () => {
        if (!entry) return;
        const insertedKey = await put(name, entry);
        if (isAutoInc) {
          expect(typeof insertedKey).toBe('number');
          const result = await get(name, insertedKey);
          expect(result).not.toBeNull();
          expect(result.ts || result.timestamp || result.value).toEqual(entry.ts || entry.timestamp || entry.value);
        } else {
          const key = Array.isArray(storeConfig?.keyPath)
            ? storeConfig.keyPath.map(p => entry[p])
            : entry[storeConfig?.keyPath || 'key'] || entry.key;
          const result = await get(name, key);
          expect(result).not.toBeNull();
          expect(result.updatedAt || result.ts || result.value).toEqual(entry.updatedAt || entry.ts || entry.value);
        }
      });

      it('getAll returns the inserted entry', async () => {
        if (!entry) return;
        const all = await getAll(name);
        expect(all.length).toBeGreaterThanOrEqual(1);
      });

      it('delete removes the entry', async () => {
        if (!entry) return;
        const insertedKey = await put(name, entry);
        if (isAutoInc) {
          await deleteEntry(name, insertedKey);
          const result = await get(name, insertedKey);
          expect(result).toBeNull();
        } else {
          const key = Array.isArray(storeConfig?.keyPath)
            ? storeConfig.keyPath.map(p => entry[p])
            : entry[storeConfig?.keyPath || 'key'] || entry.key;
          await deleteEntry(name, key);
          const result = await get(name, key);
          expect(result).toBeNull();
        }
      });

      it('clear removes all entries', async () => {
        if (!entry) return;
        await put(name, entry);
        await clear(name);
        const all = await getAll(name);
        expect(all).toHaveLength(0);
      });
    });
  }
});

describe('Storage integration — quota eviction thresholds', () => {
  let quotaModule;

  beforeAll(async () => {
    quotaModule = await import('../../src/lib/quota.js');
    await Promise.all(storeNames.map(n => clear(n)));
  });

  it('evict triggers nothing below Stage 1 threshold (<85%)', async () => {
    const mockEstimate = () => Promise.resolve({ usage: 50000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const result = await quotaModule.evict();
    expect(result.stage1).toBe(0);
    expect(result.stage2).toBe(0);
    expect(result.stage3).toBe(0);
  });

  it('Stage 1 evicts studyEvents older than 90 days (85–89%)', async () => {
    const mockEstimate = () => Promise.resolve({ usage: 86000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const oldEvent = { ts: new Date(Date.now() - 100 * 86400000).toISOString(), deviceId: 'd1', action: 'answer' };
    const newEvent = { ts: new Date().toISOString(), deviceId: 'd1', action: 'answer' };
    await put('studyEvents', oldEvent);
    await put('studyEvents', newEvent);

    const result = await quotaModule.evict();
    expect(result.stage1).toBeGreaterThanOrEqual(1);
    const remaining = await getAll('studyEvents');
    expect(remaining.length).toBe(1);
    await clear('studyEvents');
  });

  it('Stage 2 evicts syncLog older than 30 days (90–94%)', async () => {
    const mockEstimate = () => Promise.resolve({ usage: 92000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const oldLog = { timestamp: new Date(Date.now() - 60 * 86400000).toISOString(), deviceId: 'd1', entryType: 'test', operation: 'push' };
    const newLog = { timestamp: new Date().toISOString(), deviceId: 'd1', entryType: 'test', operation: 'push' };
    await put('syncLog', oldLog);
    await put('syncLog', newLog);

    const result = await quotaModule.evict();
    expect(result.stage2).toBeGreaterThanOrEqual(1);
    const remaining = await getAll('syncLog');
    expect(remaining.length).toBe(1);
    await clear('syncLog');
  });

  it('Stage 3 evicts mature flashcard cards (>95%)', async () => {
    const mockEstimate = () => Promise.resolve({ usage: 96000000, quota: 100000000 });
    vi.stubGlobal('navigator', { storage: { estimate: mockEstimate } });

    const mature = { uid: 'fc-mature', repetitions: 10, nextReviewAt: new Date(Date.now() + 400 * 86400000).toISOString() };
    const overdue = { uid: 'fc-overdue', repetitions: 10, nextReviewAt: new Date(Date.now() - 10 * 86400000).toISOString() };
    await put('flashcardTracker', mature);
    await put('flashcardTracker', overdue);

    const result = await quotaModule.evict();
    expect(result.stage3).toBeGreaterThanOrEqual(1);
    const remaining = await getAll('flashcardTracker');
    expect(remaining.map(r => r.uid)).not.toContain('fc-mature');
    expect(remaining.map(r => r.uid)).toContain('fc-overdue');
    await clear('flashcardTracker');
  });
});
