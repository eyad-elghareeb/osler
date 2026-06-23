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

  return {
    signInAnonymously: vi.fn(() => {
      _currentUser = mockUser;
      return { user: mockUser };
    }),
    signInWithPopup: vi.fn((auth, provider) => {
      const isGoogle = provider?.providerId === 'google.com';
      const user = isGoogle ? mockGoogleUser : { ...mockGoogleUser, uid: 'github-uid', providerId: 'github.com' };
      _currentUser = user;
      return { user };
    }),
    signOut: vi.fn(() => {
      _currentUser = null;
    }),
    onAuthStateChanged: vi.fn((auth, fn) => {
      _onAuthFn = fn;
      return () => {};
    }),
    linkWithPopup: vi.fn(() => {
      const user = { ...mockGoogleUser, uid: 'upgraded-uid', isAnonymous: false };
      _currentUser = user;
      return { user };
    }),
    GoogleAuthProvider: vi.fn(() => ({ providerId: 'google.com' })),
    GithubAuthProvider: vi.fn(() => ({ providerId: 'github.com' })),
    get currentUser() { return _currentUser; },
  };
});

vi.mock('../../../src/lib/firebase.js', () => ({
  auth: {},
}));

describe('auth.js', () => {
  beforeEach(async () => {
    await clear('settings');
    vi.clearAllMocks();
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

  it('signOut signs out and returns to guest', async () => {
    const { signInAsGuest, signOut, currentUser } = await import('../../../src/lib/auth.js');
    await signInAsGuest();
    expect(currentUser().isGuest).toBe(true);

    const guestAfter = await signOut();
    expect(guestAfter.isGuest).toBe(true);
  });
});
