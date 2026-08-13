// WebAuthn COSE/CBOR helpers. The biometric unlock path previously issued a
// session after checking ONLY the client-supplied clientDataJSON (type,
// challenge, origin) and that the presented credential id was among the
// target's registered ids. Nothing bound the assertion to a private key the
// client cannot forge, so anyone could claim any account with a registered
// biometric — including an admin. These helpers give the worker the pieces
// the WebAuthn spec says it must verify server-side:
//   1. extractEcP256Key   — pull the ECDSA P-256 public key out of the
//                            attestationObject captured at enrollment
//                            (the public key always travels in authData,
//                            even under attestation: "none").
//   2. verifyAssertion    — verify the assertion `signature` over
//                            authenticatorData || SHA256(clientDataJSON),
//                            and bind authenticatorData's rpIdHash + UP/UV
//                            flags to this origin.

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    str += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function unb64url(value: string): Uint8Array {
  const cleaned = value.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = atob(cleaned + "===".slice((cleaned.length + 3) % 4));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

/* ── Minimal CBOR decoder (WebAuthn structures only) ─────────────── */

type Cbor = number | boolean | null | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

function readLength(bytes: Uint8Array, pos: { n: number }, initial: number): number {
  const ai = initial & 0x1f;
  if (ai < 24) return ai;
  const take = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : -1;
  if (take < 0) throw new Error("Invalid CBOR length");
  let v: number;
  if (take === 1) v = bytes[pos.n];
  else if (take === 2) v = (bytes[pos.n] << 8) | bytes[pos.n + 1];
  else if (take === 4) v = (bytes[pos.n] * 0x1000000) + ((bytes[pos.n + 1] << 16) | (bytes[pos.n + 2] << 8) | bytes[pos.n + 3]);
  else {
    const hi = (bytes[pos.n] * 0x1000000) + ((bytes[pos.n + 1] << 16) | (bytes[pos.n + 2] << 8) | bytes[pos.n + 3]);
    const lo = (bytes[pos.n + 4] * 0x1000000) + ((bytes[pos.n + 5] << 16) | (bytes[pos.n + 6] << 8) | bytes[pos.n + 7]);
    if (hi > 0x200000) throw new Error("CBOR integer too large");
    v = hi * 0x100000000 + lo;
  }
  pos.n += take;
  return v;
}

function cborItem(bytes: Uint8Array, pos: { n: number }): Cbor {
  const ib = bytes[pos.n];
  pos.n += 1;
  const major = ib >> 5;
  if (major === 0) return readLength(bytes, pos, ib);
  if (major === 1) return -1 - readLength(bytes, pos, ib);
  if (major === 2) {
    const len = readLength(bytes, pos, ib);
    const out = bytes.subarray(pos.n, pos.n + len);
    pos.n += len;
    return out;
  }
  if (major === 3) {
    const len = readLength(bytes, pos, ib);
    const out = _decoder.decode(bytes.subarray(pos.n, pos.n + len));
    pos.n += len;
    return out;
  }
  if (major === 4) {
    const len = readLength(bytes, pos, ib);
    const arr: Cbor[] = [];
    for (let i = 0; i < len; i += 1) arr.push(cborItem(bytes, pos));
    return arr;
  }
  if (major === 5) {
    const len = readLength(bytes, pos, ib);
    const map = new Map<Cbor, Cbor>();
    for (let i = 0; i < len; i += 1) {
      const k = cborItem(bytes, pos);
      const v = cborItem(bytes, pos);
      map.set(k, v);
    }
    return map;
  }
  if (major === 6) {
    readLength(bytes, pos, ib); // skip tag value
    return cborItem(bytes, pos);
  }
  if (major === 7) {
    const ai = ib & 0x1f;
    if (ai === 20) return false;
    if (ai === 21) return true;
    if (ai === 22) return null;
    if (ai === 26) {
      const v = (bytes[pos.n] * 0x1000000) + ((bytes[pos.n + 1] << 16) | (bytes[pos.n + 2] << 8) | bytes[pos.n + 3]);
      pos.n += 4;
      return v;
    }
    throw new Error("Unsupported CBOR value");
  }
  throw new Error("Unsupported CBOR type");
}

const KEY_X = -2;
const KEY_Y = -3;

/**
 * Extract the ECDSA P-256 public key (base64url x/y) from a WebAuthn
 * attestationObject. Returns null when the structure is missing, truncated,
 * or not an ES256 key. The credential public key is REQUIRED inside
 * attestedCredentialData regardless of attestation format, so this works for
 * the `attestation: "none"` enrollment this worker requests.
 */
export function extractEcP256Key(attestationObjectB64: string): { x: string; y: string } | null {
  try {
    const bytes = unb64url(attestationObjectB64);
    const pos = { n: 0 };
    const root = cborItem(bytes, pos);
    if (!(root instanceof Map)) return null;
    const authData = root.get("authData");
    if (!(authData instanceof Uint8Array) || authData.length < 55) return null;
    // authData layout: rpIdHash(32) | flags(1) | signCount(4) | aaguid(16) | credIdLen(2) | credId | publicKey
    const credIdLen = (authData[53] << 8) | authData[54];
    const pkBytes = authData.subarray(55 + credIdLen);
    const keyPos = { n: 0 };
    const key = cborItem(pkBytes, keyPos);
    if (!(key instanceof Map)) return null;
    const x = key.get(KEY_X);
    const y = key.get(KEY_Y);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return null;
    return { x: b64url(x), y: b64url(y) };
  } catch {
    return null;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

/**
 * Verify a WebAuthn assertion (ES256 / P-256) against the stored enrollment.
 * Checks, in order:
 *   1. The authenticator's rpIdHash equals SHA256(rpId) — binds the assertion
 *      to this origin.
 *   2. authenticatorData carries both User Present and User Verified flags
 *      (this worker enlists assertions with `userVerification: "required"`).
 *   3. The raw ECDSA signature validates over
 *      authenticatorData || SHA256(clientDataJSON) with the public key stored
 *      at enrollment.
 * The challenge/origin checks inside clientDataJSON are the CALLER's job
 * (they precede this call in the handler). This function needs no I/O.
 */
export async function verifyAssertion(
  attestationObjectB64: string,
  rpId: string,
  authenticatorDataB64: string,
  signatureB64: string,
  clientDataJSONB64: string,
): Promise<boolean> {
  const key = extractEcP256Key(attestationObjectB64);
  if (!key) return false;
  let ecKey: CryptoKey;
  try {
    ecKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return false;
  }
  let authData: Uint8Array, signature: Uint8Array, cdj: Uint8Array;
  try {
    authData = unb64url(authenticatorDataB64);
    signature = unb64url(signatureB64);
    cdj = unb64url(clientDataJSONB64);
  } catch {
    return false;
  }
  if (authData.length < 37) return false;
  const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", _encoder.encode(rpId)));
  if (!bytesEqual(authData.subarray(0, 32), rpHash)) return false;
  const flags = authData[32];
  if ((flags & FLAG_UP) === 0 || (flags & FLAG_UV) === 0) return false;
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", cdj));
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  try {
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, ecKey, signature, message);
  } catch {
    return false;
  }
}