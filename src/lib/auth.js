import {
  signInAnonymously,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  GithubAuthProvider,
  linkWithPopup,
} from 'firebase/auth';
import { auth } from './firebase.js';
import { put, get } from './storage.js';

const SETTINGS_KEY = 'authProvider';

let _currentUser = null;
const _listeners = [];

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
  } catch {
    return null;
  }
}

async function setAuthProvider(provider) {
  try {
    await put('settings', { key: SETTINGS_KEY, value: provider });
  } catch {}
}

export async function signInAsGuest() {
  if (!auth) throw new Error('Firebase not configured');
  const result = await signInAnonymously(auth);
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

export async function signOut() {
  if (!auth) throw new Error('Firebase not configured');
  await firebaseSignOut(auth);
  const guest = await signInAnonymously(auth);
  const user = { ...guest, isGuest: true, provider: 'guest' };
  notify(user);
  await setAuthProvider('guest');
  return user;
}

export async function upgradeAccount(providerName) {
  if (!auth || !auth.currentUser) throw new Error('No user to upgrade');
  if (!auth.currentUser.isAnonymous) throw new Error('Already authenticated');

  const provider = providerName === 'google'
    ? new GoogleAuthProvider()
    : new GithubAuthProvider();

  const result = await linkWithPopup(auth.currentUser, provider);
  const user = { ...result.user.toJSON(), isGuest: false, provider: providerName };
  notify(user);
  await setAuthProvider(providerName);
  return user;
}

export async function initAuth() {
  if (!auth) return;
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
      const guest = await signInAnonymously(auth);
      const user = { ...guest.user.toJSON(), isGuest: true, provider: 'guest' };
      notify(user);
      await setAuthProvider('guest');
    }
  });
}
