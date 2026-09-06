"use client";

import { readCloudSession, cloudEnabled } from "@/lib/osler/cloud";
import { getConfig } from "@/lib/osler/config";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: "student" | "admin" | "content_admin";
  email: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Extra fields returned only by GET /v1/admin/users/:id. */
export interface AdminUserDetail extends AdminUser {
  hasPassword: boolean;
  hasGeminiKey: boolean;
  emailVerified: boolean;
  activeSessionCount: number;
  content: Array<{
    id: string;
    title: string | null;
    status: ContentStatus;
    contentType: ContentType;
    updatedAt: number;
  }>;
}

export interface UserProgressSummary {
  qbank: { recordCount: number; updatedAt: number };
  flashcards: { recordCount: number; updatedAt: number };
}

export interface AdminCapabilities {
  manageUsers: boolean;
  manageContent: boolean;
  approveContent: boolean;
  publishDirect: boolean;
  viewStats: boolean;
  viewAudit: boolean;
  manageSessions: boolean;
}

export interface AdminIdentity {
  user: AdminUser;
  capabilities: AdminCapabilities;
}

export interface AdminStats {
  userCount: number;
  sessionCount: number;
  contentCount: number;
  pendingCount: number;
  publishedCount: number;
  draftCount: number;
}

export interface AdminAuditEntry {
  id: string;
  actorId: string;
  actorUsername: string | null;
  actorDisplayName: string | null;
  action: string;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: number;
}

export interface AdminAuditPage {
  items: AdminAuditEntry[];
  total: number;
  page: number;
  limit: number;
}

/** Account info joined server-side from users (admin list only). Absent on
 *  other responses; null when the report was filed by a guest. */
export interface TicketUserInfo {
  displayName: string | null;
  username: string | null;
  email: string | null;
  role: string | null;
  createdAt: number | null;
}

/** A user-reported support ticket (see cloudflare/worker/migrations/0001_schema.sql). */
export interface AdminSupportTicket {
  id: string;
  userId: string | null;
  username: string | null;
  source: "settings" | "qbank" | "library";
  category: "bug" | "content" | "feature" | "other";
  subject: string;
  message: string;
  context: {
    packUid?: string;
    packTitle?: string;
    qid?: string;
    questionExcerpt?: string;
    selectedAnswer?: string;
    articleTitle?: string;
    articleFile?: string;
    question?: {
      stem: string;
      choices?: string[];
      correct?: number;
      explanation?: string;
      selected?: number;
    };
  } | null;
  status: "open" | "in_progress" | "resolved";
  reply: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  userInfo?: TicketUserInfo | null;
}

export type TicketStatusFilter = "all" | AdminSupportTicket["status"];

export interface AdminTicketPage {
  items: AdminSupportTicket[];
  total: number;
  openCount: number;
  page: number;
  limit: number;
}

export interface AdminSession {
  id: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

export type ContentType = "quiz" | "bank" | "flashcard" | "written" | "mixed" | "osce" | "library" | "video";
export type ContentStatus = "draft" | "pending" | "published" | "rejected";

export interface ContentObject {
  id: string;
  r2_key_base: string;
  /** Student-facing R2 key this object last published to (e.g.
   *  "content-files/qbank/cardiology/questions.json"). Set at publish time
   *  when a hybrid copy was written; null for drafts / non-hybrid publishes. */
  published_r2_key?: string | null;
  /** Author's desired student-facing location inside the category (e.g.
   *  "cardiology/acute-coronary"). Stored at creation so MCP and admin
   *  drafts both land in a subfolder, not the category root. */
  target_path?: string | null;
  content_type: ContentType;
  title: string | null;
  language: string;
  status: ContentStatus;
  created_by: string;
  creator_username?: string;
  creator_display_name?: string;
  created_at: number;
  updated_at: number;
  submitted_at: number | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  rejection_reason: string | null;
  /** Only present from GET /v1/admin/content/:id */
  body?: string | null;
}

export class AdminApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

// ── Internal fetch helper ────────────────────────────────────────────────────

async function getApiBase(): Promise<string> {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
    return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
  }
  try {
    const config = getConfig();
    const url = config.cloud?.apiUrl;
    if (url) return url.replace(/\/$/, "");
  } catch {}
  throw new AdminApiError(503, "Cloud backend is not configured");
}

