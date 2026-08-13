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
 *  - When Osler runs in cloud mode (`cloud.enabled` + registered account),
 *    enrollment goes through the Worker: it issues the challenge
 *    (`/v1/biometric/register`) and verifies the WebAuthn assertion on the
 *    server (`/v1/biometric/authenticate-complete`). The Worker stores the
 *    credential against the account, so a device whose credential was
 *    revoked server-side can't unlock.
 *  - For demo / local-only operation there's no server: the challenge is
 *    synthesized locally with `crypto.getRandomValues` and the credential
 *    lives only on this device.
 *  - The `osler-biometric-cloud` flag records which mode a credential was
 *    enrolled in. Cloud-backed credentials quick-unlock at the login screen
 *    even though the pending flow there can't mint a session.
 */

import {
  biometricAuthenticateOptions,
  biometricAuthenticateComplete,
  biometricRegisterOptions,
  biometricRegisterComplete,
  biometricCredentialsList,
  biometricCredentialDelete,
  readCloudSession,
  type CloudSession,
} from "@/lib/osler/cloud";

const BIOMETRIC_CRED_KEY = "osler-biometric-credential";
const BIOMETRIC_USER_KEY = "osler-biometric-username";
const BIOMETRIC_ENABLED_KEY = "osler-biometric-enabled";
const BIOMETRIC_CLOUD_KEY = "osler-biometric-cloud";

export interface BiometricAvailability {
  supported: boolean;
  platformAuthenticator: boolean;
  enabled: boolean;
  /** A credential has been registered for this device. */
  enrolled: boolean;
  /** The enrolled credential is tied to the cloud account, so unlock runs
   *  through the Worker's challenge + assertion verification. */
  cloudBacked: boolean;
}

export type BiometricResult =
  | { ok: true; username: string }
  | { ok: false; reason: "unsupported" | "disabled" | "not-enrolled" | "cancelled" | "error"; message?: string };

/* ── Availability checks ──────────────────────────────────────────── */

