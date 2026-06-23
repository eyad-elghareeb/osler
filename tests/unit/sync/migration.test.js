import { describe, it, expect, beforeEach } from 'vitest';
import { clear } from '../../../src/lib/storage.js';

describe('migration.js', () => {
  beforeEach(async () => {
    await clear('quizTracker');
    await clear('flashcardTracker');

    const prefix = 'osler_';
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix) || k === 'osler_migrated_v1') keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  });

  it('skips migration if already migrated', async () => {
    localStorage.setItem('osler_migrated_v1', 'true');

    const { migrateFromV5 } = await import('../../../src/lib/migration.js');
    const result = await migrateFromV5();
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('already migrated');
  });

  it('migrates quiz data correctly', async () => {
    localStorage.setItem('osler_quiz_cardio', JSON.stringify({
      contentUid: 'cardio',
      itemId: 'q1',
      wrongCount: 3,
      consecutiveCorrect: 0,
      flagged: true,
      highlights: ['important'],
      notes: 'review later',
      attempts: 4,
      updatedAt: '2026-01-01T00:00:00Z',
    }));

    const { migrateFromV5 } = await import('../../../src/lib/migration.js');
    const result = await migrateFromV5();
    expect(result.migrated).toBe(true);
    expect(result.results.quiz).toBe(1);

    const { get } = await import('../../../src/lib/storage.js');
    const entry = await get('quizTracker', ['cardio', 'q1']);
    expect(entry).not.toBeNull();
    expect(entry.wrongCount).toBe(3);
    expect(entry.flagged).toBe(true);
    expect(entry.highlights).toContain('important');
  });

  it('does not delete v5 keys after migration', async () => {
    localStorage.setItem('osler_quiz_example', JSON.stringify({
      contentUid: 'example', itemId: 'q1', wrongCount: 1,
    }));

    const { migrateFromV5 } = await import('../../../src/lib/migration.js');
    await migrateFromV5();

    expect(localStorage.getItem('osler_quiz_example')).not.toBeNull();
    expect(localStorage.getItem('osler_migrated_v1')).toBe('true');
  });
});