async function req<T>(path: string, method: string = "GET", body?: unknown): Promise<T> {
  const enabled = await cloudEnabled();
  if (!enabled) throw new AdminApiError(503, "Cloud features are disabled");

  const base = await getApiBase();
  const session = readCloudSession();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session?.token) headers["authorization"] = `Bearer ${session.token}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const res = await fetch(`${base}${path}`, init);
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new AdminApiError(res.status, data.error ?? "Request failed");
  return data;
}

/** Like `req`, but returns the raw response as a Blob (binary bodies). */
async function reqBinary(path: string): Promise<Blob> {
  const enabled = await cloudEnabled();
  if (!enabled) throw new AdminApiError(503, "Cloud features are disabled");
  const base = await getApiBase();
  const session = readCloudSession();
  const headers: Record<string, string> = {};
  if (session?.token) headers["authorization"] = `Bearer ${session.token}`;
  const res = await fetch(`${base}${path}`, { method: "GET", headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new AdminApiError(res.status, data.error ?? "Request failed");
  }
  return res.blob();
}

/** Fetch every content_object matching a status, paging through the worker's
 *  per-request limit until `total` is reached. The unified studio/browser
 *  trees must render all managed objects, not just the first page. */
async function listAllContent(status: string = "all"): Promise<ContentObject[]> {
  const all: ContentObject[] = [];
  const limit = 100;
  let page = 1;
  for (;;) {
    const res = await req<{ items: ContentObject[]; total: number }>(`/v1/admin/content?status=${status}&page=${page}&limit=${limit}`);
    const items = res.items || [];
    all.push(...items);
    if (all.length >= res.total || items.length === 0) break;
    page += 1;
  }
  return all;
}

/** Invoke a bounded worker run repeatedly until it reports `complete: true`,
 *  summing a progress field across runs. The free-plan subrequest cap means
 *  multi-hundred-key operations (folder delete/rename, orphan GC) can't finish
 *  in one invocation — the worker bounds each run and the caller re-invokes. */
async function loopBoundedRun<T>(
  run: () => Promise<T & { complete: boolean; remaining: number }>,
  progress: (r: T & { complete: boolean; remaining: number }) => number,
  maxRuns = 25
): Promise<{ total: number; runs: number }> {
  let total = 0;
  let runs = 0;
  for (; runs < maxRuns; runs++) {
    const r = await run();
    total += progress(r);
    if (r.complete) break;
  }
  return { total, runs };
}

// ── Public API surface ───────────────────────────────────────────────────────

export const adminApi = {
  // Identity
  me:              ()                            => req<AdminIdentity>("/v1/admin/me"),

  // Stats (admin only)
  stats:           ()                            => req<AdminStats>("/v1/admin/stats"),

  // Audit log (admin only)
  auditLog:        (page: number, action?: string) =>
                                                  req<AdminAuditPage>(`/v1/admin/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ""}`),

  // User management (admin only)
  users:           (page: number, q: string)     => req<{ users: AdminUser[]; total: number; page: number; limit: number }>(`/v1/admin/users?page=${page}&q=${encodeURIComponent(q)}`),
  getUser:         (id: string)                  => req<AdminUserDetail>(`/v1/admin/users/${id}`),
  updateUser:      (id: string, patch: { role?: string; displayName?: string }) => req<AdminUser>(`/v1/admin/users/${id}`, "PATCH", patch),
  resetUserPassword: (id: string, password: string) => req<{ ok: boolean }>(`/v1/admin/users/${id}/reset-password`, "POST", { password }),
  deleteUser:      (id: string)                  => req<{ ok: boolean }>(`/v1/admin/users/${id}`, "DELETE"),
  getUserProgress: (id: string)                  => req<UserProgressSummary>(`/v1/admin/users/${id}/progress`),
  clearUserGeminiKey: (id: string)               => req<{ ok: boolean }>(`/v1/admin/users/${id}/gemini-key`, "DELETE"),
  setUserEmailVerified: (id: string, verified: boolean) => req<{ ok: boolean; emailVerifiedAt: number | null }>(`/v1/admin/users/${id}/email-verification`, "PATCH", { verified }),

  // Session management (admin only)
  userSessions:    (id: string)                  => req<{ sessions: AdminSession[] }>(`/v1/admin/users/${id}/sessions`),
  revokeUserSessions: (id: string)               => req<{ ok: boolean }>(`/v1/admin/users/${id}/sessions`, "DELETE"),

  // Content (admin + content_admin)
  listContent:     (status: string, q?: string, page = 1, limit = 50)  => req<{ items: ContentObject[]; total: number; page: number; limit: number }>(`/v1/admin/content?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page}&limit=${limit}`),
  listAllContent:  (status = "all") => listAllContent(status),
  getContent:      (id: string)                  => req<ContentObject>(`/v1/admin/content/${id}`),
  createContent:   (payload: { contentType: ContentType; title: string; language: string; content?: string; targetPath?: string }) =>
                                                    req<{ id: string; r2KeyBase: string; status: string }>("/v1/admin/content", "POST", payload),
  saveDraft:       (id: string, body: string)    => req<{ ok: boolean }>(`/v1/admin/content/${id}/draft`, "PUT", body),
  submitForReview: (id: string)                  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/submit`, "POST"),
  /** Direct publish with optional hybrid push to student-facing R2 keyspace.
   *  `targetPath` lets you choose where the content lands inside the category
   *  folder (e.g. "cardiology/acute-coronary/questions.json"). Pass `hybrid:
   *  false` to skip the student-facing copy. */
  publishDirect:   (id: string, opts?: { targetPath?: string; hybrid?: boolean }) =>
                                                    req<{ ok: boolean; status: string; hybridKeys: string[] }>(`/v1/admin/content/${id}/publish`, "POST", opts ?? {}),
  unpublish:       (id: string)                  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/unpublish`, "POST"),
  deleteContent:   (id: string)                  => req<{ ok: boolean }>(`/v1/admin/content/${id}`, "DELETE"),

  /** Validate a content_object's draft (or supplied body) against the schema. */
  validateContent: (id: string, body?: string)   => req<{ errors: string[] }>(`/v1/admin/content/${id}/validate`, "POST", body ? { body } : {}),
  /** Validate arbitrary content+body without a content_object. */
  validateStandalone: (contentType: ContentType, body: string) =>
                                                    req<{ errors: string[] }>(`/v1/admin/content/validate`, "POST", { contentType, body }),

  /** Raw R2 file upload — same endpoint used by scripts/upload-content-to-r2.js.
   *  `key` is the full R2 key (e.g. "content-files/library/cardiology/asthma.md").
   *  `body` is either text or a data URI ("data:image/png;base64,...") for
   *  binary assets. */
  uploadFile:      (key: string, body: string)   => req<{ ok: boolean; key: string }>("/v1/admin/content/upload-file", "POST", { key, body }),

  /** List raw R2 keys under content-files/<prefix>. */
  // Config management
  getConfig:       ()                            => req<Record<string, unknown>>("/v1/admin/config"),
  updateConfig:    (config: Record<string, unknown>) => req<{ ok: boolean }>("/v1/admin/config", "PUT", config),

  listR2Keys:      (prefix: string, cursor?: string, scope?: "content-files" | "content-staging") =>
                                                    req<{ items: Array<{ key: string; size: number; uploaded: string | null }>; cursor: string | null }>(`/v1/admin/content/r2-keys?prefix=${encodeURIComponent(prefix)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}${scope && scope !== "content-files" ? `&scope=${scope}` : ""}`),
  /** Delete an R2 key (content-files/, content-staging/ and content-manifests/ allowed). */
  deleteR2Key:     (key: string)                 => req<{ ok: boolean }>(`/v1/admin/content/r2-key?key=${encodeURIComponent(key)}`, "DELETE"),
  /** Move staged keys (content-staging/) into content-files/ so students can
   *  see them, then rebuild manifests for the affected categories. The worker
   *  bounds each run (free-plan subrequest cap) and reports the remainder —
   *  loop until `complete` for large staged folders. */
  publishStaged:   (keys: string[])            => req<{ ok: boolean; published: string[]; remaining: number; complete: boolean }>("/v1/admin/content/publish-staged", "POST", { keys }),
  /** Delete staged keys (content-staging/) without publishing them. Bounded
   *  per run — loop until `complete`. */
  discardStaged:   (keys: string[])            => req<{ ok: boolean; deleted: number; remaining: number; complete: boolean }>("/v1/admin/content/discard-staged", "POST", { keys }),
  /** Fetch the raw body of an R2 key (content-files/, content-staging/ or
   *  content-manifests/). Admin only — used to preview/edit staged files
   *  that aren't yet served by the public /v1/content/* endpoint. */
  getR2Content:    (key: string)                 => req<{ body: string; contentType: string }>(`/v1/admin/content/r2-content?key=${encodeURIComponent(key)}`),
  /** Fetch an R2 key's bytes as a Blob (uses the worker's `?raw=1` path so
   *  binary assets like staged images preview correctly instead of being
   *  decoded to corrupt text). Admin only. */
  getR2Binary:     (key: string)                 => reqBinary(`/v1/admin/content/r2-content?key=${encodeURIComponent(key)}&raw=1`),
  /** Rename (move) an R2 key inside content-files/. */
  renameR2Key:     (from: string, to: string)    => req<{ ok: boolean; from: string; to: string }>("/v1/admin/content/r2-rename", "POST", { from, to }),
  /** Recursively move every key under a content-files/ (and content-staging/)
   *  prefix to a new path (same category), then regenerate the manifest.
   *  `from`/`to` are the folder prefix without the keyspace, e.g.
   *  "library/cardiology" → "library/cardio". The worker bounds each run to
   *  fit the free-plan subrequest cap, so the helper loops until complete. */
  renameR2Folder:  async (from: string, to: string) => {
    const { total, runs } = await loopBoundedRun(
      () => req<{ ok: boolean; moved: number; remaining: number; complete: boolean }>("/v1/admin/content/r2-rename-prefix", "POST", { from, to }),
      (r) => r.moved
    );
    return { ok: true, moved: total, runs };
  },
  /** Recursively delete every key under a content-files/ (and content-staging/)
   *  prefix, then regenerate the category manifest. `prefix` is the folder
   *  path without the keyspace, e.g. "library/cardiology". The worker bounds
   *  each run to fit the free-plan subrequest cap, so the helper loops until
   *  complete. */
  deleteR2Folder:  async (prefix: string) => {
    const { total, runs } = await loopBoundedRun(
      () => req<{ ok: boolean; deleted: number; remaining: number; complete: boolean }>("/v1/admin/content/r2-delete-prefix", "POST", { prefix }),
      (r) => r.deleted
    );
    return { ok: true, deleted: total, runs };
  },
  /** Create an "empty folder" by writing a `.keep` placeholder. */
  createR2Folder:  (path: string)                => req<{ ok: boolean; key: string }>("/v1/admin/content/r2-folder", "POST", { path }),
  /** Rebuild the manifest for one category (or "all"). */
  regenerateManifest: (category: string)         => req<{ ok: boolean; results: Record<string, string> }>("/v1/admin/content/regenerate-manifest", "POST", { category }),

  /** Sweep orphaned managed R2 objects (content/<type>/<uuid>/ keys with no
   *  content_objects row — debris from failed backfill runs). Bounded per
   *  invocation; loops until complete. Returns total deleted + remaining. */
  gcOrphans:       async () => {
    let deleted = 0;
    let runs = 0;
    for (;;) {
      const r = await req<{ ok: boolean; scanned: number; deleted: number; remaining: number; complete: boolean }>("/v1/admin/content/gc-orphans", "POST");
      deleted += r.deleted;
      runs += 1;
      if (r.complete || runs >= 25) return { ok: true, deleted, runs, remaining: r.complete ? 0 : r.remaining };
    }
  },

  /** Look up the content_object (if any) that publishes to the given R2 key
   *  inside content-files/. Returns { found: false } if the key is loose. */
  lookupByR2Key:   (key: string)                 => req<{ found: boolean; object?: ContentObject }>(`/v1/admin/content/by-r2-key?key=${encodeURIComponent(key)}`),

  /** Promote a loose content-files/.../file.json (or .md) into a managed
   *  content_object. Returns the new (or existing) object id. Idempotent —
   *  calling adopt() twice on the same key returns the same id. */
  adoptR2Key:      (key: string, opts?: { contentType?: ContentType; title?: string; language?: string }) =>
                                                    req<{ id: string; r2KeyBase: string; status: string; adopted: boolean; alreadyExisted: boolean }>("/v1/admin/content/adopt", "POST", { key, ...opts }),

  /** Upload a binary or text asset scoped directly to a content object. */
  uploadAsset: async (id: string, path: string, body: Blob | File | string, contentType?: string) => {
    const enabled = await cloudEnabled();
    if (!enabled) throw new AdminApiError(503, "Cloud features are disabled");
    const base = await getApiBase();
    const session = readCloudSession();
    const headers: Record<string, string> = {};
    if (session?.token) headers["authorization"] = `Bearer ${session.token}`;
    if (contentType) headers["content-type"] = contentType;
    else if (typeof body !== "string" && (body as any).type) headers["content-type"] = (body as any).type;
    const res = await fetch(`${base}/v1/admin/content/${id}/asset?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      headers,
      body,
    });
    const data = (await res.json().catch(() => ({}))) as { ok: boolean; key: string; relPath: string; error?: string };
    if (!res.ok) throw new AdminApiError(res.status, data.error ?? "Asset upload failed");
    return data;
  },

  /** Fetch a draft asset associated with a content object as a Blob. */
  getAssetBlob:    (id: string, path: string) => reqBinary(`/v1/admin/content/${id}/asset?path=${encodeURIComponent(path)}`),

  /** Trigger batch backfill of raw files in content-files/ to managed content_objects. */
  backfillContent: () => req<{ ok: boolean; backfilled: number; existing: number; total: number; errors: string[]; complete: boolean }>("/v1/admin/content/backfill", "POST"),

  // Review (admin only)
  pendingQueue:    ()                            => req<{ items: ContentObject[] }>("/v1/admin/content/pending"),
  getDiff:         (id: string)                  => req<{ pending: string | null; published: string | null }>(`/v1/admin/content/${id}/diff`),
  approveContent:  (id: string, targetPath?: string) =>
                                                    req<{ ok: boolean; status: string; hybridKeys: string[] }>(`/v1/admin/content/${id}/approve`, "POST", targetPath ? { targetPath } : {}),
  rejectContent:   (id: string, reason: string)  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/reject`, "POST", { reason }),

  // Support tickets (admin + content_admin)
  tickets:         (page: number, status: TicketStatusFilter) =>
                                                   req<AdminTicketPage>(`/v1/admin/tickets?page=${page}${status !== "all" ? `&status=${status}` : ""}`),
  updateTicket:    (id: string, patch: { status?: AdminSupportTicket["status"]; reply?: string | null }) =>
                                                   req<{ ticket: AdminSupportTicket | null }>(`/v1/admin/tickets/${encodeURIComponent(id)}`, "PATCH", patch),
  deleteTicket:    (id: string)                  => req<{ ok: boolean }>(`/v1/admin/tickets/${encodeURIComponent(id)}`, "DELETE"),
};

// ── Analytics API (admin only) ──────────────────────────────────────────────
//
// Reads the privacy-preserving performance & usage telemetry collected by the
// AnalyticsProvider and stored in D1 `analytics_events`. See
// `src/lib/osler/analytics.ts` for the collection contract and
// `cloudflare/worker/migrations/0001_schema.sql` for the schema.

export type AnalyticsRange = "24h" | "7d" | "30d";

export interface AnalyticsOverview {
  range: AnalyticsRange;
  totalEvents: number;
  /** Lifetime event count: analytics_daily rollup (survives the 30-day raw
   *  event prune) + today's live events. Absent on older Workers. */
  allTimeEvents?: number;
  totalSessions: number;
  pageViews: number;
  jsErrors: number;
  webVitals: number;
  apiCalls: number;
  routeChanges: number;
  lastEventAt: number | null;
  events24h: number;
  sessions24h: number;
  jsErrors24h: number;
}

export interface AnalyticsTimeseriesPoint {
  ts: number;
  page_view: number;
  web_vital: number;
  js_error: number;
  api_call: number;
  route_change: number;
}

export interface AnalyticsTimeseries {
  range: AnalyticsRange;
  bucketMs: number;
  series: AnalyticsTimeseriesPoint[];
}

export interface AnalyticsWebVitalMetric {
  name: string;
  count: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

export interface AnalyticsWebVitals {
  range: AnalyticsRange;
  metrics: AnalyticsWebVitalMetric[];
}

export interface AnalyticsTopPage {
  path: string;
  views: number;
  uniqueSessions: number;
  lastSeen: number;
}

export interface AnalyticsTopPages {
  range: AnalyticsRange;
  items: AnalyticsTopPage[];
}

export interface AnalyticsErrorRow {
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  affectedPaths: number;
  affectedSessions: number;
}

export interface AnalyticsErrors {
  range: AnalyticsRange;
  items: AnalyticsErrorRow[];
}

export interface AnalyticsApiPerfRow {
  endpoint: string;
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface AnalyticsApiPerformance {
  range: AnalyticsRange;
  items: AnalyticsApiPerfRow[];
}

/** Per-user subtotal inside a content pack. */
export interface ContentUserStat {
  username: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

/** One content pack's engagement aggregate. `uid` is the pack UID
 *  (e.g. "qbank/cardiology/questions"); `engine` is a ContentType. */
export interface ContentPackStat {
  uid: string;
  engine: string;
  users: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  questions: number;
  firstTryRate: number | null;
  avgTimeMs: number | null;
  flagged: number;
  lastSolvedAt: number | null;
  topUsers: ContentUserStat[];
}

export interface ContentUserTotal {
  username: string;
  packs: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

export interface ContentEngineStat {
  engine: string;
  packs: number;
  users: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

export interface ContentBucketStat {
  bucket: string;
  packs: number;
}

export interface ContentUserTier {
  tier: string;
  users: number;
}

/** "Who solved what, how many times" — aggregated from the per-user
 *  progress documents already stored by the sync pipeline (all-time). */
export interface AnalyticsContent {
  totalPacks: number;
  totalUsers: number;
  totalAttempts: number;
  totalCorrect: number;
  avgAccuracy: number | null;
  totalQuestions: number;
  flaggedQuestions: number;
  firstTryRate: number | null;
  avgTimeMs: number | null;
  byEngine: ContentEngineStat[];
  recencyBuckets: ContentBucketStat[];
  userTiers: ContentUserTier[];
  accuracyBands: ContentBucketStat[];
  packs: ContentPackStat[];
  topUsers: ContentUserTotal[];
}

export interface CloudflareLimitMetric {
  current: number;
  limit: number;
  unit: string;
  percentage: number;
  status: "healthy" | "warning" | "critical" | "exceeded";
  period: "daily" | "monthly" | "storage" | "per_request";
}

export interface CloudflareTableStat {
  table: string;
  /** D1 database that holds the table ("core" | "sync" | "telemetry").
   *  Absent on older Workers — treat as "core". */
  shard?: "core" | "sync" | "telemetry";
  rowCount: number;
  estimatedBytes: number;
  retention: string;
}

export interface CloudflareSafetyThrottle {
  name: string;
  threshold: string;
  status: string;
  protectedQuota: string;
}

export type QuotaSource = "live" | "estimated";

export type QuotaSourceMap = Record<
  "workerRequests" | "d1Writes" | "d1Reads" | "d1Storage" | "r2Storage" | "r2ClassAOps" | "r2ClassBOps" | "workerCpuTime",
  QuotaSource
>;

export interface CloudflareLimitsData {
  status: "healthy" | "warning" | "critical" | "exceeded";
  resetAt: number;
  timeToResetMs: number;
  /** True when at least one section came from the Cloudflare GraphQL API
   *  (CF_ACCOUNT_ID + CF_ANALYTICS_TOKEN configured on the Worker). */
  connected: boolean;
  /** Isolate timestamp of the cached live payload, or null when estimated. */
  liveAt: number | null;
  /** Per-metric provenance. Absent on older Workers — treat as all-estimated. */
  sources?: QuotaSourceMap;
  metrics: {
    workerRequests: CloudflareLimitMetric;
    d1Writes: CloudflareLimitMetric;
    d1Reads: CloudflareLimitMetric;
    d1Storage: CloudflareLimitMetric;
    r2Storage: CloudflareLimitMetric;
    r2ClassAOps: CloudflareLimitMetric;
    r2ClassBOps: CloudflareLimitMetric;
    workerCpuTime: CloudflareLimitMetric;
    workerSubrequests: CloudflareLimitMetric;
  };
  caps: {
    analyticsWriteCap: { current: number; cap: number; percentage: number };
    qstatsWriteCap: { current: number; cap: number; percentage: number };
  };
  executionLatency: {
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
  d1Tables: CloudflareTableStat[];
  totalD1Rows: number;
  totalD1EstimatedBytes: number;
  /** Real summed file size across every D1 database on the account (REST
   *  file_size sum), or null when the token lacks D1 Read and the gauge fell
   *  back to the per-table estimates. Absent on older Workers. */
  d1MeasuredBytes?: number | null;
  /** Measured per-database file sizes with their role in the shard layout
   *  (core / sync / telemetry). Needs D1 Read on the analytics token —
   *  absent on older Workers or without the permission. */
  d1Databases?: Array<{ name: string; role: string; bytes: number }>;
  /** Free-tier storage ceiling per D1 database. */
  d1DatabaseLimitBytes?: number;
  /** Number of bound D1 databases (1 unsharded, 3 fully sharded).
   *  Absent on older Workers — treat as 1. */
  d1Shards?: number;
  safetyThrottles: CloudflareSafetyThrottle[];
}

export const analyticsApi = {
  overview:        (range: AnalyticsRange = "24h") =>
                                                    req<AnalyticsOverview>(`/v1/admin/analytics/overview?range=${range}`),
  timeseries:      (range: AnalyticsRange = "24h") =>
                                                    req<AnalyticsTimeseries>(`/v1/admin/analytics/timeseries?range=${range}`),
  webVitals:       (range: AnalyticsRange = "24h") =>
                                                    req<AnalyticsWebVitals>(`/v1/admin/analytics/web-vitals?range=${range}`),
  topPages:        (range: AnalyticsRange = "24h", limit = 20) =>
                                                    req<AnalyticsTopPages>(`/v1/admin/analytics/top-pages?range=${range}&limit=${limit}`),
  errors:          (range: AnalyticsRange = "24h", limit = 20) =>
                                                    req<AnalyticsErrors>(`/v1/admin/analytics/errors?range=${range}&limit=${limit}`),
  apiPerformance:  (range: AnalyticsRange = "24h", limit = 20) =>
                                                    req<AnalyticsApiPerformance>(`/v1/admin/analytics/api-performance?range=${range}&limit=${limit}`),
  content:         (limit = 20)                   => req<AnalyticsContent>(`/v1/admin/analytics/content?limit=${limit}`),
  cloudflareLimits: ()                            => req<CloudflareLimitsData>("/v1/admin/analytics/cloudflare-limits"),
};

/* ── Question choice stats (per-question answer distribution, all-time) ── */

export interface QuestionStatsPack {
  uid: string;
  responses: number;
  questions: number;
}

/** Per-question choice counts — same shape the students' GET returns,
 *  but WITHOUT the minimum-sample gate. */
export type AdminQuestionStatsMap = Record<string, { c: number[]; t: number; oc: number }>;

export interface AdminQuestionStatsPacks {
  packs: QuestionStatsPack[];
}

export interface AdminQuestionStatsDetail {
  pack: string;
  stats: AdminQuestionStatsMap;
}

export const questionStatsApi = {
  packs:   ()            => req<AdminQuestionStatsPacks>("/v1/admin/analytics/question-stats"),
  detail:  (uid: string) => req<AdminQuestionStatsDetail>(`/v1/admin/analytics/question-stats?uid=${encodeURIComponent(uid)}`),
};

// ── Gemini key management (per-user, stored in D1) ──────────────────────────
//
// These endpoints live on /v1/account/* (not /v1/admin/*) so any signed-in
// user can save their own key. The browser never sees the key after it's
// saved — calls to Gemini are proxied through /v1/account/gemini/proxy.

export interface GeminiKeyInfo {
  apiKey: string | null;
  model: string | null;
  maxWait: number | null;
  hasKey: boolean;
}

async function authedFetch<T>(path: string, method: string = "GET", body?: unknown): Promise<T> {
  const enabled = await cloudEnabled();
  if (!enabled) throw new AdminApiError(503, "Cloud features are disabled");
  const base = await getApiBase();
  const session = readCloudSession();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session?.token) headers["authorization"] = `Bearer ${session.token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(`${base}${path}`, init);
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new AdminApiError(res.status, data.error ?? "Request failed");
  return data;
}

