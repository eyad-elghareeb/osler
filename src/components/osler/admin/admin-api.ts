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

export interface AdminSession {
  id: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

export type ContentType = "quiz" | "bank" | "flashcard" | "written" | "osce" | "library" | "video";
export type ContentStatus = "draft" | "pending" | "published" | "rejected";

export interface ContentObject {
  id: string;
  r2_key_base: string;
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

  // Session management (admin only)
  userSessions:    (id: string)                  => req<{ sessions: AdminSession[] }>(`/v1/admin/users/${id}/sessions`),
  revokeUserSessions: (id: string)               => req<{ ok: boolean }>(`/v1/admin/users/${id}/sessions`, "DELETE"),

  // Content (admin + content_admin)
  listContent:     (status: string, q?: string, page = 1, limit = 50)  => req<{ items: ContentObject[]; total: number; page: number; limit: number }>(`/v1/admin/content?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page}&limit=${limit}`),
  getContent:      (id: string)                  => req<ContentObject>(`/v1/admin/content/${id}`),
  createContent:   (payload: { contentType: ContentType; title: string; language: string; content?: string }) =>
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
   *  see them, then rebuild manifests for the affected categories. */
  publishStaged:   (keys: string[])              => req<{ ok: boolean; published: string[] }>("/v1/admin/content/publish-staged", "POST", { keys }),
  /** Delete staged keys (content-staging/) without publishing them. */
  discardStaged:   (keys: string[])              => req<{ ok: boolean; deleted: number }>("/v1/admin/content/discard-staged", "POST", { keys }),
  /** Fetch the raw body of an R2 key (content-files/, content-staging/ or
   *  content-manifests/). Admin only — used to preview/edit staged files
   *  that aren't yet served by the public /v1/content/* endpoint. */
  getR2Content:    (key: string)                 => req<{ body: string; contentType: string }>(`/v1/admin/content/r2-content?key=${encodeURIComponent(key)}`),
  /** Rename (move) an R2 key inside content-files/. */
  renameR2Key:     (from: string, to: string)    => req<{ ok: boolean; from: string; to: string }>("/v1/admin/content/r2-rename", "POST", { from, to }),
  /** Create an "empty folder" by writing a `.keep` placeholder. */
  createR2Folder:  (path: string)                => req<{ ok: boolean; key: string }>("/v1/admin/content/r2-folder", "POST", { path }),
  /** Rebuild the manifest for one category (or "all"). */
  regenerateManifest: (category: string)         => req<{ ok: boolean; results: Record<string, string> }>("/v1/admin/content/regenerate-manifest", "POST", { category }),

  /** Look up the content_object (if any) that publishes to the given R2 key
   *  inside content-files/. Returns { found: false } if the key is loose. */
  lookupByR2Key:   (key: string)                 => req<{ found: boolean; object?: ContentObject }>(`/v1/admin/content/by-r2-key?key=${encodeURIComponent(key)}`),

  /** Promote a loose content-files/.../file.json (or .md) into a managed
   *  content_object. Returns the new (or existing) object id. Idempotent —
   *  calling adopt() twice on the same key returns the same id. */
  adoptR2Key:      (key: string, opts?: { contentType?: ContentType; title?: string; language?: string }) =>
                                                    req<{ id: string; r2KeyBase: string; status: string; adopted: boolean; alreadyExisted: boolean }>("/v1/admin/content/adopt", "POST", { key, ...opts }),

  // Review (admin only)
  pendingQueue:    ()                            => req<{ items: ContentObject[] }>("/v1/admin/content/pending"),
  getDiff:         (id: string)                  => req<{ pending: string | null; published: string | null }>(`/v1/admin/content/${id}/diff`),
  approveContent:  (id: string, targetPath?: string) =>
                                                    req<{ ok: boolean; status: string; hybridKeys: string[] }>(`/v1/admin/content/${id}/approve`, "POST", targetPath ? { targetPath } : {}),
  rejectContent:   (id: string, reason: string)  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/reject`, "POST", { reason }),
};

// ── Analytics API (admin only) ──────────────────────────────────────────────
//
// Reads the privacy-preserving performance & usage telemetry collected by the
// AnalyticsProvider and stored in D1 `analytics_events`. See
// `src/lib/osler/analytics.ts` for the collection contract and
// `cloudflare/worker/migrations/0012_analytics_events.sql` for the schema.

export type AnalyticsRange = "24h" | "7d" | "30d";

export interface AnalyticsOverview {
  range: AnalyticsRange;
  totalEvents: number;
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