export async function checkBiometricAvailability(): Promise<BiometricAvailability> {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return { supported: false, platformAuthenticator: false, enabled: false, enrolled: false, cloudBacked: false };
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
    cloudBacked: enrolled && readCloudFlag(),
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

function readCloudFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(BIOMETRIC_CLOUD_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCloudFlag(cloud: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (cloud) {
      window.localStorage.setItem(BIOMETRIC_CLOUD_KEY, "1");
    } else {
      window.localStorage.removeItem(BIOMETRIC_CLOUD_KEY);
    }
  } catch { /* noop */ }
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

export async function enrollBiometric(username: string, cloudSession?: CloudSession | null): Promise<BiometricResult> {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return { ok: false, reason: "unsupported" };
  }

  if (cloudSession) {
    // Server-backed enrollment (Settings with an active cloud session): the
    // Worker mints the challenge and stores the credential against the
    // account, so it outlives this device and unlocks from the login screen.
    try {
      const serverOptions = await biometricRegisterOptions(cloudSession);
      const serverKey = serverOptions.publicKey as {
        rp?: { name?: string; id?: string };
        user?: { id?: string; name?: string; displayName?: string };
        challenge?: number[];
        sessionId?: string;
      };
      const challenge = serverKey.challenge;
      const userId = serverKey.user?.id;
      const sessionId = serverKey.sessionId;
      if (!Array.isArray(challenge) || typeof userId !== "string" || typeof sessionId !== "string") {
        return { ok: false, reason: "error", message: "Server returned an invalid WebAuthn challenge." };
      }
      const rp: PublicKeyCredentialRpEntity = serverKey.rp?.name
        ? { name: serverKey.rp.name, ...(serverKey.rp.id ? { id: serverKey.rp.id } : {}) }
        : { name: "Osler" };
      const credential = (await navigator.credentials.create({
        publicKey: {
          rp,
          user: {
            id: base64ToUint8Array(userId) as BufferSource,
            name: serverKey.user?.name ?? username,
            displayName: serverKey.user?.displayName ?? username,
          },
          challenge: new Uint8Array(challenge) as BufferSource,
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },     // ES256 (server only issues this)
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

      const response = credential.response as AuthenticatorAttestationResponse;
      const rawId = uint8ArrayToBase64(credential.rawId ?? new Uint8Array());
      await biometricRegisterComplete(cloudSession, {
        sessionId,
        credential: {
          rawId,
          clientDataJSON: uint8ArrayToBase64(response.clientDataJSON),
          attestationObject: uint8ArrayToBase64(response.attestationObject),
        },
        deviceName: deviceLabel(),
      });

      writeStoredCredential({ id: credential.id, rawId });
      try {
        window.localStorage.setItem(BIOMETRIC_USER_KEY, username);
      } catch { /* noop */ }
      writeCloudFlag(true);
      setBiometricEnabled(true);
      return { ok: true, username };
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        return { ok: false, reason: "cancelled", message: "Biometric prompt was dismissed." };
      }
      return { ok: false, reason: "error", message: err?.message ?? String(err) };
    }
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
    writeCloudFlag(false);
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

  if (readCloudFlag()) {
    // Cloud-backed assertion: the Worker mints the challenge and verifies
    // the ECDSA signature against the registered key before issuing a
    // session — a leaked credential id alone can no longer authenticate.
    try {
      const serverOptions = await biometricAuthenticateOptions({ username: readStoredUsername() ?? undefined });
      const serverKey = serverOptions.publicKey as {
        challenge?: number[];
        sessionId?: string;
        allowCredentials?: Array<{ id: string; type: "public-key"; transports?: string[] }>;
      };
      const challenge = serverKey.challenge;
      const sessionId = serverKey.sessionId;
      if (!Array.isArray(challenge) || typeof sessionId !== "string") {
        return { ok: false, reason: "error", message: "Server returned an invalid WebAuthn challenge." };
      }
      // Only prompt for this device's credential — the account may hold
      // several registered on other devices.
      const mine = serverKey.allowCredentials?.find((c) => c.id === stored.rawId);
      const allowCredentials: PublicKeyCredentialDescriptor[] = mine
        ? [{ id: base64ToUint8Array(mine.id) as BufferSource, type: "public-key", transports: mine.transports as AuthenticatorTransport[] }]
        : [{ id: base64ToUint8Array(stored.rawId) as BufferSource, type: "public-key", transports: ["internal"] }];
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(challenge) as BufferSource,
          timeout: 60_000,
          userVerification: "required",
          allowCredentials,
        },
      })) as PublicKeyCredential | null;

      if (!assertion) return { ok: false, reason: "cancelled" };

      const response = assertion.response as AuthenticatorAssertionResponse;
      // Persists the returned CloudSession (same as loginCloudAccount) so a
      // subsequent `login()` picks the account up via readCloudSession.
      const session = await biometricAuthenticateComplete({
        sessionId,
        credential: {
          rawId: uint8ArrayToBase64(assertion.rawId ?? new Uint8Array()),
          response: {
            clientDataJSON: uint8ArrayToBase64(response.clientDataJSON),
            authenticatorData: uint8ArrayToBase64(response.authenticatorData),
            signature: uint8ArrayToBase64(response.signature),
            ...(response.userHandle ? { userHandle: uint8ArrayToBase64(response.userHandle) } : {}),
          },
        },
      });
      return { ok: true, username: session.user.displayName };
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        return { ok: false, reason: "cancelled", message: "Biometric prompt was dismissed." };
      }
      return { ok: false, reason: "error", message: err?.message ?? String(err) };
    }
  }

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

/** Best-effort revoke: when the credential is cloud-backed and a session is
 *  available, delete it from the account first, then clear local state. The
 *  local credential is always cleared even if the server call fails. */
export async function disableBiometric(): Promise<void> {
  if (readCloudFlag()) {
    const session = readCloudSession();
    const stored = readStoredCredential();
    if (session && stored) {
      try {
        const { credentials } = await biometricCredentialsList(session);
        const match = credentials.find((c) => c.credential_id === stored.rawId);
        if (match) await biometricCredentialDelete(session, match.id);
      } catch {
        // best-effort — the local state is cleared regardless
      }
    }
  }
  writeStoredCredential(null);
  writeCloudFlag(false);
  setBiometricEnabled(false);
}

/* ── Human-friendly device name for the account's credential list ─── */

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "WebAuthn device";
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return `${navigator.platform || "Device"} ${isMobile ? "Mobile" : "Browser"}`;
}

/* ── Stored username (for the login screen "quick unlock" hint) ──── */

export function getBiometricUsername(): string | null {
  if (!readEnabledFlag()) return null;
  if (!readStoredCredential()) return null;
  return readStoredUsername();
}