export const geminiApi = {
  get:    ()                          => authedFetch<GeminiKeyInfo>("/v1/account/gemini-key"),
  save:   (apiKey: string | null, model?: string | null, maxWait?: number | null) =>
                                      authedFetch<{ ok: boolean; hasKey: boolean }>("/v1/account/gemini-key", "PUT", { apiKey, model, maxWait }),
  clear:  ()                          => authedFetch<{ ok: boolean }>("/v1/account/gemini-key", "DELETE"),
  /** Server-side proxy for Gemini API calls — never exposes the key to the
   *  browser network tab. Returns the raw Gemini response text. `endpoint`
   *  is "generateContent" | "streamGenerateContent" | "countTokens" | "models"
   *  (anything else is treated as "models"). */
  proxy:  async (endpoint: string, body: unknown, model?: string): Promise<{ status: number; text: string; contentType: string }> => {
    const enabled = await cloudEnabled();
    if (!enabled) throw new AdminApiError(503, "Cloud features are disabled");
    const base = await getApiBase();
    const session = readCloudSession();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session?.token) headers["authorization"] = `Bearer ${session.token}`;
    const res = await fetch(`${base}/v1/account/gemini/proxy`, {
      method: "POST",
      headers,
      body: JSON.stringify({ endpoint, body, model }),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = "Gemini proxy request failed";
      try { const j = JSON.parse(text); msg = j.error ?? msg; } catch {}
      throw new AdminApiError(res.status, msg);
    }
    return { status: res.status, text, contentType: res.headers.get("content-type") ?? "application/json" };
  },
  /** Convenience: test that the saved key works by listing models. */
  test:   ()                          => authedFetch<{ models?: Array<{ name: string }> }>("/v1/account/gemini/proxy", "POST", { endpoint: "models" }),
};

