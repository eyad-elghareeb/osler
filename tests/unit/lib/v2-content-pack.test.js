// =============================================================================
// tests/unit/lib/v2-content-pack.test.js  —  V2 (Phase 10)
// -----------------------------------------------------------------------------
// Unit tests for content pack export/import.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakedDB } from '../../setup.js';

vi.mock('../../../src/lib/firebase.js', () => ({
  isFirebaseEnabled: () => false,
  storage: null,
}));

vi.mock('../../../src/lib/auth.js', () => ({
  currentUser: () => ({ uid: 'test-user', displayName: 'Test User' }),
}));

vi.mock('../../../src/lib/user-content.js', () => ({
  listUserContent: vi.fn(),
  createUserContent: vi.fn(),
  updateUserContent: vi.fn(),
}));

import {
  buildContentPack,
  parseContentPack,
  exportContentPack,
  importContentPack,
  PACK_FORMAT,
  PACK_VERSION,
} from '../../../src/lib/content-pack.js';
import { put, getAll } from '../../../src/lib/storage.js';

describe('content-pack (V2)', () => {
  let faked;

  beforeEach(() => {
    faked = new FakedDB();
    global.indexedDB = faked;
  });

  describe('buildContentPack', () => {
    it('builds a pack with correct format metadata', () => {
      const items = [{
        type: 'quiz',
        meta: { uid: 'q1', title: 'Test Quiz', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
        questions: [],
      }];

      const pack = buildContentPack(items);

      expect(pack.packFormat).toBe(PACK_FORMAT);
      expect(pack.packVersion).toBe(PACK_VERSION);
      expect(pack.exportedAt).toBeTruthy();
      expect(pack.exportedBy.uid).toBe('test-user');
      expect(pack.items).toHaveLength(1);
    });

    it('throws when items array is empty', () => {
      expect(() => buildContentPack([])).toThrow();
    });
  });

  describe('parseContentPack', () => {
    it('parses a valid pack', () => {
      const validPack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '1.0',
        exportedAt: '2026-06-27T00:00:00Z',
        exportedBy: { uid: 'u1', displayName: 'User' },
        items: [{
          type: 'quiz',
          meta: { uid: 'q1', title: 'Q1', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
          settings: {},
          questions: [{
            id: 'qq1', stem: '?', options: [{ id: 'a', text: 'A', correct: true }],
          }],
        }],
      });

      const result = parseContentPack(validPack);

      expect(result.valid).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.packMeta.itemCount).toBe(1);
    });

    it('rejects unknown packFormat', () => {
      const badPack = JSON.stringify({
        packFormat: 'something-else',
        packVersion: '1.0',
        items: [],
      });

      const result = parseContentPack(badPack);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Unknown packFormat');
    });

    it('rejects unsupported packVersion', () => {
      const badPack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '99.0',
        items: [],
      });

      const result = parseContentPack(badPack);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Unsupported packVersion');
    });

    it('rejects malformed JSON', () => {
      const result = parseContentPack('{ not valid json');
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Invalid JSON');
    });

    it('detects duplicate UIDs within a pack', () => {
      const dupPack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '1.0',
        exportedAt: '...',
        items: [
          { type: 'quiz', meta: { uid: 'dup', title: 'A', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' }, questions: [] },
          { type: 'quiz', meta: { uid: 'dup', title: 'B', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' }, questions: [] },
        ],
      });

      const result = parseContentPack(dupPack);

      // Items may still be valid individually but the duplicate is flagged
      const dupError = result.errors.find(e => e.message.includes('Duplicate'));
      expect(dupError).toBeTruthy();
    });
  });

  describe('importContentPack', () => {
    it('imports valid items to IndexedDB', async () => {
      const pack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '1.0',
        exportedAt: '2026-06-27T00:00:00Z',
        items: [{
          type: 'flashcard',
          meta: { uid: 'fc-001', title: 'Cards', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
          settings: {},
          cards: [{ id: 'c1', front: 'F', back: 'B' }],
        }],
      });

      const result = await importContentPack(pack, { onConflict: 'skip' });

      expect(result.imported).toBe(1);

      const stored = await getAll('userContent');
      expect(stored).toHaveLength(1);
      expect(stored[0].uid).toBe('fc-001');
    });

    it('skips items that already exist locally (onConflict=skip)', async () => {
      // Pre-seed with the same UID
      await put('userContent', {
        uid: 'fc-001',
        meta: { uid: 'fc-001', updatedAt: '2026-06-20T00:00:00Z' },
      });

      const pack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '1.0',
        exportedAt: '2026-06-27T00:00:00Z',
        items: [{
          type: 'flashcard',
          meta: { uid: 'fc-001', title: 'New', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
          cards: [],
        }],
      });

      const result = await importContentPack(pack, { onConflict: 'skip' });

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('overwrites existing items when onConflict=overwrite', async () => {
      await put('userContent', {
        uid: 'fc-001',
        meta: { uid: 'fc-001', title: 'Old', updatedAt: '2026-06-20T00:00:00Z' },
      });

      const pack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '1.0',
        exportedAt: '2026-06-27T00:00:00Z',
        items: [{
          type: 'flashcard',
          meta: { uid: 'fc-001', title: 'New Title', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
          cards: [],
        }],
      });

      const result = await importContentPack(pack, { onConflict: 'overwrite' });

      expect(result.imported).toBe(1);

      const stored = await getAll('userContent');
      expect(stored[0].meta.title).toBe('New Title');
    });

    it('renames items when onConflict=rename', async () => {
      await put('userContent', {
        uid: 'fc-001',
        meta: { uid: 'fc-001', updatedAt: '2026-06-20T00:00:00Z' },
      });

      const pack = JSON.stringify({
        packFormat: 'osler-content-pack',
        packVersion: '1.0',
        exportedAt: '2026-06-27T00:00:00Z',
        items: [{
          type: 'flashcard',
          meta: { uid: 'fc-001', title: 'Imported', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
          cards: [],
        }],
      });

      const result = await importContentPack(pack, { onConflict: 'rename' });

      expect(result.imported).toBe(1);
      expect(result.renamed).toBe(1);

      const stored = await getAll('userContent');
      // Both the original and the renamed import should be present
      expect(stored.length).toBeGreaterThanOrEqual(2);
      const renamed = stored.find(i => i.meta.importedFrom === 'fc-001');
      expect(renamed).toBeTruthy();
      expect(renamed.meta.uid).not.toBe('fc-001');
    });
  });
});
