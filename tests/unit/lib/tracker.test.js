import { describe, it, expect, beforeEach } from 'vitest';
import { clear } from '../../../src/lib/storage.js';
import {
  recordQuizAnswer, flagQuizItem, getQuizProgress,
  rateFlashcard, getDueFlashcards, getFlashcardState,
  getQuizStats, recordWrittenAnswer, recordOsceAnswer,
} from '../../../src/lib/tracker.js';
import { DEFAULT_STATE } from '../../../src/lib/sm2.js';

describe('tracker.js', () => {
  beforeEach(async () => {
    await clear('quizTracker');
    await clear('flashcardTracker');
    await clear('writtenTracker');
    await clear('osceTracker');
  });

  it('recordQuizAnswer tracks wrong count and consecutive correct', async () => {
    const r1 = await recordQuizAnswer('quiz-1', 'q1', true);
    expect(r1.consecutiveCorrect).toBe(1);
    expect(r1.wrongCount).toBe(0);

    const r2 = await recordQuizAnswer('quiz-1', 'q1', false);
    expect(r2.consecutiveCorrect).toBe(0);
    expect(r2.wrongCount).toBe(1);

    const r3 = await recordQuizAnswer('quiz-1', 'q1', true);
    expect(r3.consecutiveCorrect).toBe(1);
    expect(r3.wrongCount).toBe(1);
  });

  it('flagQuizItem toggles flag state', async () => {
    const f1 = await flagQuizItem('quiz-1', 'q2', true);
    expect(f1.flagged).toBe(true);

    const f2 = await flagQuizItem('quiz-1', 'q2', false);
    expect(f2.flagged).toBe(false);
  });

  it('rateFlashcard Good twice grows interval', async () => {
    const r1 = await rateFlashcard('card-1', 2, 5000);
    expect(r1.interval).toBe(1);
    expect(r1.totalReviews).toBe(1);
    expect(r1.avgTimePerReview).toBe(5000);

    const r2 = await rateFlashcard('card-1', 2, 3000);
    expect(r2.interval).toBe(6);
    expect(r2.totalReviews).toBe(2);
    expect(r2.avgTimePerReview).toBe(4000);
  });

  it('getDueFlashcards returns only due cards', async () => {
    const farFuture = new Date(Date.now() + 365 * 86400000).toISOString();
    const { put } = await import('../../../src/lib/storage.js');
    await put('flashcardTracker', { uid: 'future-card', ...DEFAULT_STATE, nextReviewAt: farFuture });

    const due = await getDueFlashcards(['never-reviewed-card', 'future-card']);
    const dueUids = due.map(d => d.uid);
    expect(dueUids).toContain('never-reviewed-card');
    expect(dueUids).not.toContain('future-card');
  });

  it('getQuizStats aggregates correctly', async () => {
    await recordQuizAnswer('stats-quiz', 'q1', true);
    await recordQuizAnswer('stats-quiz', 'q2', false);
    await recordQuizAnswer('stats-quiz', 'q3', true);
    await flagQuizItem('stats-quiz', 'q2', true);

    const stats = await getQuizStats('stats-quiz');
    expect(stats.total).toBe(3);
    expect(stats.wrong).toBe(1);
    expect(stats.flagged).toBe(1);
    expect(stats.totalAttempts).toBe(3);
  });

  it('recordWrittenAnswer tracks attempts and avg score', async () => {
    const r1 = await recordWrittenAnswer('written-1', [8, 7], 120000);
    expect(r1.attempts).toBe(1);
    expect(r1.avgRubricScore).toBeCloseTo(7.5, 1);

    const r2 = await recordWrittenAnswer('written-1', [9, 9], 90000);
    expect(r2.attempts).toBe(2);
    expect(r2.avgRubricScore).toBeCloseTo(8.25, 1);
  });

  it('recordOsceAnswer tracks per-station scores', async () => {
    await recordOsceAnswer('osce-1', 'station-a', 85, 600000);
    await recordOsceAnswer('osce-1', 'station-b', 92, 540000);
    const { get } = await import('../../../src/lib/storage.js');
    const osceData = await get('osceTracker', 'osce-1');
    expect(osceData.stationResults['station-a'].bestScore).toBe(85);
    expect(osceData.stationResults['station-b'].bestScore).toBe(92);
    expect(osceData.stationResults['station-a'].attempts).toBe(1);
  });
});
