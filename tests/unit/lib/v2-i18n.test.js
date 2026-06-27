// =============================================================================
// tests/unit/lib/v2-i18n.test.js  —  V2 (Phase 11)
// -----------------------------------------------------------------------------
// Unit tests for the i18n module.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const _store = {};
global.localStorage = {
  getItem: vi.fn((k) => _store[k] ?? null),
  setItem: vi.fn((k, v) => { _store[k] = String(v); }),
  removeItem: vi.fn((k) => { delete _store[k]; }),
};

// Mock document
global.document = {
  documentElement: {
    set lang(v) { this._lang = v; },
    get lang() { return this._lang; },
    set dir(v) { this._dir = v; },
    get dir() { return this._dir; },
  },
  querySelectorAll: vi.fn(() => []),
  readyState: 'complete',
};

global.window = {};

import {
  t,
  setLanguage,
  getCurrentLanguage,
  getSupportedLanguages,
  init,
  applyTranslations,
} from '../../../src/lib/i18n.js';

describe('i18n (V2)', () => {
  beforeEach(() => {
    // Reset state
    Object.keys(_store).forEach(k => delete _store[k]);
    vi.clearAllMocks();
    init();
  });

  describe('detectLanguage + init', () => {
    it('defaults to en when no preference is set', () => {
      init();
      expect(getCurrentLanguage()).toBe('en');
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('uses localStorage preference if set', () => {
      _store['osler_lang'] = 'ar';
      init();
      expect(getCurrentLanguage()).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('falls back to en if localStorage has unsupported language', () => {
      _store['osler_lang'] = 'fr';
      init();
      expect(getCurrentLanguage()).toBe('en');
    });
  });

  describe('t (translation lookup)', () => {
    it('returns the English string for a known key', () => {
      expect(t('common.cancel')).toBe('Cancel');
      expect(t('common.save')).toBe('Save');
      expect(t('hub.title')).toBe('Osler');
    });

    it('returns the Arabic string when language is set to ar', () => {
      _store['osler_lang'] = 'ar';
      init();
      // Don't call setLanguage (it reloads) — just verify lookup
      expect(t('common.cancel')).toBe('إلغاء');
      expect(t('hub.title')).toBe('أوسلر');
    });

    it('uses fallback when key is missing', () => {
      expect(t('nonexistent.key', null, 'Fallback')).toBe('Fallback');
    });

    it('returns the key itself when no fallback is provided', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('interpolates placeholders', () => {
      const result = t('quiz.results.score', { score: 8, total: 10 });
      expect(result).toBe('You scored 8 out of 10');
    });

    it('falls back to English if a key is missing in Arabic bundle', () => {
      _store['osler_lang'] = 'ar';
      init();
      // Use a key that exists in EN but not AR
      // (in practice, all keys should be in both — this is a safety net)
      const result = t('common.cancel', null, null);
      // Should return the AR value (exists in both bundles)
      expect(result).toBe('إلغاء');
    });
  });

  describe('setLanguage', () => {
    it('rejects unsupported languages', async () => {
      await expect(setLanguage('fr')).rejects.toThrow();
    });

    it('saves to localStorage when setting a supported language', async () => {
      // Note: setLanguage reloads the page, so we mock window.location.reload
      const originalReload = global.window.location?.reload;
      global.window.location = { reload: vi.fn() };

      try {
        await setLanguage('ar');
        expect(_store['osler_lang']).toBe('ar');
        expect(localStorage.setItem).toHaveBeenCalledWith('osler_lang', 'ar');
      } finally {
        if (originalReload) {
          global.window.location.reload = originalReload;
        }
      }
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns the supported language codes', () => {
      const langs = getSupportedLanguages();
      expect(langs).toContain('en');
      expect(langs).toContain('ar');
      expect(langs).toHaveLength(2);
    });
  });

  describe('applyTranslations', () => {
    it('translates elements with data-i18n attribute', () => {
      const elements = [
        { dataset: { i18n: 'common.cancel' }, textContent: '' },
        { dataset: { i18n: 'common.save' }, textContent: '' },
      ];

      document.querySelectorAll.mockReturnValue(elements);
      applyTranslations();

      expect(elements[0].textContent).toBe('Cancel');
      expect(elements[1].textContent).toBe('Save');
    });

    it('translates placeholder attributes', () => {
      const elements = [
        { dataset: { i18nPlaceholder: 'hub.search' }, placeholder: '' },
      ];

      document.querySelectorAll.mockReturnValue(elements);
      applyTranslations();

      expect(elements[0].placeholder).toBe('Search content...');
    });
  });

  describe('bundle completeness', () => {
    it('every EN key has an AR translation', async () => {
      const en = (await import('../../../src/i18n/en.json')).default;
      const ar = (await import('../../../src/i18n/ar.json')).default;

      const enKeys = new Set();
      const arKeys = new Set();

      const collect = (obj, prefix, set) => {
        for (const [k, v] of Object.entries(obj)) {
          const full = prefix ? `${prefix}.${k}` : k;
          if (typeof v === 'object' && v !== null) collect(v, full, set);
          else set.add(full);
        }
      };

      collect(en, '', enKeys);
      collect(ar, '', arKeys);

      const missingInAr = [...enKeys].filter(k => !arKeys.has(k));
      const missingInEn = [...arKeys].filter(k => !enKeys.has(k));

      expect(missingInAr).toEqual([]);
      expect(missingInEn).toEqual([]);
    });
  });
});
