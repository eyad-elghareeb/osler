import { describe, it, expect } from 'vitest';
import { validate, validateOrThrow, isKnownVersion, getKnownVersions } from '../../../src/lib/validate.js';

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

  it('fails when correct index >= options length (quiz)', () => {
    const bad = {
      ...validQuiz,
      questions: [{ ...validQuiz.questions[0], correct: 3 }], // only 3 options (0,1,2)
    };
    const result = validate(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('outside options length'))).toBe(true);
  });

  it('fails when correct index >= options length (bank passages)', () => {
    const bankContent = {
      type: 'bank',
      meta: { ...validQuiz.meta, uid: 'bank-001' },
      passages: [
        {
          id: 'p1',
          title: 'Passage 1',
          questions: [
            { id: 'q1', question: '?', options: ['A', 'B'], correct: 5 },
          ],
        },
      ],
    };
    const result = validate(bankContent);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.instancePath?.includes('passages/0/questions/0'))).toBe(true);
  });
});

describe('V19 schemaVersion enforcement', () => {
  it('rejects missing meta.schemaVersion', () => {
    const noVersion = {
      ...validQuiz,
      meta: { ...validQuiz.meta, schemaVersion: undefined },
    };
    delete noVersion.meta.schemaVersion;
    const result = validate(noVersion);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('schemaVersion is missing'))).toBe(true);
  });

  it('rejects unknown schemaVersion (e.g. "9.9")', () => {
    const unknown = {
      ...validQuiz,
      meta: { ...validQuiz.meta, schemaVersion: '9.9' },
    };
    const result = validate(unknown);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Unknown schemaVersion'))).toBe(true);
  });

  it('accepts known schemaVersion "1.0"', () => {
    expect(isKnownVersion('quiz', '1.0')).toBe(true);
    expect(isKnownVersion('bank', '1.0')).toBe(true);
    expect(isKnownVersion('flashcard', '1.0')).toBe(true);
    expect(isKnownVersion('written', '1.0')).toBe(true);
    expect(isKnownVersion('osce', '1.0')).toBe(true);
    expect(isKnownVersion('hub', '1.0')).toBe(true);
  });

  it('getKnownVersions returns the set of registered versions', () => {
    const versions = getKnownVersions('quiz');
    expect(versions.size).toBeGreaterThan(0);
    expect(versions.has('1.0')).toBe(true);
  });

  it('isKnownVersion returns false for unregistered type', () => {
    expect(isKnownVersion('unknownType', '1.0')).toBe(false);
  });
});

describe('validateOrThrow', () => {
  it('returns content on valid', () => {
    expect(validateOrThrow(validQuiz)).toBe(validQuiz);
  });

  it('throws on invalid', () => {
    expect(() => validateOrThrow({})).toThrow('Validation failed');
  });

  it('throws on unknown schemaVersion', () => {
    const unknown = { ...validQuiz, meta: { ...validQuiz.meta, schemaVersion: '2.0' } };
    expect(() => validateOrThrow(unknown)).toThrow('Unknown schemaVersion');
  });
});
