import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Gemini client so no real network calls happen.
// Singleton client object so test overrides persist across calls.
const _mockClient = {
  request: () => Promise.resolve('{}'),
  // `tryRequests` is replaced per-test via `_mockClient.tryRequests = ...`.
  tryRequests: async (system) => {
    if (system.includes('content planner')) {
      return JSON.stringify({
        title: 'Test Quiz', description: 'Test description', count: 2,
        topics: ['topic1'], difficulty: 3, tags: ['test'],
      });
    }
    if (system.includes('content extractor')) {
      return JSON.stringify([
        { question: 'Q1 is a long enough question', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: 'Long enough explanation here', difficulty: 3 },
        { question: 'Q2 is a long enough question', options: ['A', 'B', 'C', 'D'], correct: 1, explanation: 'Another long explanation', difficulty: 4 },
      ]);
    }
    if (system.includes('content formatter')) {
      return JSON.stringify({
        type: 'quiz',
        meta: {
          uid: 'gen_quiz_001', title: 'Test Quiz', description: 'Test description',
          schemaVersion: '1.0',
          createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z',
        },
        questions: [
          { id: 'q_001', question: 'Q1 is a long enough question', options: ['A', 'B', 'C', 'D'], correct: 0, explanation: 'Long enough explanation here', difficulty: 3, tags: ['test'] },
          { id: 'q_002', question: 'Q2 is a long enough question', options: ['A', 'B', 'C', 'D'], correct: 1, explanation: 'Another long explanation', difficulty: 4, tags: ['test'] },
        ],
      });
    }
    return '{}';
  },
  extractText: x => x,
  friendlyError: e => e.message,
  readKey: () => 'fake-key',
  writeKey: () => {},
  hasKey: () => true,
};

vi.mock('../../../src/lib/gemini.js', () => ({
  MODELS: [
    ['gemini-3.1-flash-lite', 'Flash-Lite (default)'],
    ['gemini-3.5-flash', 'Flash (latest)'],
    ['gemini-3.1-pro-preview', 'Pro Preview'],
    ['gemma-4-26b-a4b-it', 'Gemma 4 26B'],
    ['gemma-4-31b-it', 'Gemma 4 31B'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash (fallback)'],
  ],
  readKey: () => 'fake-key',
  writeKey: () => {},
  hasKey: () => true,
  getClient: () => _mockClient,
}));

// Mock storage so cost tracking writes are observable without IndexedDB.
const _settingsStore = new Map();
vi.mock('../../../src/lib/storage.js', () => ({
  get: vi.fn(async (_store, key) => _settingsStore.has(key) ? _settingsStore.get(key) : null),
  put: vi.fn(async (_store, value) => { _settingsStore.set(value.key, value); }),
  clear: vi.fn(async () => { _settingsStore.clear(); }),
}));

import { generateContent, getAICosts, resetAICosts, DAILY_CAP, MONTHLY_CAP } from '../../../src/lib/content-gen.js';

describe('content-gen.js (Phase 6.5 fixes)', () => {
  beforeEach(async () => {
    _settingsStore.clear();
    await resetAICosts();
  });

  it('exports cap constants so the dashboard can reuse them (Phase 6.5 medium fix)', () => {
    expect(DAILY_CAP).toBe(20);
    expect(MONTHLY_CAP).toBe(200);
  });

  it('runs the 3-stage pipeline and returns the documented shape', async () => {
    const result = await generateContent('cardiology basics', 'quiz', { count: 2 });

    expect(result.content).toBeDefined();
    expect(result.content.type).toBe('quiz');
    expect(result.content.questions.length).toBe(2);
    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.stages.length).toBe(3);
    expect(result.stages.map(s => s.name)).toEqual(['outline', 'extract', 'convert']);
    // Phase 6.5 fix #6: model names sourced from MODELS, not hardcoded.
    expect(result.stages[0].model).toBe('gemini-3.1-flash-lite');
    expect(result.stages[1].model).toBe('gemini-3.1-flash-lite');
    expect(result.stages[2].model).toBe('gemini-3.1-pro-preview');
    // Phase 6.5 fix #4: validate() runs and the result surfaces schema validity.
    expect(typeof result.schemaValid).toBe('boolean');
    expect(Array.isArray(result.validationErrors)).toBe(true);
  });

  it('marks content as Needs Review when schema validation fails', async () => {
    // Override the formatter mock to return content with an out-of-range
    // `correct` index — validate() should reject it.
    const originalTryRequests = _mockClient.tryRequests;
    _mockClient.tryRequests = async (system) => {
      if (system.includes('content formatter')) {
        return JSON.stringify({
          type: 'quiz',
          meta: {
            uid: 'gen_quiz_bad', title: 'Bad', description: 'Bad',
            schemaVersion: '1.0',
            createdAt: '2026-06-24T00:00:00Z', updatedAt: '2026-06-24T00:00:00Z',
          },
          questions: [
            { id: 'q_001', question: 'Q1 long enough question text here', options: ['A', 'B', 'C', 'D'], correct: 99, explanation: 'Long enough explanation text here', difficulty: 3, tags: ['t'] },
          ],
        });
      }
      return originalTryRequests(system);
    };

    try {
      const result = await generateContent('bad quiz', 'quiz', { count: 1 });
      expect(result.schemaValid).toBe(false);
      expect(result.validationErrors.length).toBeGreaterThan(0);
      expect(result.needsReview).toBe(true);
      expect(result.content.meta.aiQualityAlert).toBe('Needs Review');
      expect(result.content.meta.aiValidationErrors).toBeDefined();
    } finally {
      // Restore
      _mockClient.tryRequests = originalTryRequests;
    }
  });

  it('persists cost tracking to the IndexedDB settings store (Phase 6.5 fix #5)', async () => {
    await generateContent('cardiology basics', 'quiz', { count: 2 });

    const costs = await getAICosts();
    expect(costs.today).toBeGreaterThan(0);
    expect(costs.month).toBeGreaterThan(0);
    // The settings store entry should exist with the canonical key.
    expect(_settingsStore.has('aiCosts')).toBe(true);
  });

  it('enforces daily cost cap', async () => {
    // Pre-populate the settings store so today's cost is already at the cap.
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    _settingsStore.set('aiCosts', { key: 'aiCosts', value: { today: DAILY_CAP, month: DAILY_CAP, date: today, monthKey } });

    await expect(generateContent('capped', 'quiz', { count: 1 }))
      .rejects
      .toThrow(/Daily AI cost cap reached/);
  });
});
