import { put } from './storage.js';
import { DEFAULT_STATE } from './sm2.js';

const MIGRATED_FLAG = 'osler_migrated_v1';

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
  } catch {}
}

export async function migrateFromV5() {
  if (isMigrated()) return { migrated: false, reason: 'already migrated' };

  const results = { quiz: 0, flashcard: 0, unknown: 0 };

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
        await migrateQuizEntry(data);
        results.quiz++;
      } else if (key.startsWith('osler_flashcard_')) {
        await migrateFlashcardEntry(data);
        results.flashcard++;
      } else {
        results.unknown++;
      }
    } catch {
      results.unknown++;
    }
  }

  markMigrated();
  return { migrated: true, results };
}

export async function runMigrationIfNeeded() {
  if (isMigrated()) return { migrated: false, reason: 'already migrated' };
  return migrateFromV5();
}

async function migrateQuizEntry(data) {
  const contentUid = data.contentUid || data.uid || 'unknown';
  const itemId = data.itemId || data.id || (Array.isArray(data.items) ? data.items.map(i => i.id).join(',') : 'unknown');

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
}

async function migrateFlashcardEntry(data) {
  const entry = {
    uid: data.uid || data.id || 'unknown',
    ...DEFAULT_STATE,
    totalReviews: data.totalReviews || 0,
    lapses: data.lapses || 0,
    updatedAt: new Date().toISOString(),
  };

  await put('flashcardTracker', entry);
}
