import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { clear, put, getAll } from '../../src/lib/storage.js';
import { STORES } from '../../src/lib/storage.js';

const storeNames = STORES.map(s => s.name);
const UID = 'test-user-123';
const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';

let mockFirestoreData;

vi.mock('firebase/firestore', () => {
  const mockSet = vi.fn();
  const mockCommit = vi.fn();
  const mockBatch = { set: mockSet, commit: mockCommit };

  return {
    collection: vi.fn((_db, _path, ..._segments) => ({ path: _path, segments: _segments })),
    doc: vi.fn((_db, ..._pathSegments) => {
      const path = _pathSegments.join('/');
      return { id: path.split('/').pop(), path };
    }),
    getDoc: vi.fn(),
    getDocs: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
    setDoc: vi.fn(),
    writeBatch: vi.fn(() => mockBatch),
  };
});

vi.mock('../../src/lib/firebase.js', () => {
  const createMockRef = () => ({
    id: 'mock',
    get data() { return {}; },
  });
  const mockDb = {
    type: 'mock-firestore',
    _settings: {},
  };
  return { db: mockDb };
});

describe('Sync adapter integration — two-device sync', () => {
  beforeAll(async () => {
    mockFirestoreData = {};
    await Promise.all(storeNames.map(n => clear(n)));
  });

  afterAll(async () => {
    await Promise.all(storeNames.map(n => clear(n)));
  });

  it('syncPush sends quizTracker entry to Firestore', async () => {
    const sync = await import('../../src/lib/sync.js');
    const { writeBatch, doc, getDocs } = await import('firebase/firestore');

    const entryA = {
      contentUid: 'quiz-001', itemId: 'q-001', wrongCount: 0, flag: false,
      updatedAt: '2026-06-24T10:00:00Z', _deviceId: DEVICE_A,
    };
    await put('quizTracker', entryA);

    writeBatch.mockClear();

    const result = await sync.syncPush(UID);

    expect(writeBatch).toHaveBeenCalled();
    expect(result.length).toBeGreaterThanOrEqual(1);

    const quizStore = result.find(r => r.store === 'quizTracker');
    expect(quizStore).toBeDefined();
    expect(quizStore.pushed).toBeGreaterThanOrEqual(1);

    await clear('quizTracker');
  });

  it('syncPull merges remote flashcard entry into local store', async () => {
    const sync = await import('../../src/lib/sync.js');
    const { getDocs } = await import('firebase/firestore');

    const remoteEntry = {
      uid: 'fc-pulled-001', easeFactor: 2.5, interval: 1,
      repetitions: 0, lapses: 0, totalReviews: 3,
      lastReviewedAt: '2026-06-24T10:00:00Z', updatedAt: '2026-06-24T10:00:00Z',
    };

    getDocs.mockImplementation(async (ref) => {
      const storeName = ref.segments?.[ref.segments.length - 1];
      if (storeName === 'flashcardTracker') {
        return {
          empty: false,
          docs: [{
            id: 'fc-pulled-001',
            data: () => ({
              ...remoteEntry,
              _deviceId: DEVICE_B, _syncedAt: '2026-06-24T11:00:00Z',
            }),
          }],
        };
      }
      return { empty: true, docs: [] };
    });

    await sync.syncPull(UID);

    const local = await getAll('flashcardTracker');
    expect(local.length).toBeGreaterThanOrEqual(1);
    const pulled = local.find(l => l.uid === 'fc-pulled-001');
    expect(pulled).toBeDefined();
    expect(pulled.easeFactor).toBe(2.5);
    expect(pulled.totalReviews).toBe(3);

    await clear('flashcardTracker');
  });

  it('SM-2 merge sums totalReviews from two devices', async () => {
    const sync = await import('../../src/lib/sync.js');
    const { getDocs } = await import('firebase/firestore');

    const localEntry = {
      uid: 'fc-merge-001', easeFactor: 2.5, interval: 1,
      repetitions: 0, lapses: 0, totalReviews: 5,
      lastReviewedAt: '2026-06-23T10:00:00Z', updatedAt: '2026-06-23T10:00:00Z',
    };
    await put('flashcardTracker', localEntry);

    const remoteEntry = {
      uid: 'fc-merge-001', easeFactor: 1.8, interval: 4,
      repetitions: 2, lapses: 2, totalReviews: 7,
      lastReviewedAt: '2026-06-24T10:00:00Z', updatedAt: '2026-06-24T10:00:00Z',
    };

    getDocs.mockImplementation(async (ref) => {
      const storeName = ref.segments?.[ref.segments.length - 1];
      if (storeName === 'flashcardTracker') {
        return {
          empty: false,
          docs: [{
            id: 'fc-merge-001',
            data: () => ({
              ...remoteEntry,
              _deviceId: DEVICE_B, _syncedAt: '2026-06-24T11:00:00Z',
            }),
          }],
        };
      }
      return { empty: true, docs: [] };
    });

    await sync.syncPull(UID);

    const merged = sync.sm2Merge(localEntry, remoteEntry);
    expect(merged.totalReviews).toBe(12);
    expect(merged.lapses).toBe(2);
    expect(merged.interval).toBe(4);
    expect(merged.easeFactor).toBe(1.8);

    await clear('flashcardTracker');
  });

  it('appendOnly merge deduplicates studyEvents from both devices', async () => {
    const sync = await import('../../src/lib/sync.js');

    const local = [
      { ts: '2026-06-24T10:00:00Z', deviceId: DEVICE_A, action: 'answer', outcome: 'correct', contentUid: 'q-001', itemId: 'q-001' },
      { ts: '2026-06-24T10:01:00Z', deviceId: DEVICE_A, action: 'answer', outcome: 'wrong', contentUid: 'q-001', itemId: 'q-002' },
    ];
    const remote = [
      { ts: '2026-06-24T10:00:00Z', deviceId: DEVICE_A, action: 'answer', outcome: 'correct', contentUid: 'q-001', itemId: 'q-001' },
      { ts: '2026-06-24T11:00:00Z', deviceId: DEVICE_B, action: 'answer', outcome: 'correct', contentUid: 'q-002', itemId: 'q-001' },
    ];

    const merged = sync.appendOnly(local, remote);
    expect(merged.length).toBe(3);
    const keys = merged.map(e => `${e.ts}|${e.deviceId}|${e.action}|${e.outcome}|${e.contentUid}|${e.itemId}`);
    expect(new Set(keys).size).toBe(3);
  });

  it('fieldMergeByUpdatedAt picks newer field values per field', async () => {
    const sync = await import('../../src/lib/sync.js');

    const local = {
      uid: 'tracker-001', wrongCount: 2, flag: false, notes: 'old notes',
      updatedAt: '2026-06-23T10:00:00Z',
    };
    const remote = {
      uid: 'tracker-001', wrongCount: 5, flag: true, notes: 'updated notes',
      updatedAt: '2026-06-24T10:00:00Z',
    };

    const merged = sync.fieldMergeByUpdatedAt(local, remote);
    expect(merged.wrongCount).toBe(5);
    expect(merged.flag).toBe(true);
    expect(merged.notes).toBe('updated notes');
    expect(merged.updatedAt).toBe('2026-06-24T10:00:00Z');
  });

  it('lwwBodyKeepTitles preserves title conflicts', async () => {
    const sync = await import('../../src/lib/sync.js');

    const local = {
      uid: 'content-001', title: 'Cardiology Review', body: 'old version',
      updatedAt: '2026-06-23T10:00:00Z',
    };
    const remote = {
      uid: 'content-001', title: 'Cardiology Notes', body: 'new version',
      updatedAt: '2026-06-24T10:00:00Z',
    };

    const merged = sync.lwwBodyKeepTitles(local, remote);
    expect(merged.title).toBe('Cardiology Notes');
    expect(merged.body).toBe('new version');
    expect(merged.alternateTitles).toContain('Cardiology Review (2)');
  });

  it('maxStreak merges streak data correctly', async () => {
    const sync = await import('../../src/lib/sync.js');

    const local = { key: 'global', currentStreak: 3, longestStreak: 10, xp: 500, level: 5, lastActivityDate: '2026-06-23T00:00:00Z' };
    const remote = { key: 'global', currentStreak: 7, longestStreak: 7, xp: 300, level: 3, lastActivityDate: '2026-06-24T00:00:00Z' };

    const merged = sync.maxStreak(local, remote);
    expect(merged.currentStreak).toBe(7);
    expect(merged.longestStreak).toBe(10);
    expect(merged.xp).toBe(500);
    expect(merged.level).toBe(5);
    expect(merged.lastActivityDate).toBe('2026-06-24T00:00:00Z');
  });
});
