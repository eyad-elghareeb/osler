// Pure sync-document helpers: timestamp merge + gzip codec. No I/O, no env —
// reused by the /v1/sync endpoint and unit-tested in __tests__/sync-docs.test.ts.

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

/* ── Merge ──────────────────────────────────────────────────────────── */

export interface MergeResult {
  records: Record<string, any>;
  /** True when `records` actually differs from `remote` (skips no-op D1 writes). */
  changed: boolean;
  /** JSON serialization of `records` (computed once, reused by callers). */
  json: string;
}

export function mergeQbank(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  return mergeBy(remote, local, "timestamp");
}

export function mergeFlashcards(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  return mergeBy(remote, local, "lastReviewed");
}

function mergeBy(
  remote: Record<string, any>,
  local: Record<string, any>,
  tsField: string,
): MergeResult {
  const out: Record<string, any> = { ...remote };
  for (const [key, value] of Object.entries(local || {})) {
    if (!value || typeof value !== "object") continue;
    if (!out[key] || Number(value[tsField] || 0) >= Number(out[key][tsField] || 0)) {
      out[key] = value;
    }
  }
  const json = JSON.stringify(out);
  const changed = json !== JSON.stringify(remote);
  return { records: out, changed, json };
}

/* ── Gzip codec (base64 transport) ──────────────────────────────────── */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Export so callers can decode a stored base64 payload without re-encoding. */
export { base64ToBytes };

/** gzip a string and return it as base64 (the wire/storage format). */
export async function gzipString(text: string): Promise<string> {
  const stream = new Blob([_encoder.encode(text)]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

/** gunzip a raw byte array back to its original string. */
export async function gunzipBytes(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return _decoder.decode(buf);
}

/** Decompress a base64 gzip blob back to its original string. */
export async function gunzipString(b64: string): Promise<string> {
  return gunzipBytes(base64ToBytes(b64));
}

/** Compressed byte size of a base64 gzip blob (~3/4 of the raw base64 length). */
export function gzipBase64Length(b64: string): number {
  return Math.ceil(b64.length * 0.75);
}
