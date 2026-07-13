/**
 * Osler Biometric Authentication — WebAuthn wrapper.
 *
 * Docs: https://whatpwacando.today/authentication
 * Spec: https://www.w3.org/TR/webauthn-2/
 *
 * Design notes:
 *  - The WebAuthn API can be used as a "passwordless" primary login (using
 *    `authenticatorSelection.userVerification: "required"`) or as a
 *    re-verification step on top of an existing local session. Osler uses
 *    it as the latter: the username is stored locally, and WebAuthn is an
 *    optional "quick unlock" that re-asserts the same identity with a
 *    biometric (Face ID / Touch ID / Windows Hello / Android fingerprint).
 *  - We use the *platform* authenticator (`authenticatorAttachment:
 *    "platform"`) — i.e. the device's built-in biometric. Roaming
 *    authenticators (security keys) are not requested.
 *  - RP ID and origin must match the host that served the page. In dev
 *    that's `localhost`. The challenge is a random 32-byte buffer; we
 *    store the credential ID in localStorage and re-use it on unlock.
 *  - This module is fully optional — if the device doesn't support
 *    WebAuthn, doesn't have a platform authenticator, or the user has
 *    disabled biometrics in Settings, every call short-circuits with a
 *    graceful `unsupported` / `cancelled` / `disabled` result.
 *  - For demo / local-only operation we don't actually need a server.
 *    The "registration" step is `navigator.credentials.create()` and the
 *    "authentication" step is `navigator.credentials.get()`. Both work
 *    fully client-side; the only thing missing is a server-issued
 *    challenge, which we synthesize locally with `crypto.getRandomValues`.
 */

const BIOMETRIC_CRED_KEY = "osler-biometric-credential";
const BIOMETRIC_USER_KEY = "osler-biometric-username";
const BIOMETRIC_ENABLED_KEY = "osler-biometric-enabled";

export interface BiometricAvailability {
  supported: boolean;
  platformAuthenticator: boolean;
  enabled: boolean;
  /** A credential has been registered for this device. */
  enrolled: boolean;
}

export type BiometricResult =
  | { ok: true; username: string }
  | { ok: false; reason: "unsupported" | "disabled" | "not-enrolled" | "cancelled" | "error"; message?: string };

/* ── Availability checks ──────────────────────────────────────────── */

export async function checkBiometricAvailability(): Promise<BiometricAvailability> {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return { supported: false, platformAuthenticator: false, enabled: false, enrolled: false };
  }
  let platformAuthenticator = false;
  try {
    // `isUserVerifyingPlatformAuthenticatorAvailable` resolves true on
    // devices with Touch ID / Face ID / Windows Hello / Android fingerprint.
    platformAuthenticator = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    /* noop */
  }
  const enabled = readEnabledFlag();
  const enrolled = !!readStoredCredential();
  return {
    supported: true,
    platformAuthenticator,
    enabled,
    enrolled,
  };
}

/* ── Settings flag persistence ────────────────────────────────────── */

function readEnabledFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(BIOMETRIC_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setBiometricEnabled(enabled: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BIOMETRIC_ENABLED_KEY, String(enabled));
  } catch { /* noop */ }
}

function readStoredCredential(): { id: string; rawId: string } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(BIOMETRIC_CRED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredCredential(cred: { id: string; rawId: string } | null): void {
  try {
    if (typeof window === "undefined") return;
    if (cred === null) {
      window.localStorage.removeItem(BIOMETRIC_CRED_KEY);
      window.localStorage.removeItem(BIOMETRIC_USER_KEY);
    } else {
      window.localStorage.setItem(BIOMETRIC_CRED_KEY, JSON.stringify(cred));
    }
  } catch { /* noop */ }
}

function readStoredUsername(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(BIOMETRIC_USER_KEY);
  } catch {
    return null;
  }
}

/* ── Low-level helpers ────────────────────────────────────────────── */

function randomChallenge(bytes = 32): Uint8Array {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return arr;
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Browser atob returns a binary string — convert each char to a byte.
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(arr: ArrayBuffer | Uint8Array): string {
  const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* ── Registration (enroll a new biometric credential) ─────────────── */

export async function enrollBiometric(username: string): Promise<BiometricResult> {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return { ok: false, reason: "unsupported" };
  }
  const platformOk = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  if (!platformOk) return { ok: false, reason: "unsupported", message: "No platform authenticator available." };

  const challenge = randomChallenge();
  const userId = new TextEncoder().encode(username);

  // Cast to BufferSource — TS's lib.dom typings are over-strict about
  // ArrayBufferLike vs ArrayBuffer when the underlying buffer is freshly
  // allocated via crypto.getRandomValues (always ArrayBuffer at runtime).
  const challengeBuf = challenge as BufferSource;
  const userIdBuf = userId as BufferSource;

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challengeBuf,
        rp: { name: "Osler" },
        user: {
          id: userIdBuf,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },     // ES256
          { type: "public-key", alg: -257 },   // RS256
        ],
        timeout: 60_000,
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
          requireResidentKey: false,
        },
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!credential) return { ok: false, reason: "cancelled" };

    writeStoredCredential({
      id: credential.id,
      rawId: uint8ArrayToBase64(credential.rawId ?? new Uint8Array()),
    });
    try {
      window.localStorage.setItem(BIOMETRIC_USER_KEY, username);
    } catch { /* noop */ }
    setBiometricEnabled(true);

    return { ok: true, username };
  } catch (err: any) {
    if (err?.name === "NotAllowedError") {
      return { ok: false, reason: "cancelled", message: "Biometric prompt was dismissed." };
    }
    return { ok: false, reason: "error", message: err?.message ?? String(err) };
  }
}

/* ── Authentication (unlock with biometric) ───────────────────────── */

export async function authenticateWithBiometric(): Promise<BiometricResult> {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return { ok: false, reason: "unsupported" };
  }
  if (!readEnabledFlag()) return { ok: false, reason: "disabled" };
  const stored = readStoredCredential();
  if (!stored) return { ok: false, reason: "not-enrolled" };

  const challenge = randomChallenge();
  // See enrollBiometric for the BufferSource cast rationale.
  const challengeBuf = challenge as BufferSource;
  const allowIdBuf = base64ToUint8Array(stored.rawId) as BufferSource;
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuf,
        timeout: 60_000,
        userVerification: "required",
        allowCredentials: [{
          id: allowIdBuf,
          type: "public-key",
          transports: ["internal"],
        }],
      },
    })) as PublicKeyCredential | null;

    if (!assertion) return { ok: false, reason: "cancelled" };
    const username = readStoredUsername() ?? "User";
    return { ok: true, username };
  } catch (err: any) {
    if (err?.name === "NotAllowedError") {
      return { ok: false, reason: "cancelled", message: "Biometric prompt was dismissed." };
    }
    return { ok: false, reason: "error", message: err?.message ?? String(err) };
  }
}

/* ── Unenroll (clears the stored credential) ──────────────────────── */

export function disableBiometric(): void {
  writeStoredCredential(null);
  setBiometricEnabled(false);
}

/* ── Stored username (for the login screen "quick unlock" hint) ──── */

export function getBiometricUsername(): string | null {
  if (!readEnabledFlag()) return null;
  if (!readStoredCredential()) return null;
  return readStoredUsername();
}
