// =============================================================================
// tests/unit/lib/v2-sync-user-content.test.js  —  V2 (Phase 9)
// -----------------------------------------------------------------------------
// Unit tests for the V2 user content sync layer.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakedDB } from '../../setup.js';

// Mock Firebase modules before importing
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('../../../src/lib/firebase.js', () => ({
  db: {},
  isFirebaseEnabled: () => true,
}));

vi.mock('../../../src/lib/sync-utils.js', () => ({
  getDeviceId: () => 'test-device-001',
}));

vi.mock('../../../src/lib/sync.js', () => ({
  fieldMergeByUpdatedAt: (local, remote) => remote || local,
}));

import { pushUserContent, pullUserContent, syncUserContent } from '../../../src/lib/sync-user-content.js';
import { put, getAll, get } from '../../../src/lib/storage.js';
import * as firestore from 'firebase/firestore';

describe('sync-user-content (V2)', () => {
  let faked;

  beforeEach(() => {
    faked = new FakedDB();
    global.indexedDB = faked;
    vi.clearAllMocks();
  });

  describe('pushUserContent', () => {
    it('returns skipped=0 when Firebase is disabled', async () => {
      vi.doMock('../../../src/lib/firebase.js', () => ({ isFirebaseEnabled: () => false }));
      const { pushUserContent: push } = await import('../../../src/lib/sync-user-content.js');
      const result = await push('uid-123');
      expect(result.pushed).toBe(0);
    });

    it('pushes local items to Firestore when remote is older', async () => {
      // Seed local with one item
      const localItem = {
        uid: 'item-001',
        type: 'quiz',
        meta: { uid: 'item-001', title: 'Test', updatedAt: '2026-06-27T10:00:00Z', schemaVersion: '1.0' },
        questions: [],
      };
      await put('userContent', localItem);

      // Mock getDoc to return an older remote item
      firestore.getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          ...localItem,
          meta: { ...localItem.meta, updatedAt: '2026-06-26T10:00:00Z' },
        }),
      });

      firestore.setDoc.mockResolvedValue(undefined);

      const result = await pushUserContent('uid-123');

      expect(result.pushed).toBe(1);
      expect(firestore.setDoc).toHaveBeenCalled();
    });

    it('skips items where remote is newer or equal', async () => {
      const localItem = {
        uid: 'item-001',
        type: 'quiz',
        meta: { uid: 'item-001', updatedAt: '2026-06-27T10:00:00Z' },
        questions: [],
      };
      await put('userContent', localItem);

      // Remote has the same timestamp — should skip (remote wins on tie)
      firestore.getDoc.mockResolvedValue({
        exists: () => true,
        data: () => localItem,
      });

      const result = await pushUserContent('uid-123');

      expect(result.pushed).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('pullUserContent', () => {
    it('pulls remote items and writes to IndexedDB', async () => {
      // Empty local
      firestore.getDocs.mockResolvedValue({
        docs: [{
          data: () => ({
            uid: 'remote-item-001',
            type: 'flashcard',
            meta: { uid: 'remote-item-001', updatedAt: '2026-06-27T12:00:00Z' },
            cards: [],
          }),
        }],
      });

      const result = await pullUserContent('uid-123');

      expect(result.pulled).toBe(1);

      const local = await get('userContent', 'remote-item-001');
      expect(local).toBeTruthy();
      expect(local.uid).toBe('remote-item-001');
    });

    it('merges remote with local using fieldMergeByUpdatedAt', async () => {
      // Seed local
      const localItem = {
        uid: 'item-001',
        meta: { uid: 'item-001', updatedAt: '2026-06-27T10:00:00Z' },
      };
      await put('userContent', localItem);

      firestore.getDocs.mockResolvedValue({
        docs: [{
          data: () => ({
            ...localItem,
            meta: { ...localItem.meta, updatedAt: '2026-06-27T12:00:00Z' },
          }),
        }],
      });

      await pullUserContent('uid-123');

      const merged = await get('userContent', 'item-001');
      expect(merged.meta.updatedAt).toBe('2026-06-27T12:00:00Z');
    });
  });

  describe('syncUserContent', () => {
    it('runs push then pull', async () => {
      firestore.getDoc.mockResolvedValue({ exists: () => false });
      firestore.setDoc.mockResolvedValue(undefined);
      firestore.getDocs.mockResolvedValue({ docs: [] });

      const result = await syncUserContent('uid-123');

      expect(result).toHaveProperty('pushed');
      expect(result).toHaveProperty('pulled');
      expect(result).toHaveProperty('merged');
      expect(result).toHaveProperty('errors');
    });
  });
});
