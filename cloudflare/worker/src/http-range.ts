/**
 * Minimal single-range HTTP Range parser for R2 media streaming.
 *
 * Video/audio playback requires `206 Partial Content` responses: without
 * them browsers cannot seek and some refuse to play remote files at all.
 * This module is deliberately dependency-free and DOM-free so it can be
 * unit-tested with plain vitest (see `__tests__/http-range.test.ts`).
 */

export interface HttpRange {
  /** First byte position (inclusive). */
  start: number;
  /** Last byte position (inclusive). */
  end: number;
}

/**
 * Parse a `Range` request header against a known object size.
 *
 * Returns:
 *  - `null` when there is no Range header, the header is a non-bytes unit,
 *    or it carries multiple ranges (the caller then serves the full 200 —
 *    both are legal per RFC 9110 §14.2 and keep the worker free of
 *    multipart/byteranges assembly).
 *  - `"unsatisfiable"` when the range cannot be met (caller responds
 *    `416` with `Content-Range: bytes *\/<size>`).
 *  - an `{ start, end }` pair (inclusive, clamped to the object) otherwise.
 *
 * Suffix ranges (`bytes=-500`, the last 500 bytes) are supported; open-ended
 * ranges (`bytes=100-`) run to the end of the object.
 */
export function parseHttpRange(
  header: string | null | undefined,
  size: number,
): HttpRange | "unsatisfiable" | null {
  if (!header || !Number.isFinite(size) || size < 0) return null;
  const m = /^bytes\s*=\s*(.+)$/i.exec(header.trim());
  if (!m) return null;
  // Multiple ranges are legal to answer with a full 200 — assembling
  // multipart/byteranges bodies is not worth the worker CPU for a study app.
  if (m[1].includes(",")) return null;
  const spec = m[1].trim();
  const dash = spec.indexOf("-");
  if (dash < 0) return null;
  const first = spec.slice(0, dash).trim();
  const last = spec.slice(dash + 1).trim();
  if (first === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(last);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    if (size === 0) return "unsatisfiable";
    const start = Math.max(0, size - Math.floor(suffix));
    return { start, end: size - 1 };
  }
  const start = Number(first);
  if (!Number.isFinite(start) || start < 0 || !Number.isInteger(start)) return null;
  if (start >= size) return "unsatisfiable";
  if (last === "") return { start, end: size - 1 };
  const end = Number(last);
  if (!Number.isFinite(end) || end < 0 || !Number.isInteger(end)) return null;
  if (end < start) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}
