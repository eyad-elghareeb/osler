import { put } from './storage.js';
import { DEFAULT_STATE } from './sm2.js';

const MIGRATED_FLAG = 'osler_migrated_v1';
const MIGRATION_ERRORS_FLAG = 'osler_migration_errors_v1';

export function isMigrated() {
  try {
    return localStorage.getItem(MIGRATED_FLAG) === 'true';
  } catch {
    return false;
  }
}

export function markMigrated() {
  try {
    localStorage.setItem(MIGRATED_FLAG, 'true');
  } catch (e) {
    console.warn('[migration] Could not set migrated flag:', e);
  }
}

/**
 * Read any recorded migration errors from a prior run. Useful for surfacing
 * to the user that some legacy data couldn't be migrated.
 */
export function getMigrationErrors() {
  try {
    const raw = localStorage.getItem(MIGRATION_ERRORS_FLAG);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function recordMigrationError(error) {
  try {
    const errors = getMigrationErrors();
    errors.push({ ...error, ts: new Date().toISOString() });
    // Cap at 100 errors to avoid unbounded localStorage growth.
    if (errors.length > 100) errors.splice(0, errors.length - 100);
    localStorage.setItem(MIGRATION_ERRORS_FLAG, JSON.stringify(errors));
  } catch (e) {
    console.warn('[migration] Could not record migration error:', e);
  }
}

/**
 * Migrate v5 localStorage data to v1 IndexedDB.
 *
 * H1 fix: do NOT silently drop entries with missing identifying fields.
 * If contentUid/itemId/uid is missing, record the error and skip the entry
 * rather than collapsing multiple entries onto an 'unknown' composite key
 * (which would silently overwrite each other).
 *
 * H1 fix: do NOT mark migration complete if any errors occurred, so a future
 * run can retry. The user can manually dismiss via getMigrationErrors().
 */
export async function migrateFromV5() {
  if (isMigrated()) return { migrated: false, reason: 'already migrated' };

  const results = { quiz: 0, flashcard: 0, unknown: 0, errors: 0 };

  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('osler_')) keys.push(key);
  }

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);

      if (key.startsWith('osler_quiz_')) {
        const migrated = await migrateQuizEntry(data, key);
        if (migrated) results.quiz++;
        else results.errors++;
      } else if (key.startsWith('osler_flashcard_')) {
        const migrated = await migrateFlashcardEntry(data, key);
        if (migrated) results.flashcard++;
        else results.errors++;
      } else {
        results.unknown++;
        recordMigrationError({ key, reason: 'unrecognized key prefix' });
      }
    } catch (e) {
      results.errors++;
      recordMigrationError({ key, reason: `parse/migrate failed: ${e.message}` });
      console.warn(`[migration] Failed to migrate ${key}:`, e);
    }
  }

  // Only mark migrated if no errors occurred. Otherwise, leave the flag unset
  // so a future run (e.g. after a code fix) can retry.
  if (results.errors === 0) {
    markMigrated();
  } else {
    console.warn(
      `[migration] ${results.errors} entries could not be migrated. ` +
      `Migration flag NOT set — next run will retry. See getMigrationErrors() for details.`
    );
  }
  return { migrated: results.errors === 0, results };
}

export async function runMigrationIfNeeded() {
  if (isMigrated()) return { migrated: false, reason: 'already migrated' };
  return migrateFromV5();
}

/**
 * Migrate a v5 quiz entry to the v1 quizTracker store.
 * Returns true if migrated, false if skipped (missing required fields).
 */
async function migrateQuizEntry(data, sourceKey) {
  const contentUid = data.contentUid || data.uid;
  // For quiz items, itemId may be on the data itself or derived from the
  // source localStorage key (v5 stored one item per key in some cases).
  const itemId = data.itemId || data.id;

  if (!contentUid || !itemId) {
    recordMigrationError({
      key: sourceKey,
      reason: `missing required field: ${!contentUid ? 'contentUid' : 'itemId'}`,
    });
    return false;
  }

  const entry = {
    contentUid,
    itemId,
    wrongCount: data.wrongCount || 0,
    consecutiveCorrect: data.consecutiveCorrect || 0,
    flagged: data.flagged || false,
    highlights: data.highlights || [],
    notes: data.notes || '',
    attempts: data.attempts || 0,
    updatedAt: data.updatedAt || new Date().toISOString(),
  };

  await put('quizTracker', entry);
  return true;
}

/**
 * Migrate a v5 flashcard entry. v5 had no SM-2 data, so we seed DEFAULT_STATE
 * and preserve any totalReviews/lapses we find.
 * Returns true if migrated, false if skipped (missing uid).
 */
async function migrateFlashcardEntry(data, sourceKey) {
  const uid = data.uid || data.id;
  if (!uid) {
    recordMigrationError({
      key: sourceKey,
      reason: 'missing required field: uid',
    });
    return false;
  }

  const entry = {
    uid,
    ...DEFAULT_STATE,
    totalReviews: data.totalReviews || 0,
    lapses: data.lapses || 0,
    updatedAt: new Date().toISOString(),
  };

  await put('flashcardTracker', entry);
  return true;
}
