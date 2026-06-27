/* ================================================================
   firebase.js  —  V2 (Phase 9)
   ----------------------------------------------------------------
   Extends V1 (Auth + Firestore + Analytics) with Cloud Storage
   for optional cloud-based content pack sharing.

   V1 wiring is preserved unchanged — V2 only ADDS Storage + the
   generated-site config loader (config.json) for self-hosters
   bringing their own Firebase project.

   If Firebase config is missing (None auth mode), all exports are
   null and Firebase-dependent features are disabled.
   ================================================================ */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
} from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// Config loader
//
// Two sources, in priority order:
//   1. import.meta.env.VITE_FIREBASE_*  — used during local dev + by the
//      "official" deployment (admin's project).
//   2. /config.json on the deployed site  — used by self-hosters. The
//      V2 generator wizard writes config.json into the bundle. We fetch
//      it once at module load.
//
// Both sources are merged; (2) wins on conflict (it's per-site).
// ─────────────────────────────────────────────────────────────────────────────

let env = {};
try { env = import.meta.env || {}; } catch { env = {}; }

let siteConfig = {};
try {
  // Fetch is sync-at-module-load-safe here because the module is loaded
  // after document parse. If config.json is missing or malformed, we
  // silently fall back to env vars only.
  const res = await fetch('/config.json', { cache: 'no-cache' });
  if (res.ok) {
    const json = await res.json();
    if (json && json.firebase) siteConfig = json.firebase;
  }
} catch (e) {
  // Common on localhost during V1 dev (no config.json) — silent fallback.
}

const config = {
  apiKey:        siteConfig.apiKey        || env.VITE_FIREBASE_API_KEY,
  authDomain:    siteConfig.authDomain    || env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:     siteConfig.projectId     || env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: siteConfig.storageBucket || env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: siteConfig.messagingSenderId || env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:         siteConfig.appId         || env.VITE_FIREBASE_APP_ID,
  measurementId: siteConfig.measurementId || env.VITE_FIREBASE_MEASUREMENT_ID,
};

// H18 fix preserved: validate ALL required fields, not just apiKey + projectId.
const REQUIRED_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingFields = REQUIRED_FIELDS.filter(f => !config[f]);
const hasConfig = missingFields.length === 0;

// Storage is optional — only enabled if storageBucket is set.
const hasStorage = !!config.storageBucket;

let app = null;
let auth = null;
let db = null;
let storage = null;
let analytics = null;

if (hasConfig) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);

  if (env.VITE_FIREBASE_EMULATOR) {
    connectAuthEmulator(auth, 'http://localhost:9099');
    connectFirestoreEmulator(db, 'localhost', 8080);
    if (hasStorage) connectStorageEmulator(storage, 'localhost', 9199);
  }

  // Phase 9: Storage initialized only when storageBucket is configured.
  // Self-hosters who don't enable Storage in their Firebase project won't
  // break — `storage` stays null and storage-dependent features no-op.
  if (hasStorage) {
    storage = getStorage(app);
  }

  isSupported().then((yes) => {
    if (yes) {
      analytics = getAnalytics(app);
      if (typeof window !== 'undefined') {
        window.firebase = window.firebase || {};
        window.firebase.analytics = analytics;
      }
    }
  }).catch((e) => {
    console.warn('[firebase] Analytics not supported:', e);
  });
} else {
  console.warn(
    `[firebase] Missing required config fields: [${missingFields.join(', ')}]. ` +
    `Auth, sync, and AI tutor will be disabled. ` +
    `Set these in .env (see .env.example) or in config.json (self-hosters).`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 helper: isFirebaseEnabled()
// Engines + UI use this to decide whether to show auth UI, sync indicators,
// and the AI tutor button. Avoids checking `auth`/`db`/`storage` directly.
// ─────────────────────────────────────────────────────────────────────────────

export function isFirebaseEnabled() {
  return hasConfig;
}

export function isStorageEnabled() {
  return hasStorage;
}

export function getFirebaseConfig() {
  // Returns a snapshot of the resolved config (sanitized — no secrets).
  // Used by the AI tutor to verify it can call Gemini.
  return hasConfig ? { ...config } : null;
}

// Re-export signOut for callers that want a unified surface.
export function signOut() {
  if (!auth) return Promise.resolve();
  return firebaseSignOut(auth);
}

export { app, auth, db, storage, analytics };
