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
      if (k?.startsWith(prefix) || k === 'osler_migrated_v1' || k === 'osler_migration_errors_v1') keysToRemove.push(k);
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

  // Phase 6.5 fix (medium): cover the H1 error-recording path that was
  // previously untested. Three scenarios: (a) missing contentUid → recorded,
  // (b) missing itemId → recorded, (c) migration flag NOT set when errors>0.
  it('records migration errors for entries missing contentUid', async () => {
    // Missing contentUid and uid — should be skipped + recorded.
    localStorage.setItem('osler_quiz_bad1', JSON.stringify({
      itemId: 'q1', wrongCount: 1,
    }));

    const { migrateFromV5, getMigrationErrors } = await import('../../../src/lib/migration.js');
    const result = await migrateFromV5();

    expect(result.migrated).toBe(false);
    expect(result.results.errors).toBe(1);
    expect(localStorage.getItem('osler_migrated_v1')).toBeNull();

    const errors = getMigrationErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].key).toBe('osler_quiz_bad1');
    expect(errors[0].reason).toContain('contentUid');
  });

  it('records migration errors for entries missing itemId', async () => {
    localStorage.setItem('osler_quiz_bad2', JSON.stringify({
      contentUid: 'cardio', wrongCount: 1,
    }));

    const { migrateFromV5, getMigrationErrors } = await import('../../../src/lib/migration.js');
    const result = await migrateFromV5();

    expect(result.migrated).toBe(false);
    const errors = getMigrationErrors();
    expect(errors.length).toBe(1);
    expect(errors[0].reason).toContain('itemId');
  });

  it('returns empty array from getMigrationErrors when no errors recorded', async () => {
    const { getMigrationErrors } = await import('../../../src/lib/migration.js');
    expect(getMigrationErrors()).toEqual([]);
  });
});
