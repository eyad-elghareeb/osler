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

const hasConfig = config.apiKey && config.projectId;

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

  isSupported().then((yes) => {
    if (yes) analytics = getAnalytics(app);
  });
} else {
  console.warn('Firebase: no config found. Auth and sync will be disabled.');
}

export { app, auth, db, analytics };