// ── API tokens (MCP access for AI agents) ───────────────────────────────────

export interface AdminApiToken {
  id: string;
  name: string;
  prefix: string;
  scope?: "admin" | "content_admin";
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

export const apiTokens = {
  list: () => req<{ items: AdminApiToken[] }>("/v1/admin/tokens"),
  /** The `token` plaintext is returned exactly once, at creation. */
  create: (name: string, expiresInDays?: number | null, scope?: "admin" | "content_admin") =>
    req<AdminApiToken & { token: string }>("/v1/admin/tokens", "POST", { name, expiresInDays: expiresInDays ?? null, scope: scope ?? "content_admin" }),
  revoke: (id: string) => req<{ ok: boolean }>(`/v1/admin/tokens/${id}`, "DELETE"),
};

/** Full URL agents should connect to (shown in the admin tokens UI). */
export async function getMcpEndpoint(): Promise<string> {
  return `${await getApiBase()}/v1/mcp`;
}

/** MCP OAuth consent — called by the /admin/mcp-authorize page with the
 *  admin's own session; the worker validates the client + redirect_uri and
 *  mints a single-use authorization code for the connecting MCP client. */
export const mcpOAuth = {
  authorize: (params: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
  }) =>
    req<{ redirect_to: string }>("/v1/mcp/oauth/authorize", "POST", {
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      scope: params.scope,
    }),
};

