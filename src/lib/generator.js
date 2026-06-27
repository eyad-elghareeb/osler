/* ================================================================
   generator.js  —  V2 (Phase 13)
   ----------------------------------------------------------------
   Modular site generator wizard. 5-step flow:
     1. Engines    — pick which study engines to include
     2. Content    — pick which content packs to bundle
     3. Theme      — colors, fonts, logo
     4. Auth       — None (static) or Firebase
     5. Deploy     — pick a deploy target

   Then assembles a bundle (zip) with chosen engines, content,
   config.json, provider config files, and update-manifest.json.

   This module is PWA-side — used by a generator preview UI in the
   admin's frontend. The actual zip + sign + deploy happens in the
   Rust admin (bundle_engines.rs, deploy.rs). This JS module handles
   the wizard state + bundle assembly spec, which the Rust side
   consumes.
   ================================================================ */

import { t } from './i18n.js';

const WIZARD_STATE_KEY = 'osler-wizard-state';
const WIZARD_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─────────────────────────────────────────────────────────────────────────────
// Default wizard state
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  step: 1, // 1-5
  engines: {
    quiz: true,
    bank: true,
    flashcard: true,
    written: true,
    osce: true,
    // Always-included engines (not user-selectable):
    // hub, search, ai-assistant (V1) / tutor (V2)
  },
  content: {
    // Array of content UIDs to bundle (from the content repo)
    selected: [],
    // Array of { filename, content } for locally-uploaded JSON
    uploads: [],
  },
  theme: {
    primary: '#3b82f6',
    accent: '#10b981',
    background: 'system', // 'light' | 'dark' | 'system'
    fontFamily: 'Inter',
    headingFont: 'Inter',
    logo: null, // { filename, dataUrl } or null for default
    favicon: null,
    appName: 'Osler',
    tagline: 'Medical study platform',
    customCss: '',
  },
  auth: {
    mode: 'none', // 'none' | 'firebase'
    firebaseConfig: null, // object if mode === 'firebase'
  },
  deploy: {
    target: null, // 'github_pages' | 'netlify' | 'vercel' | 'cloudflare' | 'docker' | 'preview_only'
    siteName: null,
  },
  savedAt: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// State persistence
//
// Wizard state saves to localStorage so the user can close the admin
// and resume later. State expires after 7 days.
// ─────────────────────────────────────────────────────────────────────────────

export function loadWizardState() {
  try {
    const raw = localStorage.getItem(WIZARD_STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };

    const parsed = JSON.parse(raw);
    if (parsed.savedAt && (Date.now() - new Date(parsed.savedAt).getTime() > WIZARD_STATE_TTL_MS)) {
      // Expired — clear and return default
      localStorage.removeItem(WIZARD_STATE_KEY);
      return { ...DEFAULT_STATE };
    }

    // Merge with defaults (handles new fields added after state was saved)
    return {
      ...DEFAULT_STATE,
      ...parsed,
      engines: { ...DEFAULT_STATE.engines, ...(parsed.engines || {}) },
      content: { ...DEFAULT_STATE.content, ...(parsed.content || {}) },
      theme: { ...DEFAULT_STATE.theme, ...(parsed.theme || {}) },
      auth: { ...DEFAULT_STATE.auth, ...(parsed.auth || {}) },
      deploy: { ...DEFAULT_STATE.deploy, ...(parsed.deploy || {}) },
    };
  } catch (e) {
    console.warn('[generator] loadWizardState failed:', e);
    return { ...DEFAULT_STATE };
  }
}

export function saveWizardState(state) {
  try {
    const toSave = { ...state, savedAt: new Date().toISOString() };
    localStorage.setItem(WIZARD_STATE_KEY, JSON.stringify(toSave));
    return toSave;
  } catch (e) {
    console.warn('[generator] saveWizardState failed:', e);
    return state;
  }
}

