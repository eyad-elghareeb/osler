// =============================================================================
// tests/unit/lib/v2-generator.test.js  —  V2 (Phase 13)
// -----------------------------------------------------------------------------
// Unit tests for the generator wizard state + bundle spec builder.
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';

// Mock localStorage
const _store = {};
global.localStorage = {
  getItem: vi.fn((k) => _store[k] ?? null),
  setItem: vi.fn((k, v) => { _store[k] = String(v); }),
  removeItem: vi.fn((k) => { delete _store[k]; }),
};

import { vi } from 'vitest';
import {
  loadWizardState,
  saveWizardState,
  clearWizardState,
  goToStep,
  nextStep,
  prevStep,
  toggleEngine,
  getSelectedEngines,
  selectContent,
  addUpload,
  setTheme,
  setAuthMode,
  validateFirebaseConfig,
  setDeployTarget,
  buildBundleSpec,
  estimateBundleSize,
  validateWizardState,
} from '../../../src/lib/generator.js';

describe('generator (V2)', () => {
  beforeEach(() => {
    Object.keys(_store).forEach(k => delete _store[k]);
  });

  describe('wizard state', () => {
    it('returns default state on first load', () => {
      const state = loadWizardState();
      expect(state.step).toBe(1);
      expect(state.engines.quiz).toBe(true);
      expect(state.auth.mode).toBe('none');
    });

    it('persists state across reloads', () => {
      const state = loadWizardState();
      state.step = 3;
      saveWizardState(state);

      const reloaded = loadWizardState();
      expect(reloaded.step).toBe(3);
    });

    it('expires after 7 days', () => {
      const old = { step: 5, savedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() };
      _store['osler-wizard-state'] = JSON.stringify(old);

      const state = loadWizardState();
      // Expired — should return default
      expect(state.step).toBe(1);
    });

    it('clears state on clearWizardState', () => {
      saveWizardState({ step: 5 });
      clearWizardState();
      const state = loadWizardState();
      expect(state.step).toBe(1);
    });
  });

  describe('step navigation', () => {
    it('goToStep moves to a valid step', () => {
      const state = loadWizardState();
      const next = goToStep(state, 4);
      expect(next.step).toBe(4);
    });

    it('goToStep clamps to [1, 5]', () => {
      const state = loadWizardState();
      expect(goToStep(state, 0).step).toBe(1);
      expect(goToStep(state, 99).step).toBe(1); // out of range returns unchanged
    });

    it('nextStep + prevStep move correctly', () => {
      let state = loadWizardState();
      state = nextStep(state);
      expect(state.step).toBe(2);
      state = prevStep(state);
      expect(state.step).toBe(1);
      state = prevStep(state);
      expect(state.step).toBe(1); // clamped at 1
    });
  });

  describe('engines', () => {
    it('toggleEngine enables/disables an engine', () => {
      let state = loadWizardState();
      state = toggleEngine(state, 'quiz', false);
      expect(state.engines.quiz).toBe(false);
      state = toggleEngine(state, 'quiz', true);
      expect(state.engines.quiz).toBe(true);
    });

    it('getSelectedEngines includes always-included engines', () => {
      const state = loadWizardState();
      const engines = getSelectedEngines(state);
      expect(engines).toContain('hub');
      expect(engines).toContain('search');
      expect(engines).toContain('ai-assistant');
    });
  });

  describe('content', () => {
    it('selectContent sets the selected UIDs', () => {
      let state = loadWizardState();
      state = selectContent(state, ['quiz-001', 'fc-001']);
      expect(state.content.selected).toEqual(['quiz-001', 'fc-001']);
    });

    it('addUpload appends a file', () => {
      let state = loadWizardState();
      state = addUpload(state, 'test.json', '{}');
      expect(state.content.uploads).toHaveLength(1);
      expect(state.content.uploads[0].filename).toBe('test.json');
    });

    it('removeUpload removes a file', () => {
      let state = loadWizardState();
      state = addUpload(state, 'a.json', '{}');
      state = addUpload(state, 'b.json', '{}');
      state = removeUpload(state, 'a.json');
      expect(state.content.uploads).toHaveLength(1);
      expect(state.content.uploads[0].filename).toBe('b.json');
    });
  });

  describe('theme', () => {
    it('setTheme merges theme updates', () => {
      let state = loadWizardState();
      state = setTheme(state, { primary: '#ff0000', appName: 'My Site' });
      expect(state.theme.primary).toBe('#ff0000');
      expect(state.theme.appName).toBe('My Site');
      // Untouched fields preserved
      expect(state.theme.accent).toBeDefined();
    });
  });

  describe('auth', () => {
    it('setAuthMode with firebase requires config', () => {
      const state = loadWizardState();
      expect(() => setAuthMode(state, 'firebase')).toThrow();
    });

    it('setAuthMode with firebase saves the config', () => {
      const config = {
        apiKey: 'AIza...',
        authDomain: 'test.firebaseapp.com',
        projectId: 'test',
        appId: '1:123:web:abc',
      };
      let state = loadWizardState();
      state = setAuthMode(state, 'firebase', config);
      expect(state.auth.mode).toBe('firebase');
      expect(state.auth.firebaseConfig).toEqual(config);
    });

    it('setAuthMode with none clears the config', () => {
      let state = loadWizardState();
      state = setAuthMode(state, 'firebase', {
        apiKey: 'x', authDomain: 'x', projectId: 'x', appId: 'x',
      });
      state = setAuthMode(state, 'none');
      expect(state.auth.mode).toBe('none');
      expect(state.auth.firebaseConfig).toBeNull();
    });
  });

  describe('validateFirebaseConfig', () => {
    it('returns valid for a complete config', () => {
      const config = {
        apiKey: 'AIza...',
        authDomain: 'test.firebaseapp.com',
        projectId: 'test',
        appId: '1:123:web:abc',
      };
      const result = validateFirebaseConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid with missing field errors', () => {
      const result = validateFirebaseConfig({ apiKey: 'test' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing field: authDomain');
      expect(result.errors).toContain('Missing field: projectId');
      expect(result.errors).toContain('Missing field: appId');
    });

    it('rejects non-object input', () => {
      const result = validateFirebaseConfig(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('deploy target', () => {
    it('setDeployTarget sets target + siteName', () => {
      let state = loadWizardState();
      state = setDeployTarget(state, 'netlify', 'my-site');
      expect(state.deploy.target).toBe('netlify');
      expect(state.deploy.siteName).toBe('my-site');
    });
  });

  describe('buildBundleSpec', () => {
    it('includes the site config', () => {
      const state = loadWizardState();
      const spec = buildBundleSpec(state);
      expect(spec.siteConfig).toBeDefined();
      expect(spec.siteConfig.version).toBe('2.0.0');
      expect(spec.siteConfig.engines).toContain('quiz');
    });

    it('generates netlify.toml when target is netlify', () => {
      let state = loadWizardState();
      state = setDeployTarget(state, 'netlify');
      const spec = buildBundleSpec(state);
      expect(spec.providerConfigs['netlify.toml']).toBeDefined();
      expect(spec.providerConfigs['netlify.toml']).toContain('publish = "."');
      expect(spec.providerConfigs['netlify.toml']).toContain('Cache-Control');
    });

    it('generates vercel.json when target is vercel', () => {
      let state = loadWizardState();
      state = setDeployTarget(state, 'vercel');
      const spec = buildBundleSpec(state);
      expect(spec.providerConfigs['vercel.json']).toBeDefined();
      const parsed = JSON.parse(spec.providerConfigs['vercel.json']);
      expect(parsed.rewrites).toBeDefined();
    });

    it('generates _headers + _redirects when target is cloudflare', () => {
      let state = loadWizardState();
      state = setDeployTarget(state, 'cloudflare');
      const spec = buildBundleSpec(state);
      expect(spec.providerConfigs['_headers']).toBeDefined();
      expect(spec.providerConfigs['_redirects']).toBeDefined();
    });

    it('includes firebase config when mode is firebase', () => {
      const fbConfig = {
        apiKey: 'AIza...', authDomain: 'x', projectId: 'x', appId: 'x',
      };
      let state = loadWizardState();
      state = setAuthMode(state, 'firebase', fbConfig);
      const spec = buildBundleSpec(state);
      expect(spec.siteConfig.firebase).toEqual(fbConfig);
    });

    it('excludes firebase config when mode is none', () => {
      const state = loadWizardState();
      const spec = buildBundleSpec(state);
      expect(spec.siteConfig.firebase).toBeNull();
    });
  });

  describe('estimateBundleSize', () => {
    it('returns a larger size with more engines', () => {
      const allOff = { ...loadWizardState(), engines: { quiz: false, bank: false, flashcard: false, written: false, osce: false } };
      const allOn = { ...loadWizardState(), engines: { quiz: true, bank: true, flashcard: true, written: true, osce: true } };

      const off = estimateBundleSize(allOff);
      const on = estimateBundleSize(allOn);

      expect(on.bytes).toBeGreaterThan(off.bytes);
      expect(on.engineCount).toBeGreaterThan(off.engineCount);
    });

    it('increases with content count', () => {
      const noContent = { ...loadWizardState(), content: { selected: [], uploads: [] } };
      const withContent = { ...loadWizardState(), content: { selected: ['q1', 'q2', 'q3'], uploads: [] } };

      const empty = estimateBundleSize(noContent);
      const full = estimateBundleSize(withContent);

      expect(full.bytes).toBeGreaterThan(empty.bytes);
      expect(full.itemCount).toBe(3);
    });
  });

  describe('validateWizardState', () => {
    it('returns invalid when no engines are selected', () => {
      const state = {
        ...loadWizardState(),
        engines: { quiz: false, bank: false, flashcard: false, written: false, osce: false },
      };
      const result = validateWizardState(state);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pick at least one engine.');
    });

    it('warns when no content is selected', () => {
      const state = {
        ...loadWizardState(),
        content: { selected: [], uploads: [] },
      };
      const result = validateWizardState(state);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('returns invalid when firebase mode is set but config is invalid', () => {
      const state = {
        ...loadWizardState(),
        auth: { mode: 'firebase', firebaseConfig: { apiKey: 'x' } }, // missing fields
      };
      const result = validateWizardState(state);
      expect(result.valid).toBe(false);
    });

    it('returns valid for a complete state', () => {
      const state = {
        ...loadWizardState(),
        content: { selected: ['q1'], uploads: [] },
        auth: { mode: 'none', firebaseConfig: null },
        deploy: { target: 'netlify', siteName: 'test' },
      };
      const result = validateWizardState(state);
      expect(result.valid).toBe(true);
    });
  });
});
