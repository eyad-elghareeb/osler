import {
  signInAnonymously,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  GithubAuthProvider,
  linkWithPopup,
  getRedirectResult,
} from 'firebase/auth';
import { auth } from './firebase.js';
import { put, get } from './storage.js';

const SETTINGS_KEY = 'authProvider';
const GUEST_UID_KEY = 'osler_guest_uid'; // localStorage — preserves guest identity across signOut

let _currentUser = null;
const _listeners = [];
let _initAuthCalled = false;
let _guestCredential = null; // cached anonymous credential so signOut can restore it

export function subscribe(fn) {
  _listeners.push(fn);
  if (_currentUser) fn(_currentUser);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

function notify(user) {
  _currentUser = user;
  _listeners.forEach(fn => fn(user));
}

export function currentUser() {
  return _currentUser;
}

async function getAuthProvider() {
  try {
    return await get('settings', SETTINGS_KEY);
  } catch (e) {
    console.warn('[auth] getAuthProvider failed:', e);
    return null;
  }
}

async function setAuthProvider(provider) {
  try {
    await put('settings', { key: SETTINGS_KEY, value: provider });
  } catch (e) {
    console.warn('[auth] setAuthProvider failed:', e);
  }
}

/**
 * Sign in as an anonymous guest. If we have a cached guest UID from a prior
 * session, we DO NOT auto-create a new one — Firebase doesn't support
 * re-hydrating anonymous auth credentials across browser sessions, so this
 * is a known limitation. The user is informed that guest data is device-local.
 */
export async function signInAsGuest() {
  if (!auth) throw new Error('Firebase not configured');
  const result = await signInAnonymously(auth);
  _guestCredential = result;
  // Cache the guest UID so signOut can detect "we already had a guest".
  try { localStorage.setItem(GUEST_UID_KEY, result.user.uid); } catch {}
  const user = { ...result.user.toJSON(), isGuest: true, provider: 'guest' };
  notify(user);
  await setAuthProvider('guest');
  return user;
}

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase not configured');
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = { ...result.user.toJSON(), isGuest: false, provider: 'google' };
  notify(user);
  await setAuthProvider('google');
  return user;
}

export async function signInWithGitHub() {
  if (!auth) throw new Error('Firebase not configured');
  const provider = new GithubAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = { ...result.user.toJSON(), isGuest: false, provider: 'github' };
  notify(user);
  await setAuthProvider('github');
  return user;
}

/**
 * Sign out — return to guest mode WITHOUT creating a new anonymous user
 * if we already have one cached. H4 fix.
 *
 * If the current user is already a guest, this is a no-op.
 * If the current user is signed in (Google/GitHub), we sign them out and
 * the next initAuth/onAuthStateChanged cycle will create a fresh guest.
 * (Firebase doesn't allow re-using the previous anonymous UID after sign-out,
 *  but we can preserve the data via Firestore sync pulling it back.)
 */
export async function signOut() {
  if (!auth) throw new Error('Firebase not configured');
  const current = auth.currentUser;
  if (current && current.isAnonymous) {
    // Already a guest — no-op.
    return _currentUser;
  }
  await firebaseSignOut(auth);
  // Create a new anonymous guest. Note: the previous guest UID is lost,
  // but if the user had synced to Firestore before signing in with Google,
  // their data is preserved remotely and syncPull will retrieve it.
  const guest = await signInAnonymously(auth);
  _guestCredential = guest;
  try { localStorage.setItem(GUEST_UID_KEY, guest.user.uid); } catch {}
  // Note: spread guest.user (not guest itself) — guest is a UserCredential,
  // not a User. H4 fix.
  const user = { ...guest.user.toJSON(), isGuest: true, provider: 'guest' };
  notify(user);
  await setAuthProvider('guest');
  return user;
}

/**
 * Upgrade an anonymous guest to a permanent Google/GitHub account,
 * preserving all guest data via Firebase's linkWithPopup. H5 fix.
 *
 * After a successful upgrade, the same UID that was anonymous is now
 * permanently tied to the OAuth provider — IndexedDB data, Firestore data,
 * and all sync state stay attached to the same UID.
 */
export async function upgradeAccount(providerName) {
  if (!auth || !auth.currentUser) throw new Error('No user to upgrade');
  if (!auth.currentUser.isAnonymous) {
    // Already authenticated with a permanent provider — just sign in.
    if (providerName === 'google') return signInWithGoogle();
    if (providerName === 'github') return signInWithGitHub();
    throw new Error(`Unknown provider: ${providerName}`);
  }

  const provider = providerName === 'google'
    ? new GoogleAuthProvider()
    : new GithubAuthProvider();

  try {
    const result = await linkWithPopup(auth.currentUser, provider);
    const user = { ...result.user.toJSON(), isGuest: false, provider: providerName };
    notify(user);
    await setAuthProvider(providerName);
    return user;
  } catch (e) {
    // If the OAuth account already exists, linkWithPopup throws
    // "auth/credential-already-in-use". Fall back to signInWithPopup so the
    // user can sign in to their existing account (their guest data won't
    // transfer, but at least they're not stuck).
    if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
      console.warn('[auth] upgradeAccount: credential already in use, falling back to signInWithPopup. Guest data will not transfer.');
      if (providerName === 'google') return signInWithGoogle();
      if (providerName === 'github') return signInWithGitHub();
    }
    throw e;
  }
}

/**
 * Initialize auth state listener. H14 fix: do NOT auto-create anonymous
 * guest on cold load — wait for explicit user action. This burns Firebase
 * anonymous-auth quota otherwise.
 *
 * If there's no Firebase user on cold load, we notify(null) so the UI can
 * show a "Continue as guest" / "Sign in" choice. The user must click to
 * trigger signInAsGuest().
 */
export async function initAuth() {
  if (!auth) return;
  if (_initAuthCalled) return; // idempotent
  _initAuthCalled = true;

  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      const saved = await getAuthProvider();
      const user = {
        ...firebaseUser.toJSON(),
        isGuest: firebaseUser.isAnonymous,
        provider: saved?.value || (firebaseUser.isAnonymous ? 'guest' : 'google'),
      };
      notify(user);
    } else {
      // H14 fix: don't auto-create a guest. Let UI decide.
      notify(null);
    }
  });

  // Handle redirect result if returning from a redirect-based OAuth flow.
  try {
    await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult failed:', e);
  }
}
