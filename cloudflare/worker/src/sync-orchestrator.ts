// Sync orchestrator — maps LOGICAL sync kinds (what clients and the realtime
// hub speak) onto PHYSICAL progress_documents rows. Large kinds (qbank) are
// segmented across multiple rows ("qbank:1", "qbank:2", …) so a single kind
// can exceed D1's 2MB per-row limit; every other kind stays one-row-one-kind.
// The mapping is invisible to clients: they keep pushing and pulling whole
// logical kinds, and the realtime hub keeps poking per logical kind — a
// segmented push costs exactly one poke, never one per segment.
//
// Packing fills segments one by one and starts a new one once the current one
// approaches capacity (85% of MAX_DOCUMENT_BYTES of raw serialization), so a
// segment keeps 15% headroom for growth between re-packs. Records are packed
// in insertion order and every re-pack rebuilds the whole layout, so a record
// may move between segments — the caller rewrites all segment rows of the
// kind atomically in one D1 batch. Pure module: no I/O, no env — the /v1/sync
// endpoint owns the queries; unit tests live in __tests__/sync-orchestrator.test.ts.

import { MAX_DOCUMENT_BYTES } from "./sync-docs";

/** Kinds whose documents are segmented across multiple rows. qbank (quiz
 *  progress) is the per-user kind that outgrows one row; add further kinds
 *  here and their rows follow the same packing rules. */
export const SEGMENTED_KINDS: ReadonlySet<string> = new Set(["qbank"]);

export const SEGMENT_SEPARATOR = ":";

/** "Approaching full" on a segment: at 85% occupancy the orchestrator starts
 *  filling the next segment, leaving 15% headroom so a segment does not
 *  immediately overflow after small edits. */
export const SEGMENT_SOFT_CAP_BYTES = Math.floor(MAX_DOCUMENT_BYTES * 0.85);

/** "qbank" + 2 → "qbank:2". */
export function segmentKind(base: string, index: number): string {
  return `${base}${SEGMENT_SEPARATOR}${index}`;
}

/** "qbank:2" → { base: "qbank", index: 2 }; plain kinds → null. */
export function splitSegmentKind(kind: string): { base: string; index: number } | null {
  const sep = kind.lastIndexOf(SEGMENT_SEPARATOR);
  if (sep <= 0) return null;
  const base = kind.slice(0, sep);
  const index = Number(kind.slice(sep + 1));
  return Number.isInteger(index) && index >= 1 ? { base, index } : null;
}

/** True when `kind` names one segment row of a segmented kind. */
export function isSegmentRow(kind: string): boolean {
  const split = splitSegmentKind(kind);
  return split !== null && SEGMENTED_KINDS.has(split.base);
}

/** The logical kind a physical row belongs to ("qbank:2" → "qbank";
 *  plain rows pass through). */
export function baseKindOfRow(kind: string): string {
  return splitSegmentKind(kind)?.base ?? kind;
}

export interface KindSegment {
  kind: string;
  records: Record<string, unknown>;
  /** Raw JSON serialization of the segment's records. */
  json: string;
}

/** Pack a logical kind's merged records into sequential segment rows. Fills
 *  segment 1 until adding the next record would cross the soft cap, then
 *  moves on to segment 2, and so on — a lone oversized record forms its own
 *  segment and is rejected later by the caller's stored-size guard.
 *
 *  `existingSegmentCount` is how many segment rows the kind currently has:
 *  any beyond the new layout are returned in `deleteKinds` so a shrinking
 *  kind does not leave stale segments behind. The caller also deletes the
 *  pre-segmentation plain `<base>` row on the first segmented write. */
export function packKindSegments(
  base: string,
  records: Record<string, unknown>,
  existingSegmentCount = 0,
): { segments: KindSegment[]; deleteKinds: string[] } {
  const encoder = new TextEncoder();
  const segments: KindSegment[] = [];
  let current: Record<string, unknown> = {};
  let currentBytes = 0;
  let index = 1;
  const flush = () => {
    if (currentBytes === 0) return;
    segments.push({ kind: segmentKind(base, index), records: current, json: JSON.stringify(current) });
    index += 1;
    current = {};
    currentBytes = 0;
  };
  for (const [key, value] of Object.entries(records)) {
    // Per-record serialization cost: the value's JSON plus the key and the
    // record's share of object punctuation. Summed across a kind this is one
    // full stringify — the same CPU the old single-row path paid.
    const bytes = encoder.encode(JSON.stringify(value)).length + encoder.encode(key).length + 8;
    if (currentBytes > 0 && currentBytes + bytes > SEGMENT_SOFT_CAP_BYTES) flush();
    current[key] = value;
    currentBytes += bytes;
  }
  flush();
  const deleteKinds: string[] = [];
  for (let n = segments.length + 1; n <= existingSegmentCount; n++) deleteKinds.push(segmentKind(base, n));
  return { segments, deleteKinds };
}
