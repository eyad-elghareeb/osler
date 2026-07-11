/**
 * SyncProtocol — wire format framing, compression, CRC32, encode/decode.
 * No I/O, no React — pure logic for reuse across any transport.
 *
 * v3 wire format:
 *   "QTV3!" + <10-digit-b64len> + "!" + <8-hex-crc32> + "!" + <lz-base64>
 *
 * QR multi-part prefix:  "qtp:<seq>:<total>:<chunk>"
 * P2P frame prefix:      "QTF:<seq>:<total>:<chunk>"
 * P2P end marker:        "QTF:END"
 */

import LZString from "lz-string";

export const SYNC_PROTOCOL_VERSION = "QTV3";

export const P2P_PREFIX = "QTF:";
export const P2P_END = "QTF:END";
export const QR_PREFIX = "qtp:";

export const P2P_CHUNK_SIZE = 16_384;
export const QR_CHUNK_SIZE = 700;
export const MQTT_RELAY_MAX = 262_144;

/* ── CRC32 ──────────────────────────────────────────────────────────── */

let crcTable: Uint32Array | null = null;

function ensureCrcTable(): void {
  if (crcTable) return;
  crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }
}

export function crc32(str: string): string {
  ensureCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = crcTable![(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/* ── Sanitize ───────────────────────────────────────────────────────── */

function sanitizeWire(wire: string): string {
  if (wire.charCodeAt(0) === 0xfeff) wire = wire.substring(1);
  if (wire.charCodeAt(0) === 0xfffe) wire = wire.substring(1);
  let cleaned = "";
  for (let i = 0; i < wire.length; i++) {
    const code = wire.charCodeAt(i);
    if (code === 0) continue;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0xfffd) continue;
    cleaned += wire.charAt(i);
  }
  return cleaned;
}

/* ── Wire format ────────────────────────────────────────────────────── */

export interface SyncPayload {
  timestamp: number;
  senderName: string;
  data: Record<string, unknown>;
}

export interface SyncPreview {
  senderName: string;
  packCount: number;
  progressCount: number;
  packs: Array<{ uid: string; name: string; attempted: number }>;
}

export function encode(payload: SyncPayload): string {
  const jsonStr = JSON.stringify(payload);
  const compressed = LZString.compressToBase64(jsonStr);
  const lenStr = String(compressed.length).padStart(10, "0");
  const checksum = crc32(compressed);
  return `${SYNC_PROTOCOL_VERSION}!${lenStr}!${checksum}!${compressed}`;
}

export function decode(wire: string): SyncPayload {
  if (!wire || typeof wire !== "string") throw new Error("Empty or non-string sync data");
  wire = sanitizeWire(wire);
  const trimmed = wire.trim();
  if (!trimmed.length) throw new Error("Blank sync data received");

  /* v3 format */
  if (trimmed.startsWith(SYNC_PROTOCOL_VERSION + "!") && trimmed.length >= 24) {
    const parts = trimmed.split("!");
    if (parts.length >= 4 && parts[0] === SYNC_PROTOCOL_VERSION) {
      const lenStr = parts[1];
      const expectedCrc = parts[2];
      const base64 = parts.slice(3).join("!");
      const expectedLen = parseInt(lenStr, 10);
      if (isNaN(expectedLen) || lenStr.length !== 10) throw new Error("Invalid length header");
      if (base64.length !== expectedLen) throw new Error(`Length mismatch: expected ${expectedLen}, got ${base64.length}`);
      const actualCrc = crc32(base64);
      if (actualCrc !== expectedCrc) throw new Error(`CRC mismatch: expected ${expectedCrc}, got ${actualCrc}`);
      if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error("Invalid base64 characters");
      const jsonStr = LZString.decompressFromBase64(base64);
      if (!jsonStr) throw new Error("Decompression failed");
      const trimmedJson = jsonStr.trim();
      if (!trimmedJson.startsWith("{") || !trimmedJson.endsWith("}")) throw new Error("Decompressed data is not a JSON object");
      let payload: SyncPayload;
      try {
        payload = JSON.parse(trimmedJson);
      } catch (e) {
        throw new Error("JSON parse error: " + (e as Error).message);
      }
      if (!payload || typeof payload.data !== "object") throw new Error("Missing payload.data");
      return payload;
    }
  }

  /* Legacy v2 */
  if (trimmed.length >= 16 && trimmed.charAt(10) === "!" && trimmed.charAt(15) === "!") {
    const legacyLen = trimmed.substring(0, 10);
    const legacyChecksum = trimmed.substring(11, 15);
    if (/^\d{10}$/.test(legacyLen) && /^[0-9A-F]{4}$/.test(legacyChecksum)) {
      const legacyBase64 = trimmed.substring(16);
      let sum = 0;
      for (let i = 0; i < legacyBase64.length; i++) sum = (sum + legacyBase64.charCodeAt(i)) % 65536;
      const hex = sum.toString(16).toUpperCase().padStart(4, "0");
      if (hex === legacyChecksum && legacyBase64.length === parseInt(legacyLen, 10)) {
        if (/^[A-Za-z0-9+/=]+$/.test(legacyBase64)) {
          try {
            const json = LZString.decompressFromBase64(legacyBase64);
            if (json) return JSON.parse(json.trim());
          } catch {
            /* fall through */
          }
        }
      }
      throw new Error("Legacy v2 data corrupted");
    }
  }

  /* Raw base64 fallback */
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    const rawJson = LZString.decompressFromBase64(trimmed);
    if (rawJson) {
      const rawTrimmed = rawJson.trim();
      try {
        return JSON.parse(rawTrimmed);
      } catch {
        const lastBrace = rawTrimmed.lastIndexOf("}");
        if (lastBrace > 0) {
          try {
            return JSON.parse(rawTrimmed.substring(0, lastBrace + 1));
          } catch {
            /* fall through */
          }
        }
      }
    }
    throw new Error("Failed to decompress raw base64 sync data");
  }

  throw new Error("Unrecognized sync data format");
}

export function preview(wire: string): SyncPreview | null {
  try {
    const payload = decode(wire);
    const preview: SyncPreview = {
      senderName: payload.senderName || "Unknown",
      packCount: 0,
      progressCount: 0,
      packs: [],
    };
    for (const key of Object.keys(payload.data)) {
      if (key.startsWith("osler_progress_")) {
        preview.packCount++;
        const d = payload.data[key] as Record<string, unknown> | undefined;
        preview.packs.push({
          uid: key.replace("osler_progress_", ""),
          name: (d?.uid as string) || key,
          attempted: (d?.attempted as number) || 0,
        });
      }
      if (key.startsWith("osler_sessions_")) {
        preview.progressCount++;
      }
    }
    return preview;
  } catch {
    return null;
  }
}

/* ── P2P framing ────────────────────────────────────────────────────── */

export interface P2PFrame {
  seq: number;
  total: number;
  data: string;
}

export function frameForP2P(wire: string): string[] {
  const frames: string[] = [];
  if (wire.length <= P2P_CHUNK_SIZE) {
    frames.push(`${P2P_PREFIX}1:1:${wire}`);
  } else {
    const total = Math.ceil(wire.length / P2P_CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
      const chunk = wire.substring(i * P2P_CHUNK_SIZE, (i + 1) * P2P_CHUNK_SIZE);
      frames.push(`${P2P_PREFIX}${i + 1}:${total}:${chunk}`);
    }
  }
  frames.push(P2P_END);
  return frames;
}

export function parseP2PFrame(raw: string): P2PFrame | "END" | null {
  if (raw === P2P_END) return "END";
  if (typeof raw !== "string" || !raw.startsWith(P2P_PREFIX)) return null;
  const body = raw.substring(P2P_PREFIX.length);
  const firstColon = body.indexOf(":");
  const secondColon = body.indexOf(":", firstColon + 1);
  if (firstColon < 0 || secondColon < 0) return null;
  const seq = parseInt(body.substring(0, firstColon), 10);
  const total = parseInt(body.substring(firstColon + 1, secondColon), 10);
  const data = body.substring(secondColon + 1);
  if (isNaN(seq) || isNaN(total) || seq < 1 || total < 1 || seq > total) return null;
  return { seq, total, data };
}

/* ── QR chunking ─────────────────────────────────────────────────────── */

export interface QRChunk {
  seq: number;
  total: number;
  data: string;
}

export function frameForQR(wire: string): string[] {
  if (wire.length <= QR_CHUNK_SIZE) return [wire];
  const chunks: string[] = [];
  const total = Math.ceil(wire.length / QR_CHUNK_SIZE);
  for (let i = 0; i < total; i++) {
    const chunk = wire.substring(i * QR_CHUNK_SIZE, (i + 1) * QR_CHUNK_SIZE);
    chunks.push(`${QR_PREFIX}${i + 1}:${total}:${chunk}`);
  }
  return chunks;
}

export function parseQRChunk(text: string): QRChunk | null {
  if (typeof text !== "string") return null;
  if (!text.startsWith(QR_PREFIX)) return { seq: 1, total: 1, data: text };
  const body = text.substring(QR_PREFIX.length);
  const firstColon = body.indexOf(":");
  const secondColon = body.indexOf(":", firstColon + 1);
  if (firstColon < 0 || secondColon < 0) return null;
  const seq = parseInt(body.substring(0, firstColon), 10);
  const total = parseInt(body.substring(firstColon + 1, secondColon), 10);
  const data = body.substring(secondColon + 1);
  if (isNaN(seq) || isNaN(total) || seq < 1 || total < 1 || seq > total) return null;
  return { seq, total, data };
}
