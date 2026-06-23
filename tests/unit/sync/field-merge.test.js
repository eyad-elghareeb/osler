import { describe, it, expect } from 'vitest';
import { fieldMergeByUpdatedAt } from '../../../src/lib/sync.js';

describe('fieldMergeByUpdatedAt', () => {
  it('returns remote when local is null', () => {
    const local = null;
    const remote = { wrongCount: 3, updatedAt: '2026-06-02T10:00:00Z' };
    expect(fieldMergeByUpdatedAt(local, remote)).toEqual(remote);
  });

  it('returns local when remote is null', () => {
    const local = { wrongCount: 3, updatedAt: '2026-06-02T10:00:00Z' };
    const remote = null;
    expect(fieldMergeByUpdatedAt(local, remote)).toEqual(local);
  });

  it('takes local fields when local updatedAt is newer', () => {
    const local = {
      wrongCount: 5, flagged: true, notes: 'local',
      updatedAt: '2026-06-03T10:00:00Z',
    };
    const remote = {
      wrongCount: 2, flagged: false, notes: 'remote',
      updatedAt: '2026-06-02T10:00:00Z',
    };
    const result = fieldMergeByUpdatedAt(local, remote);
    expect(result.wrongCount).toBe(5);
    expect(result.flagged).toBe(true);
    expect(result.notes).toBe('local');
    expect(result.updatedAt).toBe('2026-06-03T10:00:00Z');
  });

  it('per-field merge with different fields updated on each side', () => {
    const local = {
      wrongCount: 5, flagged: true,
      updatedAt: '2026-06-03T10:00:00Z',
    };
    const remote = {
      notes: 'remote note', flagged: false,
      updatedAt: '2026-06-02T10:00:00Z',
    };
    const result = fieldMergeByUpdatedAt(local, remote);
    expect(result.wrongCount).toBe(5);
    expect(result.flagged).toBe(true);
    expect(result.notes).toBe('remote note');
    expect(result.updatedAt).toBe('2026-06-03T10:00:00Z');
  });
});
