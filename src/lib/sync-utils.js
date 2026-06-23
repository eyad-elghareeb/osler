// Shared utilities for sync.js and analytics.js.
// Extracted to prevent drift between the two consumers of deviceId (H19 fix).

const DEVICE_ID_KEY = 'osler_device_id';

/**
 * Returns a persistent device identifier, generating one on first call.
 * Stored in localStorage because:
 *   - It must survive IndexedDB quota eviction (Stage 1 evicts studyEvents,
 *     not settings) — see src/lib/quota.js.
 *   - It must be available synchronously on cold load before IndexedDB opens.
 *   - It is NOT user data (it's anonymous device metadata), so the V22 rule
 *     "tracker/streak/sync data goes through storage.js" does not apply.
 *
 * If you need to reset deviceId (e.g. user clears data), delete the
 * `osler_device_id` localStorage key.
 */
export function getDeviceId() {
  if (typeof localStorage === 'undefined') return 'anonymous';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    // Prefer crypto.randomUUID; fall back to a timestamp+random string for
    // older browsers and Node test envs without crypto.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      id = crypto.randomUUID();
    } else {
      id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