export function clearWizardState() {
  try {
    localStorage.removeItem(WIZARD_STATE_KEY);
  } catch (e) {
    console.warn('[generator] clearWizardState failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step navigation
// ─────────────────────────────────────────────────────────────────────────────

export function goToStep(state, step) {
  if (step < 1 || step > 5) return state;
  return saveWizardState({ ...state, step });
}

export function nextStep(state) {
  return goToStep(state, Math.min(5, state.step + 1));
}

export function prevStep(state) {
  return goToStep(state, Math.max(1, state.step - 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Engines
// ─────────────────────────────────────────────────────────────────────────────

export function toggleEngine(state, engineName, enabled) {
  const newState = {
    ...state,
    engines: { ...state.engines, [engineName]: !!enabled },
  };
  return saveWizardState(newState);
}

export function getSelectedEngines(state) {
  const alwaysIncluded = ['hub', 'search', 'ai-assistant'];
  const selected = Object.entries(state.engines)
    .filter(([_, enabled]) => enabled)
    .map(([name]) => name);
  return [...new Set([...alwaysIncluded, ...selected])];
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Content
// ─────────────────────────────────────────────────────────────────────────────

export function selectContent(state, uids) {
  return saveWizardState({
    ...state,
    content: { ...state.content, selected: [...uids] },
  });
}

export function addUpload(state, filename, content) {
  const uploads = [...state.content.uploads, { filename, content }];
  return saveWizardState({
    ...state,
    content: { ...state.content, uploads },
  });
}

export function removeUpload(state, filename) {
  const uploads = state.content.uploads.filter(u => u.filename !== filename);
  return saveWizardState({
    ...state,
    content: { ...state.content, uploads },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Theme
// ─────────────────────────────────────────────────────────────────────────────

export function setTheme(state, themeUpdates) {
  return saveWizardState({
    ...state,
    theme: { ...state.theme, ...themeUpdates },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Auth
// ─────────────────────────────────────────────────────────────────────────────

export function setAuthMode(state, mode, firebaseConfig = null) {
  if (mode === 'firebase' && !firebaseConfig) {
    throw new Error('[generator] firebaseConfig is required for firebase mode');
  }
  return saveWizardState({
    ...state,
    auth: { mode, firebaseConfig: mode === 'firebase' ? firebaseConfig : null },
  });
}

/**
 * Validate a Firebase config object.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateFirebaseConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  for (const field of required) {
    if (!config[field]) errors.push(`Missing field: ${field}`);
  }
  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: Deploy target
// ─────────────────────────────────────────────────────────────────────────────

export function setDeployTarget(state, target, siteName = null) {
  return saveWizardState({
    ...state,
    deploy: { target, siteName },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle assembly spec
//
// This builds the spec object that the Rust admin consumes to assemble
// the actual zip. The Rust side (bundle_engines.rs) reads this spec and:
//   1. Copies engine JS files from engines/ (post-build)
//   2. Copies content JSON files from the content repo
//   3. Writes config.json with theme + auth + deploy settings
//   4. Writes provider config files (netlify.toml, vercel.json, etc.)
//   5. Writes update-manifest.json with version + bundle hash + file list
//   6. Computes SHA-256 over all files
//   7. Signs the bundle if a signing key is configured
//   8. Writes the zip
//
// In a pure-PWA context (no Tauri), this spec is used to build a
// downloadable bundle in-browser via the File System Access API or
// a Blob download.
// ─────────────────────────────────────────────────────────────────────────────

export function buildBundleSpec(state) {
  const engines = getSelectedEngines(state);

  return {
    version: '2.0.0',
    generatedAt: new Date().toISOString(),
    engines,
    content: {
      selected: state.content.selected,
      uploads: state.content.uploads,
    },
    theme: state.theme,
    auth: state.auth,
    deploy: state.deploy,
    // Provider config files to generate (key = filename, value = content)
    providerConfigs: generateProviderConfigs(state),
    // The site's config.json — read by the PWA at startup
    siteConfig: generateSiteConfig(state),
  };
}

function generateSiteConfig(state) {
  return {
    version: '2.0.0',
    appName: state.theme.appName,
    tagline: state.theme.tagline,
    theme: {
      primary: state.theme.primary,
      accent: state.theme.accent,
      background: state.theme.background,
      fontFamily: state.theme.fontFamily,
      headingFont: state.theme.headingFont,
    },
    firebase: state.auth.mode === 'firebase' ? state.auth.firebaseConfig : null,
    engines: getSelectedEngines(state),
  };
}

function generateProviderConfigs(state) {
  const configs = {};

  switch (state.deploy.target) {
    case 'netlify':
      configs['netlify.toml'] = `[build]
  publish = "."

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/update-manifest.json"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/engines/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/content/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`;
      break;

    case 'vercel':
      configs['vercel.json'] = JSON.stringify({
        version: 2,
        public: true,
        cleanUrls: true,
        trailingSlash: false,
        headers: [
          { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
          { source: '/update-manifest.json', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
          { source: '/engines/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
          { source: '/content/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
        ],
        rewrites: [{ source: '/(.*)', destination: '/index.html' }],
      }, null, 2);
      break;

    case 'cloudflare':
      configs['_headers'] = `/sw.js
  Cache-Control: no-cache
/update-manifest.json
  Cache-Control: no-cache
/engines/*
  Cache-Control: public, max-age=31536000, immutable
/content/*
  Cache-Control: public, max-age=31536000, immutable
`;
      configs['_redirects'] = `/*    /index.html    200
`;
      break;

    case 'github_pages':
      // No config file needed — Pages serves the branch as-is.
      // The PWA's basePath must be set in config.json if serving from a
      // subpath (e.g. user.github.io/repo/).
      break;
  }

  return configs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle size estimation
//
// Used by the wizard UI to show the user the impact of their selections.
// Numbers are approximate (actual size depends on content length).
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE_SIZES_BYTES = {
  'quiz': 180_000,
  'bank': 95_000,
  'flashcard': 120_000,
  'written': 85_000,
  'osce': 165_000,
  'hub': 70_000,
  'search': 45_000,
  'ai-assistant': 50_000,
};

export function estimateBundleSize(state) {
  const engines = getSelectedEngines(state);
  let totalBytes = 200_000; // base (index.html, sw.js, css, lib)

  for (const engine of engines) {
    totalBytes += ENGINE_SIZES_BYTES[engine] || 50_000;
  }

  // Content: ~1KB per item (rough average)
  const itemCount = state.content.selected.length +
    state.content.uploads.reduce((acc, u) => {
      try { return acc + (JSON.parse(u.content)?.items?.length || 1); }
      catch { return acc + 1; }
    }, 0);
  totalBytes += itemCount * 1024;

  // i18n bundles
  totalBytes += 25_000; // en.json + ar.json

  return {
    bytes: totalBytes,
    kb: Math.round(totalBytes / 1024),
    mb: (totalBytes / (1024 * 1024)).toFixed(2),
    itemCount,
    engineCount: engines.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate the wizard state before generating
//
// Returns { valid: boolean, errors: string[], warnings: string[] }
// ─────────────────────────────────────────────────────────────────────────────

export function validateWizardState(state) {
  const errors = [];
  const warnings = [];

  // At least one engine must be selected
  const userEngines = Object.entries(state.engines).filter(([_, v]) => v);
  if (userEngines.length === 0) {
    errors.push('Pick at least one engine.');
  }

  // At least one content item (warning, not error — empty sites are valid)
  if (state.content.selected.length === 0 && state.content.uploads.length === 0) {
    warnings.push('No content selected. The generated site will be empty.');
  }

  // Firebase config validation
  if (state.auth.mode === 'firebase') {
    const result = validateFirebaseConfig(state.auth.firebaseConfig);
    if (!result.valid) {
      errors.push(...result.errors.map(e => `Firebase: ${e}`));
    }
  }

  // Deploy target must be set if generating for deploy
  if (!state.deploy.target) {
    warnings.push('No deploy target selected. The bundle will be saved as a zip only.');
  }

  return { valid: errors.length === 0, errors, warnings };
}
