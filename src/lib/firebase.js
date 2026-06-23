import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

let env = {};
try { env = import.meta.env || {}; } catch { env = {}; }
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

// H18 fix: validate ALL required fields, not just apiKey + projectId.
// Missing appId/authDomain causes runtime errors when Firebase tries to
// make auth/firestore calls.
const REQUIRED_FIELDS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingFields = REQUIRED_FIELDS.filter(f => !config[f]);
const hasConfig = missingFields.length === 0;

let app = null;
let auth = null;
let db = null;
let analytics = null;

if (hasConfig) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);

  if (env.VITE_FIREBASE_EMULATOR) {
    connectAuthEmulator(auth, 'http://localhost:9099');
    connectFirestoreEmulator(db, 'localhost', 8080);
  }

  // H18 fix: expose analytics on window.firebase so src/lib/analytics.js
  // can forward events. Previously analytics was only exported as a module
  // binding that started as null and was never read by the analytics module.
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
    `Auth and sync will be disabled. Set these in .env (see .env.example).`
  );
}

export { app, auth, db, analytics };
