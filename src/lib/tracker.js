import { get, put, deleteEntry, getAll } from './storage.js';
import { nextReview, isDue, updateAvgTime, DEFAULT_STATE } from './sm2.js';

export async function getQuizProgress(contentUid, itemId) {
  return get('quizTracker', [contentUid, itemId]);
}

export async function recordQuizAnswer(contentUid, itemId, isCorrect) {
  const key = [contentUid, itemId];
  const existing = await get('quizTracker', key) || {
    contentUid, itemId, wrongCount: 0, consecutiveCorrect: 0, flagged: false,
    highlights: [], notes: '', attempts: 0, updatedAt: new Date().toISOString(),
  };
  existing.attempts = (existing.attempts || 0) + 1;
  if (isCorrect) {
    existing.consecutiveCorrect = (existing.consecutiveCorrect || 0) + 1;
  } else {
    existing.wrongCount = (existing.wrongCount || 0) + 1;
    existing.consecutiveCorrect = 0;
  }
  existing.updatedAt = new Date().toISOString();
  await put('quizTracker', existing);
  return existing;
}

export async function flagQuizItem(contentUid, itemId, flagged) {
  const key = [contentUid, itemId];
  const existing = await get('quizTracker', key) || {
    contentUid, itemId, wrongCount: 0, consecutiveCorrect: 0, flagged: false,
    highlights: [], notes: '', updatedAt: new Date().toISOString(),
  };
  existing.flagged = flagged;
  existing.updatedAt = new Date().toISOString();
  await put('quizTracker', existing);
  return existing;
}

export async function getFlashcardState(uid) {
  return get('flashcardTracker', uid);
}

export async function rateFlashcard(uid, rating, elapsedMs) {
  const existing = await get('flashcardTracker', uid) || { uid, ...DEFAULT_STATE };
  const updated = nextReview(existing, rating);
  if (elapsedMs != null) {
    updated.avgTimePerReview = updateAvgTime(existing, elapsedMs);
  }
  await put('flashcardTracker', updated);
  return updated;
}

export async function getDueFlashcards(uids) {
  const results = [];
  for (const uid of uids) {
    const state = await get('flashcardTracker', uid);
    if (isDue(state)) {
      results.push({ uid, state });
    }
  }
  return results;
}

export async function getWrittenProgress(uid) {
  return get('writtenTracker', uid);
}

export async function recordWrittenAnswer(uid, rubricResults, elapsedMs) {
  const existing = await get('writtenTracker', uid) || {
    uid, attempts: 0, avgRubricScore: 0, totalTimeMs: 0, updatedAt: null,
  };
  existing.attempts = (existing.attempts || 0) + 1;
  if (rubricResults?.length) {
    const avg = rubricResults.reduce((a, b) => a + b, 0) / rubricResults.length;
    existing.avgRubricScore = ((existing.avgRubricScore || 0) * (existing.attempts - 1) + avg) / existing.attempts;
  }
  existing.totalTimeMs = (existing.totalTimeMs || 0) + (elapsedMs || 0);
  existing.updatedAt = new Date().toISOString();
  await put('writtenTracker', existing);
  return existing;
}

export async function getOsceProgress(uid) {
  return get('osceTracker', uid);
}

export async function recordOsceAnswer(uid, stationId, score, elapsedMs) {
  const key = uid;
  const existing = await get('osceTracker', key) || {
    uid, stationResults: {}, totalTimeMs: 0, updatedAt: null,
  };
  existing.stationResults = existing.stationResults || {};
  existing.stationResults[stationId] = existing.stationResults[stationId] || { attempts: 0, bestScore: 0 };
  existing.stationResults[stationId].attempts += 1;
  if (score > (existing.stationResults[stationId].bestScore || 0)) {
    existing.stationResults[stationId].bestScore = score;
  }
  existing.totalTimeMs = (existing.totalTimeMs || 0) + (elapsedMs || 0);
  existing.updatedAt = new Date().toISOString();
  await put('osceTracker', existing);
  return existing;
}

export async function getQuizStats(contentUid) {
  const all = await getAll('quizTracker');
  const items = all.filter(i => i.contentUid === contentUid);
  const total = items.length;
  const wrong = items.filter(i => (i.wrongCount || 0) > 0).length;
  const flagged = items.filter(i => i.flagged).length;
  const totalAttempts = items.reduce((s, i) => s + (i.attempts || 0), 0);
  return { total, wrong, flagged, totalAttempts };
}
