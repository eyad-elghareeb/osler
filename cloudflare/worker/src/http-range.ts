/**
 * Single-range HTTP Range handling for R2 media streaming.
 *
 * Video/audio playback requires `206 Partial Content` responses: without
 * them browsers cannot seek and some refuse to play remote files at all.
 * Parsing is delegated to `range-parser` (the battle-tested module behind
 * Express's res.sendFile); this module only enforces the worker's policy:
 * exactly one range is ever served (multi-range requests get a full 200,
 * which RFC 9110 §14.2 expressly allows, sparing the worker
 * multipart/byteranges assembly).
 */

import parseRange from "range-parser";

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
 *  - `null` when there is no Range header, it is malformed, it uses a
 *    non-bytes unit, or it carries multiple ranges (the caller then serves
 *    the full 200).
 *  - `"unsatisfiable"` when the range cannot be met (caller responds
 *    `416` with `Content-Range: bytes *\/<size>`).
 *  - an `{ start, end }` pair (inclusive, clamped to the object) otherwise.
 */
export function parseHttpRange(
  header: string | null | undefined,
  size: number,
): HttpRange | "unsatisfiable" | null {
  if (!header || typeof header !== "string" || !Number.isFinite(size) || size < 0) return null;
  // RFC 9110 §14.1.2: a suffix longer than the representation selects the
  // entire representation. range-parser is stricter (it reports -1), so
  // normalize that one case here and let the library handle everything else.
  const suffixOnly = /^bytes\s*=\s*-\s*(\d+)\s*$/i.exec(header.trim());
  if (suffixOnly) {
    if (size === 0) return "unsatisfiable";
    if (Number(suffixOnly[1]) >= size) return { start: 0, end: size - 1 };
  }
  let parsed: ReturnType<typeof parseRange>;
  try {
    parsed = parseRange(size, header, { combine: true });
  } catch {
    return null;
  }
  if (parsed === -2) return null;
  if (parsed === -1) return "unsatisfiable";
  // Combined single range (or several — those get a full 200 instead).
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed.type !== "bytes") return null;
  const { start, end } = parsed[0];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(end, size - 1) };
}
