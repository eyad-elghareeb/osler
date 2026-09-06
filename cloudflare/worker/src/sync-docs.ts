// Pure sync-document helpers: timestamp merge + gzip codec. No I/O, no env —
// reused by the /v1/sync endpoint and unit-tested in __tests__/sync-docs.test.ts.

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

/* ── Size budget ────────────────────────────────────────────────────── */

/** Raw serialization ceiling per stored document (pre-segmentation this was
 *  also the whole-kind limit; segmented kinds now pack MULTIPLE documents
 *  under it — see sync-orchestrator.ts). */
export const MAX_DOCUMENT_BYTES = 2_000_000;
/** Stored (base64 gzip) ceiling per row — D1 rows die at 2MB, and this guard
 *  holds even for incompressible payloads that gzip can't shrink. */
export const MAX_STORED_PAYLOAD_BYTES = 1_800_000;

/* ── Kinds ──────────────────────────────────────────────────────────── */

export const SYNC_KINDS = [
  "qbank",
  "flashcards",
  "sessions",
  "notes",
  "articleHighlights",
  "bookmarks",
  "achievements",
  "settings",
] as const;

export type SyncKind = (typeof SYNC_KINDS)[number];

/** Kinds retired from the sync protocol. Session-bound data (written drafts,
 *  qbank highlights) now rides inside the `sessions` records. Legacy per-kind
 *  rows are lazily deleted by the sync PUT handler so they stop counting
 *  against the user's storage quota. Kept as data so the cleanup stays in
 *  lockstep with this list. */
export const RETIRED_SYNC_KINDS = ["highlights", "writtenDrafts"] as const;

/* ── Merge ──────────────────────────────────────────────────────────── */

export interface MergeResult {
  records: Record<string, any>;
  /** True when `records` actually differs from `remote` (skips no-op D1 writes). */
  changed: boolean;
  /** JSON serialization of `records`. Only computed when `changed` — the sync
   *  PUT caller uses it solely to size/persist a rewritten document, so an
   *  unchanged merge returns `""` to skip the large stringify entirely. */
  json: string;
}

/** Timestamp-bearing kinds → `Record<key, item>` merged by a per-kind time field. */
const TIMESTAMP_KIND: Record<string, { field: string; fallback?: string }> = {
  qbank: { field: "timestamp" },
  flashcards: { field: "lastReviewed" },
  sessions: { field: "completedAt", fallback: "startedAt" },
  notes: { field: "updatedAt" },
  achievements: { field: "unlockedAt" },
};

/** Record keys from sync payloads are attacker-controllable (P2P import,
 *  cloud PUT). "__proto__"/"constructor"/"prototype" as data keys would
 *  silently drop records during merge (or set object prototypes) — skip them. */
function isSafeRecordKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function itemTime(value: any, cfg: { field: string; fallback?: string }): number {
  let t = value?.[cfg.field];
  if ((t === undefined || t === null || t === 0) && cfg.fallback) t = value?.[cfg.fallback];
  return Number(t || 0);
}

function mergeBy(remote: Record<string, any>, local: Record<string, any>, cfg: { field: string; fallback?: string }): MergeResult {
  const out: Record<string, any> = { ...remote };
  let changed = false;
  for (const [key, value] of Object.entries(local || {})) {
    if (!isSafeRecordKey(key)) continue;
    if (!value || typeof value !== "object") continue;
    const existing = out[key];
    if (!existing) {
      out[key] = value;
      changed = true;
    } else {
      const tLocal = itemTime(value, cfg);
      const tRemote = itemTime(existing, cfg);
      // Strictly newer wins; equal timestamps resolve "last writer wins" only
      // when the content actually differs (a no-op re-push must not burn a
      // D1 write). This replicates the old `>=` + serialization-compare
      // semantics without re-stringifying the whole document.
      if (tLocal > tRemote || (tLocal === tRemote && JSON.stringify(value) !== JSON.stringify(existing))) {
        out[key] = value;
        changed = true;
      }
    }
  }
  const json = changed ? JSON.stringify(out) : "";
  return { records: out, changed, json };
}

