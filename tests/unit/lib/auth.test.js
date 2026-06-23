import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clear } from '../../../src/lib/storage.js';

const mockUser = {
  uid: 'test-uid-123',
  isAnonymous: true,
  toJSON: () => ({ uid: 'test-uid-123' }),
};

const mockGoogleUser = {
  uid: 'google-uid',
  isAnonymous: false,
  toJSON: () => ({ uid: 'google-uid' }),
  providerId: 'google.com',
};

vi.mock('firebase/auth', () => {
  let _currentUser = null;
  let _onAuthFn = null;

  // Helper: sync _currentUser to the shared auth object from firebase.js mock.
  // We import lazily inside the helper so the mock registry is ready.
  function _sync() {
    try {
      // Vi hoists mocks; we can use the synchronous require pattern via
      // Vitest's module registry. If this fails, the test still works —
      // _currentUser is returned from each signIn* function directly.
    } catch (e) { /* ignore */ }
  }

  return {
    signInAnonymously: vi.fn(() => {
      _currentUser = mockUser;
      _sync();
      return { user: mockUser };
    }),
    signInWithPopup: vi.fn((auth, provider) => {
      const isGoogle = provider?.providerId === 'google.com';
      const user = isGoogle ? mockGoogleUser : { ...mockGoogleUser, uid: 'github-uid', providerId: 'github.com' };
      _currentUser = user;
      _sync();
      return { user };
    }),
    signOut: vi.fn(() => {
      _currentUser = null;
      _sync();
    }),
    onAuthStateChanged: vi.fn((auth, fn) => {
      _onAuthFn = fn;
      return () => {};
    }),
    linkWithPopup: vi.fn(() => {
      const user = { ...mockGoogleUser, uid: 'upgraded-uid', isAnonymous: false,
        toJSON: () => ({ uid: 'upgraded-uid', isAnonymous: false }) };
      _currentUser = user;
      _sync();
      return { user };
    }),
    GoogleAuthProvider: vi.fn(() => ({ providerId: 'google.com' })),
    GithubAuthProvider: vi.fn(() => ({ providerId: 'github.com' })),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
    get currentUser() { return _currentUser; },
    // Test helpers
    __resetMockState: () => { _currentUser = null; _onAuthFn = null; },
    __getCurrentUser: () => _currentUser,
    __setCurrentUser: (u) => { _currentUser = u; },
  };
});

// Wire firebase.js's `auth` object to a mutable shared object.
// Tests can set `_testAuth.currentUser` to simulate Firebase auth state.
export const _testAuth = { currentUser: null };
vi.mock('../../../src/lib/firebase.js', () => ({
  auth: _testAuth,
}));

describe('auth.js', () => {
  beforeEach(async () => {
    await clear('settings');
    localStorage.clear();
    vi.clearAllMocks();
    // Reset shared mock state.
    _testAuth.currentUser = null;
    const firebaseAuth = await import('firebase/auth');
    if (firebaseAuth.__resetMockState) firebaseAuth.__resetMockState();
  });

  it('signInAsGuest creates anonymous user', async () => {
    const { signInAsGuest, currentUser } = await import('../../../src/lib/auth.js');
    const user = await signInAsGuest();
    expect(user.isGuest).toBe(true);
    expect(user.uid).toBe('test-uid-123');
    expect(currentUser().isGuest).toBe(true);
  });

  it('signInWithGoogle returns google-authenticated user', async () => {
    const { signInWithGoogle, currentUser } = await import('../../../src/lib/auth.js');
    const user = await signInWithGoogle();
    expect(user.isGuest).toBe(false);
    expect(user.provider).toBe('google');
  });

  it('signOut from a signed-in user returns to guest mode', async () => {
    const { signInWithGoogle, signOut, currentUser } = await import('../../../src/lib/auth.js');
    await signInWithGoogle();
    expect(currentUser().isGuest).toBe(false);

    const guestAfter = await signOut();
    expect(guestAfter.isGuest).toBe(true);
    // H4 fix: guest.uid should be a real UID (from result.user.toJSON()),
    // not the UserCredential object spread.
    expect(typeof guestAfter.uid).toBe('string');
  });

  it('signOut when already a guest is a no-op (does not create new guest)', async () => {
    const { signInAsGuest, signOut, currentUser } = await import('../../../src/lib/auth.js');
    await signInAsGuest();
    const guestUidBefore = currentUser().uid;

    await signOut();
    // Same guest — no new anonymous user created.
    expect(currentUser().uid).toBe(guestUidBefore);
  });

  it('upgradeAccount uses linkWithPopup to preserve guest data', async () => {
    const firebaseAuth = await import('firebase/auth');
    const { signInAsGuest, upgradeAccount, currentUser } = await import('../../../src/lib/auth.js');
    await signInAsGuest();
    expect(currentUser().isGuest).toBe(true);

    // The firebase.js mock's `auth` object is a static {_testAuth} — it doesn't
    // auto-sync with firebase/auth's internal _currentUser. Sync it manually
    // so `auth.currentUser` returns the mock anonymous user that signInAsGuest
    // just created. (In production, Firebase's getAuth() returns a live object
    // whose .currentUser getter reflects the real auth state.)
    _testAuth.currentUser = mockUser;

    const upgraded = await upgradeAccount('google');
    expect(upgraded.isGuest).toBe(false);
    expect(upgraded.uid).toBe('upgraded-uid');
    expect(firebaseAuth.linkWithPopup).toHaveBeenCalled();
  });

  it('initAuth subscribes to onAuthStateChanged (does not auto-create guest)', async () => {
    const firebaseAuth = await import('firebase/auth');
    const { initAuth, subscribe } = await import('../../../src/lib/auth.js');
    const states = [];
    subscribe(u => states.push(u));
    await initAuth();
    // initAuth should call onAuthStateChanged (registers listener) but should
    // NOT auto-call signInAnonymously on cold load.
    expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalled();
    expect(firebaseAuth.signInAnonymously).not.toHaveBeenCalled();
  });
});
