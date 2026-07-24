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
}

/** Extra fields returned only by GET /v1/admin/users/:id. */
export interface AdminUserDetail extends AdminUser {
  activeSessionCount: number;
  content: Array<{
    id: string;
    title: string | null;
    status: ContentStatus;
    contentType: ContentType;
    updatedAt: number;
  }>;
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

  // Session management (admin only)
  userSessions:    (id: string)                  => req<{ sessions: AdminSession[] }>(`/v1/admin/users/${id}/sessions`),
  revokeUserSessions: (id: string)               => req<{ ok: boolean }>(`/v1/admin/users/${id}/sessions`, "DELETE"),

  // Content (admin + content_admin)
  listContent:     (status: string, q?: string)  => req<{ items: ContentObject[]; total: number }>(`/v1/admin/content?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  getContent:      (id: string)                  => req<ContentObject>(`/v1/admin/content/${id}`),
  createContent:   (payload: { contentType: ContentType; title: string; language: string; content?: string }) =>
                                                    req<{ id: string; r2KeyBase: string; status: string }>("/v1/admin/content", "POST", payload),
  saveDraft:       (id: string, body: string)    => req<{ ok: boolean }>(`/v1/admin/content/${id}/draft`, "PUT", body),
  submitForReview: (id: string)                  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/submit`, "POST"),
  publishDirect:   (id: string)                  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/publish`, "POST"),
  unpublish:       (id: string)                  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/unpublish`, "POST"),
  deleteContent:   (id: string)                  => req<{ ok: boolean }>(`/v1/admin/content/${id}`, "DELETE"),

  // Review (admin only)
  pendingQueue:    ()                            => req<{ items: ContentObject[] }>("/v1/admin/content/pending"),
  getDiff:         (id: string)                  => req<{ pending: string | null; published: string | null }>(`/v1/admin/content/${id}/diff`),
  approveContent:  (id: string)                  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/approve`, "POST"),
  rejectContent:   (id: string, reason: string)  => req<{ ok: boolean; status: string }>(`/v1/admin/content/${id}/reject`, "POST", { reason }),
};
