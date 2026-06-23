import { describe, it, expect } from 'vitest';
import { validate, validateOrThrow } from '../../../src/lib/validate.js';

const validQuiz = {
  type: 'quiz',
  meta: {
    uid: 'test-001',
    title: 'Test Quiz',
    schemaVersion: '1.0',
    createdAt: '2026-06-23T00:00:00Z',
    updatedAt: '2026-06-23T00:00:00Z',
  },
  questions: [
    { id: 'q1', question: 'Test question?', options: ['A', 'B', 'C'], correct: 0 },
  ],
};

describe('validate', () => {
  it('passes a valid quiz', () => {
    expect(validate(validQuiz).valid).toBe(true);
  });

  it('fails when type is missing', () => {
    const result = validate({ meta: validQuiz.meta, questions: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails when correct index is negative', () => {
    const bad = {
      ...validQuiz,
      questions: [{ ...validQuiz.questions[0], correct: -1 }],
    };
    expect(validate(bad).valid).toBe(false);
  });
});

describe('validateOrThrow', () => {
  it('returns content on valid', () => {
    expect(validateOrThrow(validQuiz)).toBe(validQuiz);
  });

  it('throws on invalid', () => {
    expect(() => validateOrThrow({})).toThrow('Validation failed');
  });
});
