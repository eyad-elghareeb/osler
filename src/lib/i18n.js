/* ================================================================
   i18n.js  —  V2 (Phase 11)
   ----------------------------------------------------------------
   i18next wrapper. EN + AR UI bundles, language detection,
   RTL toggle, font loading.

   Language detection order:
     1. localStorage.osler_lang (user's explicit choice)
     2. navigator.language (browser default)
     3. Fallback: 'en'

   Switching language sets localStorage, sets document.documentElement.dir,
   and reloads the page (intentional — full reactive i18n without a
   reload requires a frontend framework, which V2 explicitly avoids).
   ================================================================ */

import en from '../i18n/en.json' with { type: 'json' };
import ar from '../i18n/ar.json' with { type: 'json' };

const BUNDLES = { en, ar };
const SUPPORTED_LANGS = ['en', 'ar'];
const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'osler_lang';

let _currentLang = null;
let _listeners = [];

// ─────────────────────────────────────────────────────────────────────────────
// Language detection
// ─────────────────────────────────────────────────────────────────────────────

function detectLanguage() {
  // 1. localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
  } catch (e) {
    // localStorage may be unavailable (private mode) — fall through
  }

  // 2. navigator.language
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.slice(0, 2).toLowerCase();
    if (SUPPORTED_LANGS.includes(lang)) return lang;
  }

  // 3. Fallback
  return DEFAULT_LANG;
}

function applyLanguage(lang) {
  _currentLang = lang;

  // Set <html lang> + dir
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }

  // Save to localStorage
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    // Silent — localStorage may be unavailable
  }

  // Notify listeners
  _listeners.forEach(fn => fn(lang));
}

// ─────────────────────────────────────────────────────────────────────────────
// String lookup
//
// `t(key, opts, fallback)` — translates a key with optional placeholders
// and a fallback string. The fallback is used if the key is missing in
// both the current language AND English (rare — means the key wasn't
// added to either bundle).
// ─────────────────────────────────────────────────────────────────────────────

function lookup(bundle, key) {
  if (!bundle) return undefined;
  const parts = key.split('.');
  let val = bundle;
  for (const p of parts) {
    if (val == null || typeof val !== 'object') return undefined;
    val = val[p];
  }
  return val;
}

function interpolate(str, opts) {
  if (!str || !opts) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return opts[key] != null ? String(opts[key]) : `{{${key}}}`;
  });
}

export function t(key, opts, fallback) {
  if (!key) return '';

  const bundle = BUNDLES[_currentLang];
  const fallbackBundle = BUNDLES[DEFAULT_LANG];

  // Try current language, then fallback
  const val = lookup(bundle, key) ?? lookup(fallbackBundle, key) ?? fallback ?? key;
  return interpolate(val, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function getCurrentLanguage() {
  return _currentLang || DEFAULT_LANG;
}

export function getSupportedLanguages() {
  return [...SUPPORTED_LANGS];
}

export function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) {
    console.warn(`[i18n] unsupported language: ${lang}`);
    return Promise.reject(new Error(`Unsupported language: ${lang}`));
  }

  if (lang === _currentLang) return Promise.resolve();

  applyLanguage(lang);

  // Reload the page so all components re-render with the new language.
  // (Reactive i18n without reload requires a framework — V2 anti-goal.)
  if (typeof window !== 'undefined') {
    setTimeout(() => window.location.reload(), 50);
  }

  return Promise.resolve();
}

export function init() {
  const lang = detectLanguage();
  applyLanguage(lang);

  // Auto-apply translations to elements with data-i18n attribute
  if (typeof document !== 'undefined') {
    applyTranslations();
  }
}

// Apply translations to all [data-i18n] elements
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (!key) return;
    el.textContent = t(key);
  });

  // Also handle [data-i18n-placeholder] for input placeholders
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (!key) return;
    el.placeholder = t(key);
  });

  // [data-i18n-title] for title attributes
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (!key) return;
    el.title = t(key);
  });
}

export function onChange(fn) {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter(f => f !== fn);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-init on module load (browser only)
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  init();
}

// Expose on window for the engine-shared bridge
if (typeof window !== 'undefined') {
  window.OslerI18n = { t, setLanguage, getCurrentLanguage, getSupportedLanguages, applyTranslations, onChange };
}