function itemVersion(item: any): number {
  const raw = item?.createdAt ?? item?.updatedAt;
  const n = typeof raw === "number" ? raw : Date.parse(String(raw ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Tombstone retention window. A deleted highlight/article-highlight is kept
 *  as `{ id, deletedAt, updatedAt }` so its deletion out-ranks the older live
 *  item during merges; after this window the tombstone is pruned (a device
 *  offline longer than that may see one deleted item resurrect — accepted). */
export const TOMBSTONE_TTL_MS = 90 * 86_400_000;

function isLiveItem(item: any): boolean {
  return item?.deletedAt == null;
}

/** Union of two item lists by `id`; a later createdAt/updatedAt wins, ties go
 *  to the incoming item. Deletions propagate via tombstones (newer version
 *  beats the older live item), and stale tombstones are pruned past
 *  TOMBSTONE_TTL_MS so the lists don't grow forever. */
function mergeItemLists(current: any[], incoming: any[]): { list: any[]; changed: boolean } {
  const byId = new Map<string, any>();
  let changed = false;
  for (const item of current || []) if (item && item.id) byId.set(item.id, item);
  for (const item of incoming || []) {
    if (!item || typeof item !== "object" || !item.id) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      changed = true;
    } else if (itemVersion(item) > itemVersion(existing)) {
      byId.set(item.id, item);
      changed = true;
    } else if (itemVersion(item) === itemVersion(existing) && JSON.stringify(item) !== JSON.stringify(existing)) {
      byId.set(item.id, item);
      changed = true;
    }
  }
  let list = Array.from(byId.values());
  // Prune expired tombstones (deterministic by deletedAt, so all replicas
  // converge on the same cutoff).
  const pruned = list.filter((item) => isLiveItem(item) || Date.now() - item.deletedAt <= TOMBSTONE_TTL_MS);
  if (pruned.length !== list.length) {
    list = pruned;
    changed = true;
  }
  return { list: changed ? list : (current || []), changed };
}

/** Array-valued kinds (highlights / articleHighlights): `Record<key, item[]>`
 *  merged per key by per-item id. */
function mergeItemArrays(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  const out: Record<string, any> = { ...remote };
  let changed = false;
  for (const [key, incoming] of Object.entries(local || {})) {
    if (!isSafeRecordKey(key)) continue;
    if (!Array.isArray(incoming)) continue;
    const current = Array.isArray(out[key]) ? out[key] : [];
    const merged = mergeItemLists(current, incoming);
    if (merged.changed) {
      out[key] = merged.list;
      changed = true;
    }
  }
  const json = changed ? JSON.stringify(out) : "";
  return { records: out, changed, json };
}

/** Set union (settings): `Record<key, value>`. Removal is not propagated — a
 *  removed key reappears until removed on every device. Settings keys are
 *  never deleted, so this is safe for its only remaining user. */
function mergeUnion(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  const out: Record<string, any> = { ...remote };
  let changed = false;
  for (const [k, v] of Object.entries(local || {})) {
    if (!isSafeRecordKey(k)) continue;
    if (!(k in out) || JSON.stringify(out[k]) !== JSON.stringify(v)) {
      out[k] = v;
      changed = true;
    }
  }
  const json = changed ? JSON.stringify(out) : "";
  return { records: out, changed, json };
}

/** Two-phase last-writer-wins set (bookmarks): `Record<path, { a: addedAt,
 *  d?: deletedAt }>`. Each counter is a grow-only max, so the merge converges
 *  regardless of push order; a path is live iff `a > (d ?? 0)`. This is what
 *  lets a bookmark removed on one device STAY removed everywhere, while a
 *  later re-add (newer `a`) revives it. Legacy `1` values migrate to {a: 0}. */
function mergeBookmarkEntries(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  const out: Record<string, any> = { ...remote };
  let changed = false;
  for (const [k, v] of Object.entries(local || {})) {
    if (!isSafeRecordKey(k)) continue;
    const inc = normalizeBookmarkEntry(v);
    const cur = k in out ? normalizeBookmarkEntry(out[k]) : { a: 0 };
    const merged = { a: Math.max(inc.a ?? 0, cur.a ?? 0), ...(inc.d || cur.d ? { d: Math.max(inc.d ?? 0, cur.d ?? 0) } : {}) };
    if (!(k in out) || JSON.stringify(out[k]) !== JSON.stringify(merged)) {
      out[k] = merged;
      changed = true;
    }
  }
  const json = changed ? JSON.stringify(out) : "";
  return { records: out, changed, json };
}

/** Legacy bookmarks stored bare `1`s; treat anything without `a` as added at 0. */
function normalizeBookmarkEntry(v: any): { a?: number; d?: number } {
  if (v && typeof v === "object") return { a: Number(v.a) || 0, ...(v.d ? { d: Number(v.d) } : {}) };
  return { a: 0 };
}

export function mergeKind(remote: Record<string, any>, local: Record<string, any>, kind: SyncKind): MergeResult {
  const cfg = TIMESTAMP_KIND[kind];
  if (cfg) return mergeBy(remote, local, cfg);
  if (kind === "bookmarks") return mergeBookmarkEntries(remote, local);
  if (kind === "settings") return mergeUnion(remote, local);
  return mergeItemArrays(remote, local);
}

/** Backward-compatible wrappers (kept for tests / callers that name kinds). */
export function mergeQbank(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  return mergeKind(remote, local, "qbank");
}

export function mergeFlashcards(remote: Record<string, any>, local: Record<string, any>): MergeResult {
  return mergeKind(remote, local, "flashcards");
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

/** gunzip with a hard cap on the DECOMPRESSED size, enforced while streaming
 *  so a gzip bomb is aborted at `maxBytes` instead of buffering unbounded
 *  output into isolate memory. Used for untrusted request bodies. */
export async function gunzipBytesBounded(bytes: Uint8Array, maxBytes: number): Promise<string> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Request body is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  let out = "";
  for (const chunk of chunks) out += decoder.decode(chunk, { stream: true });
  out += decoder.decode();
  return out;
}

/** Decompress a base64 gzip blob back to its original string. */
export async function gunzipString(b64: string): Promise<string> {
  return gunzipBytes(base64ToBytes(b64));
}
