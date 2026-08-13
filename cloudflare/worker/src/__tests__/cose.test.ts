import { describe, it, expect } from "vitest";
import { extractEcP256Key, verifyAssertion, unb64url } from "../cose";

// Tiny CBOR encoder for the WebAuthn structures we need to fabricate
// attestationObjects in tests. Not exported from cose.ts — tests only.
const enc = new TextEncoder();

function encMajor(major: number, len: number): number[] {
  if (len < 24) return [major << 5 | len];
  if (len < 256) return [major << 5 | 24, len];
  if (len < 65536) return [major << 5 | 25, (len >> 8) & 0xff, len & 0xff];
  const out = [major << 5 | 26];
  for (let i = 3; i >= 0; i -= 1) out.push((len >>> (i * 8)) & 0xff);
  return out;
}
function encInt(n: number): number[] {
  return n >= 0 ? encMajor(0, n) : encMajor(1, -1 - n);
}
function encBytes(u: Uint8Array): number[] {
  return [...encMajor(2, u.length), ...Array.from(u)];
}
function encText(s: string): number[] {
  const u = enc.encode(s);
  return [...encMajor(3, u.length), ...Array.from(u)];
}
function encMap(entries: Array<[number[], number[]]>): number[] {
  const body: number[] = encMajor(5, entries.length);
  for (const [k, v] of entries) body.push(...k, ...v);
  return body;
}

function b64url(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    str += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const STATIC_X = "rdkuRN_AjCVQwDnqYm-DmcfH4zgjD2bAsP0dXcsooM4";
const STATIC_Y = "oeTe57-Q9CmcIhVS7dXWnMFCA0_5jbJxm7sJBcpuhzk";

/** Build a WebAuthn attestationObject with a real or synthetic ES256 key. */
function buildAttestationObject(rpIdHash: Uint8Array, xB64: string, yB64: string): Uint8Array {
  const x = unb64url(xB64);
  const y = unb64url(yB64);
  // COSE EC2 key: { 1: 2 (kty EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y }
  const coseKey = encMap([
    [encInt(1), encInt(2)],
    [encInt(3), encInt(-7)],
    [encInt(-1), encInt(1)],
    [encInt(-2), encBytes(x)],
    [encInt(-3), encBytes(y)],
  ]);
  const credentialId = enc.encode("test-credential-id");
  // authData: rpIdHash(32) | flags(1) | signCount(4) | aaguid(16) | credIdLen(2) | credId | coseKey
  const authData = new Uint8Array(32 + 1 + 4 + 16 + 2 + credentialId.length + coseKey.length);
  authData.set(rpIdHash, 0);
  authData[32] = 0x45; // UP (0x01) | UV (0x04) | AT (0x40)
  authData.set(new Uint8Array([0, 0, 0, 1]), 33);
  authData.set(new Uint8Array(16), 37);
  authData[53] = (credentialId.length >> 8) & 0xff;
  authData[54] = credentialId.length & 0xff;
  authData.set(credentialId, 55);
  authData.set(new Uint8Array(coseKey), 55 + credentialId.length);
  // attestationObject: { "fmt": "none", "attStmt": {}, "authData": <bytes> }
  const obj = encMap([
    [encText("fmt"), encBytes(enc.encode("none"))],
    [encText("attStmt"), encBytes(new Uint8Array())],
    [encText("authData"), encBytes(authData)],
  ]);
  return new Uint8Array(obj);
}

describe("extractEcP256Key", () => {
  it("extracts x/y from a synthetically built attestationObject", () => {
    const rpHash = new Uint8Array(32).fill(7);
    const key = extractEcP256Key(b64url(buildAttestationObject(rpHash, STATIC_X, STATIC_Y)));
    expect(key).toEqual({ x: STATIC_X, y: STATIC_Y });
  });

  it("returns null for garbage / missing data", () => {
    expect(extractEcP256Key("")).toBeNull();
    expect(extractEcP256Key("bm90LWNib3I=")).toBeNull();
    expect(extractEcP256Key(b64url(enc.encode("plain text")))).toBeNull();
  });

  it("returns null when the key is not a complete ES256 EC key", () => {
    const rpHash = new Uint8Array(32).fill(9);
    // Only the x coordinate present — truncated COSE map.
    const x = unb64url(STATIC_X);
    const coseKey = encMap([
      [encInt(3), encInt(-7)],
      [encInt(-2), encBytes(x)],
    ]);
    const authData = new Uint8Array(55 + coseKey.length);
    authData.set(rpHash, 0);
    authData[37] = 16;
    authData[53] = 0; authData[54] = 0;
    authData.set(new Uint8Array(coseKey), 55);
    const obj = encMap([
      [encText("fmt"), encBytes(enc.encode("none"))],
      [encText("attStmt"), encBytes(new Uint8Array())],
      [encText("authData"), encBytes(authData)],
    ]);
    expect(extractEcP256Key(b64url(new Uint8Array(obj)))).toBeNull();
  });
});

describe("verifyAssertion", () => {
  it("accepts a genuine ES256 assertion and rejects tampered input", async () => {
    const rpId = "localhost";
    const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(rpId)));

    const pair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;

    const attestationObject = buildAttestationObject(rpHash, jwk.x!, jwk.y!);

    // authenticatorData mirrors the registration-time bytes: rpIdHash + flags
    // (UP + UV), but as an assertion the AT flag is clear.
    const clientDataJSON = enc.encode(JSON.stringify({
      type: "webauthn.get",
      challenge: "dGhlLWNoYWxsZW5nZQ",
      origin: "https://app.osler.example",
      crossOrigin: false,
    }));
    const authData = new Uint8Array(37);
    authData.set(rpHash, 0);
    authData[32] = 0x05; // UP + UV
    authData.set(new Uint8Array([0, 0, 0, 2]), 33);

    const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
    const message = new Uint8Array(authData.length + clientHash.length);
    message.set(authData, 0);
    message.set(clientHash, authData.length);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message));

    const args = (rp: string, ad: Uint8Array, sig: Uint8Array, cdj: Uint8Array) => [
      b64url(attestationObject), rp, b64url(ad), b64url(sig), b64url(cdj),
    ] as const;

    expect(await verifyAssertion(...args(rpId, authData, signature, clientDataJSON))).toBe(true);

    // Tampered signature must fail.
    const badSig = new Uint8Array(signature);
    badSig[0] ^= 0xff;
    expect(await verifyAssertion(...args(rpId, authData, badSig, clientDataJSON))).toBe(false);

    // A different RP id must fail (rpIdHash mismatch).
    expect(await verifyAssertion(...args("attacker.example", authData, signature, clientDataJSON))).toBe(false);

    // Missing UV flag must fail even with a valid signature.
    const noUv = new Uint8Array(authData);
    noUv[32] = 0x01;
    const msg2 = new Uint8Array(noUv.length + clientHash.length);
    msg2.set(noUv, 0);
    msg2.set(clientHash, noUv.length);
    const sig2 = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, msg2));
    expect(await verifyAssertion(...args(rpId, noUv, sig2, clientDataJSON))).toBe(false);
  });
});