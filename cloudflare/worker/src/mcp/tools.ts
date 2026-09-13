/**
 * Osler MCP tool registry — complete content-authoring and admin management surface.
 *
 * Supports two privilege tiers:
 *   1. 'content_admin': Create drafts, inspect all managed content, edit owned content, and submit it for review.
 *   2. 'admin': Full editing abilities — direct publishing, approvals/rejections, unpublishing,
 *      deletion, hotfixes, asset management, smart manifest sync, article metadata, and config updates.
 */

import type { McpEnv } from "./auth";
import { decodePdfInput, extractPdfPages } from "./pdf-text";
import { parseMcqText, parseWrittenText } from "./pdf-structure";

export interface McpLog {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** Everything a tool handler may touch — injected by the host worker. */
export interface McpCtx {
  env: McpEnv;
  userId: string;
  username: string;
  tokenId: string;
  scope: "admin" | "content_admin";
  log: McpLog;
  audit(action: string, targetId: string | null, detail: Record<string, unknown> | null): Promise<void>;
  getReviewQueue?(status?: string): Promise<any[]>;
  getInstanceStats?(): Promise<Record<string, number>>;
  getAuditTrail?(opts: { page?: number; limit?: number; action?: string }): Promise<{ items: any[]; total: number }>;
  getAnalyticsOverview?(days: number): Promise<Record<string, unknown>>;
  getJsErrors?(opts: { since: number; limit: number }): Promise<any[]>;
  readContentVersion?(): Promise<string | null>;
  r2Get(key: string): Promise<string | null>;
  r2Put(key: string, text: string | Uint8Array, contentType?: string): Promise<void>;
  r2Delete(key: string): Promise<void>;
  draftKey(base: string): string;
  pendingKey(base: string): string;
  publishedKey(base: string): string;
  validateContent(contentType: string, parsed: unknown): string[];
  publishObject?(objectId: string, targetPath?: string | null): Promise<{ ok: boolean; hybridKeys: string[] }>;
  unpublishObject?(objectId: string): Promise<{ ok: boolean }>;
  deleteObject?(objectId: string): Promise<{ ok: boolean }>;
  updateManifestIncremental?(category: string, touchedPaths?: string[]): Promise<any>;
  getConfig?(): Promise<any>;
  putConfig?(config: any): Promise<void>;
  uuid(): string;
}

/** Tool-logic failure surfaced to the agent as an isError tool result. */
export class ToolError extends Error {}

const CONTENT_TYPES = ["quiz", "bank", "written", "mixed", "flashcard", "osce", "library", "video"] as const;

// Draft/pack bodies are capped at 2 MB inline (create_content_draft,
// update_draft_body, create_content_pack). update_published_content and
// update_config previously had no size limit at all — an admin token (or a
// buggy agent driving one) could push an arbitrarily large payload into R2
// bounded only by the outer 30 MB RPC request cap. These get their own,
// slightly larger ceilings since hotfixed student files and full site
// configs are reasonably expected to be bigger than a single content draft.
const MAX_PUBLISHED_BODY_BYTES = 5_000_000;
const MAX_CONFIG_BYTES = 1_000_000;

const str = (description: string) => ({ type: "string", description });

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(ctx: McpCtx, args: any): Promise<unknown>;
}

// ─── Shared internals ────────────────────────────────────────────────────────

const now = () => Date.now();

function requireEnv(ctx: McpCtx) {
  if (!ctx.env.CONTENT) throw new ToolError("Content storage not configured on this instance");
  return ctx.env.CONTENT;
}

function requireAdmin(ctx: McpCtx, actionName: string = "This action") {
  if (ctx.scope !== "admin") {
    throw new ToolError(`${actionName} requires an API token with 'admin' privilege (current scope: '${ctx.scope}'). Mint an admin token from Settings → AI Agents.`);
  }
}

async function loadOwnedObject(ctx: McpCtx, id: unknown, allowPublished = false) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new ToolError("Valid object id required");
  const obj = await ctx.env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(id).first<any>();
  if (!obj) throw new ToolError("Content object not found");
  const isOwner = obj.created_by === ctx.userId;
  const isAdmin = ctx.scope === "admin";
  if (!isOwner && !isAdmin && !(allowPublished && obj.status === "published")) {
    throw new ToolError("Not authorized to access this content object");
  }
  return obj;
}

async function loadAccessibleObject(ctx: McpCtx, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new ToolError("Valid object id required");
  const obj = await ctx.env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(id).first<any>();
  if (!obj) throw new ToolError("Content object not found");
  return obj;
}

function checkType(contentType: unknown): string {
  if (typeof contentType !== "string" || !(CONTENT_TYPES as readonly string[]).includes(contentType as any)) {
    throw new ToolError(`Invalid contentType — one of ${CONTENT_TYPES.join(", ")}`);
  }
  return contentType;
}

function decodeDataUri(raw: string): { bytes: Uint8Array; mediaType: string } {
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    const meta = raw.slice(5, comma === -1 ? undefined : comma);
    return { bytes: decodeBase64(raw.slice(comma + 1)), mediaType: meta.split(";")[0] || "application/octet-stream" };
  }
  return { bytes: decodeBase64(raw), mediaType: "application/octet-stream" };
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw new ToolError("Invalid base64 payload");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extContentType(key: string, fallback: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    json: "application/json",
    md: "text/markdown; charset=utf-8",
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
  };
  return map[ext] ?? fallback;
}

function safeRelPath(input: unknown, imagesPrefix = true): string {
  let rel = typeof input === "string" ? input.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!rel || rel.includes("..") || rel.includes("\\")) throw new ToolError("Invalid asset path");
  if (!rel.includes("/") && imagesPrefix) rel = `images/${rel}`;
  return rel;
}

function sanitizeTargetPath(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const p = input.trim().replace(/^\/+|\/+$/g, "");
  if (!p || p.includes("..") || p.includes("\\")) throw new ToolError("Invalid targetPath");
  if (p.length > 200) throw new ToolError("targetPath too long");
  return p;
}

/**
 * Two-step confirmation for irreversible actions. An agent's first call comes
 * without `confirm: true` and receives the exact damage report plus a
 * continueToken; re-invoking with both proceeds. The token is deterministic
 * (not random) so it also validates that the agent re-read the warning — a
 * different token means the target changed between calls, which restarts the
 * flow and prevents acting on stale information.
 */
function confirmationToken(name: string, id: string): string {
  let hash = 2166136261;
  const input = `${name}:${id}:${id.length}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function requireConfirmation(ctx: McpCtx, toolName: string, id: string, args: any, summary: string): Promise<void> {
  if (args?.confirm === true && args?.continueToken === confirmationToken(toolName, id)) return;
  throw new ToolError(
    [
      `⚠️ DESTRUCTIVE ACTION — ${summary}`,
      "",
      "This cannot be undone. To proceed:",
      `1. Re-call \`${toolName}\` with "confirm": true`,
      `2. Include "continueToken": "${confirmationToken(toolName, id)}"`,
      "",
      "The continueToken proves you re-read this warning for THIS target; if the id changes, the token changes.",
    ].join("\n"),
  );
}

const draftTitle = (body: string): string | null => {
  try {
    const j = JSON.parse(body);
    return typeof j.title === "string" ? j.title.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
};

/** SHA-1 hex digest — used only as a change-detection fingerprint, never for security. */
async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Shared mutation cores ───────────────────────────────────────────────────
// Single-item tools and their bulk siblings both run through these, so the
// ownership checks, size caps, and audit entries can't drift apart. Bulk
// wrappers catch per-item ToolErrors and report them inline — one bad item
// never aborts the rest of the batch.

function checkDraftBody(body: unknown): string {
  if (typeof body !== "string" || !body || body.length > 2_000_000) {
    throw new ToolError("body must be a non-empty string up to 2 MB");
  }
  return body;
}

async function applyDraftBody(ctx: McpCtx, id: unknown, body: unknown) {
  const obj = await loadOwnedObject(ctx, id);
  if (obj.status === "pending" && ctx.scope !== "admin") {
    throw new ToolError("Object is pending review — ask an admin or use an admin-scoped token to reject it back to draft before editing");
  }
  const text = checkDraftBody(body);
  await ctx.r2Put(ctx.draftKey(obj.r2_key_base), text);
  const newTitle = draftTitle(text);
  await ctx.env.DB.prepare("UPDATE content_objects SET title = COALESCE(?, title), updated_at = ? WHERE id = ?")
    .bind(newTitle, now(), obj.id)
    .run();
  await ctx.audit("mcp_update_draft", obj.id, { title: newTitle, via: "mcp" });
  return { ok: true as const, id: obj.id, title: newTitle ?? obj.title };
}

async function submitPackForReview(ctx: McpCtx, id: unknown) {
  const obj = await loadOwnedObject(ctx, id);
  if (obj.status === "published") {
    throw new ToolError("Published objects cannot be submitted — unpublish to draft first");
  }
  const draft = await ctx.r2Get(ctx.draftKey(obj.r2_key_base));
  if (!draft) throw new ToolError("Draft is empty");
  await ctx.r2Put(ctx.pendingKey(obj.r2_key_base), draft);
  await ctx.env.DB.prepare("UPDATE content_objects SET status = 'pending', submitted_at = ?, reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL, updated_at = ? WHERE id = ?")
    .bind(now(), now(), obj.id)
    .run();
  await ctx.audit("mcp_submit_content", obj.id, { title: obj.title, via: "mcp" });
  return { ok: true as const, id: obj.id, status: "pending", note: "Awaiting approval." };
}

interface PackSpec {
  contentType?: unknown;
  title?: unknown;
  language?: unknown;
  body?: unknown;
  assets?: unknown;
  targetPath?: unknown;
  validateFirst?: unknown;
  submit?: unknown;
  publishImmediately?: unknown;
}

async function createPack(ctx: McpCtx, spec: PackSpec) {
  const bucket = requireEnv(ctx);
  const contentType = checkType(spec?.contentType);
  const title = typeof spec?.title === "string" ? spec.title.trim().slice(0, 200) : "";
  if (!title) throw new ToolError("title required");
  const body = checkDraftBody(spec?.body);
  const assets: any[] = Array.isArray(spec?.assets) ? spec.assets : [];
  if (assets.length > 50) throw new ToolError("At most 50 assets per batch pack");

  if (spec?.validateFirst && contentType !== "library") {
    let errors: string[] = [];
    try {
      errors = ctx.validateContent(contentType, JSON.parse(body));
    } catch (e: any) {
      errors = [`Invalid JSON: ${e.message}`];
    }
    if (errors.length) return { ok: false as const, stage: "validation", errors };
  }

  const objectId = ctx.uuid();
  const r2Base = `content/${contentType}/${objectId}`;
  const targetPath = sanitizeTargetPath(spec?.targetPath);
  await ctx.r2Put(ctx.draftKey(r2Base), body);
  try {
    await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, target_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)")
      .bind(objectId, r2Base, contentType, title, spec?.language === "ar" ? "ar" : "en", targetPath, ctx.userId, now(), now())
      .run();
  } catch {
    await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
      .bind(objectId, r2Base, contentType, title, spec?.language === "ar" ? "ar" : "en", ctx.userId, now(), now())
      .run();
  }

  const uploaded: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const asset of assets) {
    try {
      const rel = safeRelPath(asset?.path);
      const key = `${r2Base}/${rel}`;
      if (typeof asset?.dataUri === "string" && asset.dataUri) {
        const decoded = decodeDataUri(asset.dataUri);
        await bucket.put(key, decoded.bytes, { httpMetadata: { contentType: decoded.mediaType !== "application/octet-stream" ? decoded.mediaType : extContentType(rel, "application/octet-stream") } });
      } else if (typeof asset?.text === "string") {
        await bucket.put(key, asset.text, { httpMetadata: { contentType: extContentType(rel, "text/plain") } });
      } else {
        throw new ToolError("asset needs dataUri or text");
      }
      uploaded.push(key);
    } catch (e: any) {
      failed.push({ path: String(asset?.path ?? "?"), error: e instanceof ToolError ? e.message : String(e?.message ?? e) });
    }
  }

  let finalStatus = "draft";
  let hybridKeys: string[] = [];
  if (spec?.publishImmediately) {
    requireAdmin(ctx, "publishImmediately");
    if (ctx.publishObject) {
      const pub = await ctx.publishObject(objectId, targetPath);
      finalStatus = "published";
      hybridKeys = pub.hybridKeys;
    }
  } else if (spec?.submit && failed.length === 0) {
    await ctx.r2Put(ctx.pendingKey(r2Base), body);
    await ctx.env.DB.prepare("UPDATE content_objects SET status = 'pending', submitted_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), objectId).run();
    finalStatus = "pending";
  }

  await ctx.audit(finalStatus === "published" ? "mcp_publish_direct" : finalStatus === "pending" ? "mcp_submit_content" : "mcp_create_content", objectId, { title, contentType, targetPath, assets: uploaded.length, failed: failed.length, via: "mcp" });
  return {
    ok: failed.length === 0,
    id: objectId,
    r2KeyBase: r2Base,
    assetsUploaded: uploaded.length,
    failedAssets: failed,
    status: finalStatus,
    targetPath: targetPath ?? undefined,
    hybridKeys: hybridKeys.length ? hybridKeys : undefined,
  };
}

/** Run one batch item, converting a ToolError into an inline failure row. */
async function batchItem<T>(id: unknown, fn: () => Promise<T>): Promise<T | { ok: false; id: unknown; error: string }> {
  try {
    return await fn();
  } catch (e: any) {
    return { ok: false as const, id: typeof id === "string" ? id : undefined, error: e instanceof ToolError ? e.message : String(e?.message ?? e) };
  }
}

async function readAccessiblePack(ctx: McpCtx, id: unknown) {
  const obj = await loadAccessibleObject(ctx, id);
  let bodyKey = ctx.draftKey(obj.r2_key_base);
  if (obj.status === "published") bodyKey = ctx.publishedKey(obj.r2_key_base);
  else if (obj.status === "pending") bodyKey = ctx.pendingKey(obj.r2_key_base);
  const body = await ctx.r2Get(bodyKey);
  return { ...obj, body: body ?? null };
}

/** Cheap shape summary so agents can verify an upload landed whole
 *  ("did all 40 questions arrive?") without fetching full bodies. */
function summarizeContent(contentType: string, parsed: any): Record<string, number> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (contentType) {
    case "quiz": return { questions: len(parsed.questions) };
    case "bank": {
      const passages = Array.isArray(parsed.passages) ? parsed.passages : [];
      return { passages: passages.length, questions: passages.reduce((n: number, p: any) => n + len(p?.questions), 0) };
    }
    case "written": return { prompts: len(parsed.prompts) };
    case "mixed": return { questions: len(parsed.questions), prompts: len(parsed.prompts) };
    case "flashcard": return { cards: len(parsed.cards) };
    case "osce": return { stations: len(parsed.stations) };
    case "video": return { videos: len(parsed.videos) };
    default: return null;
  }
}

async function validateStoredPack(ctx: McpCtx, id: unknown) {
  const obj = await loadAccessibleObject(ctx, id);
  if (obj.content_type === "library") {
    return { ok: true as const, id: obj.id, title: obj.title, contentType: obj.content_type, valid: true, errors: [] as string[], counts: null };
  }
  const body = (await ctx.r2Get(ctx.draftKey(obj.r2_key_base))) ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e: any) {
    return { ok: true as const, id: obj.id, title: obj.title, contentType: obj.content_type, valid: false, errors: [`Invalid JSON: ${e.message}`], counts: null };
  }
  const errors = ctx.validateContent(obj.content_type, parsed);
  return { ok: true as const, id: obj.id, title: obj.title, contentType: obj.content_type, valid: errors.length === 0, errors, counts: summarizeContent(obj.content_type, parsed) };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  {
    name: "list_content_objects",
    description:
      "List managed content objects with id, type, title, status, and dates. Both admin tiers can inspect all users' objects; mineOnly narrows the result to your own.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "pending", "rejected", "published", "all"], description: "Filter by workflow status (default all)" },
        q: str("Title substring search"),
        mineOnly: { type: "boolean", description: "If true, only return objects created by your user" },
        page: { type: "number", description: "1-based page number" },
        limit: { type: "number", description: "Page size, 1-100 (default 50)" },
      },
    },
    async run(ctx, args) {
      const status = ["draft", "pending", "rejected", "published"].includes(args?.status) ? args.status : null;
      const like = typeof args?.q === "string" && args.q.trim() ? `%${args.q.trim()}%` : null;
      const limit = Math.min(100, Math.max(1, Number(args?.limit) || 50));
      const offset = (Math.max(1, Number(args?.page) || 1) - 1) * limit;
      const where: string[] = [];
      const params: unknown[] = [];

      if (args?.mineOnly) {
        where.push("co.created_by = ?");
        params.push(ctx.userId);
      }
      if (status) {
        where.push("co.status = ?");
        params.push(status);
      }

      if (like) {
        where.push("co.title LIKE ?");
        params.push(like);
      }
      const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
      const [rows, total] = await Promise.all([
        ctx.env.DB.prepare(`SELECT co.id, co.content_type, co.title, co.language, co.status, co.target_path, co.published_r2_key, co.created_by, co.created_at, co.updated_at, co.submitted_at, co.rejection_reason FROM content_objects co${whereSql} ORDER BY co.updated_at DESC LIMIT ? OFFSET ?`)
          .bind(...params, limit, offset)
          .all(),
        ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM content_objects co${whereSql}`)
          .bind(...params)
          .first<{ n: number }>(),
      ]);
      return { items: rows.results ?? [], total: total?.n ?? 0, page: Math.max(1, Number(args?.page) || 1), limit };
    },
  },
  {
    name: "get_content_object",
    description: "Fetch one managed content object by id — metadata plus its body (draft, pending, or published copy).",
    inputSchema: { type: "object", properties: { id: str("Content object id") }, required: ["id"] },
    async run(ctx, args) {
      return readAccessiblePack(ctx, args?.id);
    },
  },
  {
    name: "bulk_get_content_objects",
    description: "Fetch up to 50 managed content objects by id in one call (same view-all read access as get_content_object). Unknown ids fail inline without aborting the rest.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", description: "Content object ids. Max 50 per call.", items: { type: "string" } },
      },
      required: ["ids"],
    },
    async run(ctx, args) {
      const ids: unknown[] = Array.isArray(args?.ids) ? args.ids : [];
      if (!ids.length || ids.length > 50) throw new ToolError("ids must be an array of 1-50 content object ids");
      const results = [];
      for (const id of ids) {
        results.push(await batchItem(id, () => readAccessiblePack(ctx, id)));
      }
      const succeeded = results.filter((r: any) => !(r as any).error).length;
      return { total: results.length, succeeded, failed: results.length - succeeded, results };
    },
  },
  {
    name: "create_content_draft",
    description: "Create a new draft content object. (Prefer create_content_pack for new packs with assets).",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Engine type of the pack" },
        title: str("Display title (folder-name convention)"),
        language: str('"en" or "ar"'),
        content: str("Optional initial JSON/markdown body"),
        targetPath: str('Optional subfolder path inside the category (e.g. "cardiology/acute-coronary")'),
      },
      required: ["contentType"],
    },
    async run(ctx, args) {
      requireEnv(ctx);
      const contentType = checkType(args?.contentType);
      const objectId = ctx.uuid();
      const r2Base = `content/${contentType}/${objectId}`;
      const title = typeof args?.title === "string" ? args.title.trim().slice(0, 200) : null;
      const initial = typeof args?.content === "string" && args.content.length <= 2_000_000 ? args.content : JSON.stringify({ title: title || "Untitled" }, null, 2);
      const targetPath = sanitizeTargetPath(args?.targetPath);
      await ctx.r2Put(ctx.draftKey(r2Base), initial);
      try {
        await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, target_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)")
          .bind(objectId, r2Base, contentType, title, args?.language === "ar" ? "ar" : "en", targetPath, ctx.userId, now(), now())
          .run();
      } catch {
        await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
          .bind(objectId, r2Base, contentType, title, args?.language === "ar" ? "ar" : "en", ctx.userId, now(), now())
          .run();
      }
      await ctx.audit("mcp_create_content", objectId, { title, contentType, targetPath, via: "mcp" });
      return { id: objectId, r2KeyBase: r2Base, status: "draft", targetPath: targetPath ?? undefined };
    },
  },
  {
    name: "update_draft_body",
    description: "Replace the draft body of a content object (JSON or markdown/html). Max 2 MB.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), body: str("Full replacement body") },
      required: ["id", "body"],
    },
    async run(ctx, args) {
      return applyDraftBody(ctx, args?.id, args?.body);
    },
  },
  {
    name: "bulk_update_draft_bodies",
    description: "Replace the draft bodies of up to 20 content objects in one call (same ownership rules and 2 MB cap per item as update_draft_body). One bad item fails inline without aborting the rest.",
    inputSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          description: "Items to update: { id, body }. Max 20 per call.",
          items: {
            type: "object",
            properties: { id: str("Content object id"), body: str("Full replacement body") },
            required: ["id", "body"],
          },
        },
      },
      required: ["updates"],
    },
    async run(ctx, args) {
      const updates: unknown[] = Array.isArray(args?.updates) ? args.updates : [];
      if (!updates.length || updates.length > 20) throw new ToolError("updates must be an array of 1-20 { id, body } items");
      const results = [];
      for (const u of updates) {
        results.push(await batchItem((u as any)?.id, () => applyDraftBody(ctx, (u as any)?.id, (u as any)?.body)));
      }
      const succeeded = results.filter((r: any) => r.ok !== false).length;
      return { total: results.length, succeeded, failed: results.length - succeeded, results };
    },
  },
  {
    name: "upload_asset",
    description: "Upload one asset file (image, audio, diagram) into a content pack. Send binary data as base64 data URI.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Content object id"),
        path: str('Relative path inside the pack, e.g. "diagram.png" or "images/fig-1.png"'),
        dataUri: str("data:<mime>;base64,<...> payload for binary assets"),
        text: str("Plain-text alternative for textual assets"),
      },
      required: ["id", "path"],
    },
    async run(ctx, args) {
      const bucket = requireEnv(ctx);
      const obj = await loadOwnedObject(ctx, args?.id);
      const rel = safeRelPath(args?.path);
      const key = `${obj.r2_key_base}/${rel}`;
      let payload: Uint8Array | string;
      let contentType: string;
      if (typeof args?.dataUri === "string" && args.dataUri) {
        const decoded = decodeDataUri(args.dataUri);
        payload = decoded.bytes;
        contentType = decoded.mediaType !== "application/octet-stream" ? decoded.mediaType : extContentType(rel, "application/octet-stream");
      } else if (typeof args?.text === "string") {
        payload = args.text;
        contentType = extContentType(rel, "text/plain");
      } else {
        throw new ToolError("Provide dataUri or text");
      }
      await bucket.put(key, payload, { httpMetadata: { contentType } });
      await ctx.env.DB.prepare("UPDATE content_objects SET updated_at = ? WHERE id = ?").bind(now(), obj.id).run();
      await ctx.audit("mcp_upload_asset", obj.id, { key, via: "mcp" });
      return { ok: true, key, relPath: rel };
    },
  },
  {
    name: "delete_asset",
    description: "Delete an asset file from a content pack's storage.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Content object id"),
        path: str('Relative asset path inside the pack (e.g. "images/fig-1.png")'),
      },
      required: ["id", "path"],
    },
    async run(ctx, args) {
      const obj = await loadOwnedObject(ctx, args?.id);
      const rel = safeRelPath(args?.path, false);
      const key = `${obj.r2_key_base}/${rel}`;
      await ctx.r2Delete(key);
      await ctx.env.DB.prepare("UPDATE content_objects SET updated_at = ? WHERE id = ?").bind(now(), obj.id).run();
      await ctx.audit("mcp_delete_asset", obj.id, { key, via: "mcp" });
      return { ok: true, deletedKey: key };
    },
  },
  {
    name: "validate_content",
    description: "Run schema validation over a JSON body. Supports all 7 engine types.",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Required when no id is given" },
        id: str("Validate stored draft of this object"),
        body: str("Inline JSON body to validate"),
      },
    },
    async run(ctx, args) {
      let contentType: string;
      let body: string | null;
      if (args?.id) {
        const obj = await loadAccessibleObject(ctx, args.id);
        contentType = obj.content_type;
        body = (await ctx.r2Get(ctx.draftKey(obj.r2_key_base))) ?? "";
      } else {
        contentType = checkType(args?.contentType);
        body = typeof args?.body === "string" ? args.body : null;
        if (body == null) throw new ToolError("Provide id or body");
      }
      if (contentType === "library") return { errors: [], valid: true };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body!);
      } catch (e: any) {
        return { errors: [`Invalid JSON: ${e.message}`], valid: false };
      }
      const errors = ctx.validateContent(contentType, parsed);
      return { errors, valid: errors.length === 0 };
    },
  },
  {
    name: "bulk_validate",
    description: "Validate up to 20 stored drafts by id in one call, with per-pack content counts (questions/cards/stations/…) so agents can QA-sweep an upload batch without fetching full bodies. Unknown ids fail inline without aborting the rest.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", description: "Content object ids. Max 20 per call.", items: { type: "string" } },
      },
      required: ["ids"],
    },
    async run(ctx, args) {
      const ids: unknown[] = Array.isArray(args?.ids) ? args.ids : [];
      if (!ids.length || ids.length > 20) throw new ToolError("ids must be an array of 1-20 content object ids");
      const results = [];
      for (const id of ids) {
        results.push(await batchItem(id, () => validateStoredPack(ctx, id)));
      }
      const rows = results as any[];
      const valid = rows.filter((r) => r.ok !== false && r.valid).length;
      return { total: rows.length, valid, invalid: rows.length - valid, results };
    },
  },
  {
    name: "parse_pdf",
    description:
      "Extract text from a PDF you supply inline (base64 or data URI), page by page. Use it to read exam papers, lecture notes or question lists before authoring. For structured import of MCQs or written questions prefer parse_qbank_pdf / parse_written_pdf.",
    inputSchema: {
      type: "object",
      properties: {
        pdfDataUri: str("The PDF as a data URI (data:application/pdf;base64,…) or raw base64. Max 20 MB."),
        maxPages: { type: "number", description: "Optional page cap (default 120)" },
      },
      required: ["pdfDataUri"],
    },
    async run(_ctx, args) {
      const bytes = decodePdfInput(String(args?.pdfDataUri ?? ""));
      const maxPages = Math.min(400, Math.max(1, Number(args?.maxPages) || 120));
      const result = await extractPdfPages(bytes, maxPages);
      const likelyScanned = result.pages.every((p) => !p.trim());
      return {
        pageCount: result.pageCount,
        truncated: result.truncated,
        likelyScanned,
        ...(likelyScanned
          ? { note: "No text layer detected — the PDF is probably scanned images. OCR is not available; transcribe the content yourself from the source." }
          : {}),
        pages: result.pages.map((text, i) => ({ page: i + 1, text })),
      };
    },
  },
  {
    name: "parse_qbank_pdf",
    description:
      "Parse an exam-style PDF (base64/data URI) into a draft Osler QBank pack. Detects numbered questions, A–E options, answer keys (inline 'Answer: B' lines or a trailing key table) and explanations. Returns a draft { questions: [...] } plus warnings — review flagged items, then validate with contentType 'quiz' and upload via create_content_pack.",
    inputSchema: {
      type: "object",
      properties: {
        pdfDataUri: str("The PDF as a data URI (data:application/pdf;base64,…) or raw base64. Max 20 MB."),
        maxPages: { type: "number", description: "Optional page cap (default 120)" },
      },
      required: ["pdfDataUri"],
    },
    async run(_ctx, args) {
      const bytes = decodePdfInput(String(args?.pdfDataUri ?? ""));
      const maxPages = Math.min(400, Math.max(1, Number(args?.maxPages) || 120));
      const result = await extractPdfPages(bytes, maxPages);
      const parsed = parseMcqText(result.pages);
      return {
        pageCount: result.pageCount,
        truncated: result.truncated,
        detected: parsed.stats,
        warnings: parsed.warnings,
        draft: { questions: parsed.questions },
        nextSteps:
          "Questions missing 'correct' (see warnings) must be resolved before upload. Verify stems/options against the source, add difficulty and tags, then call validate_content (contentType 'quiz') and upload with create_content_pack.",
      };
    },
  },
  {
    name: "parse_written_pdf",
    description:
      "Parse a written-exam PDF (base64/data URI) into a draft Osler Written pack. Detects numbered prompts, marks annotations like '(10 marks)', model-answer sections and marking schemes. Returns a draft { prompts: [...] } plus warnings — review flagged items, then validate with contentType 'written' and upload via create_content_pack.",
    inputSchema: {
      type: "object",
      properties: {
        pdfDataUri: str("The PDF as a data URI (data:application/pdf;base64,…) or raw base64. Max 20 MB."),
        maxPages: { type: "number", description: "Optional page cap (default 120)" },
      },
      required: ["pdfDataUri"],
    },
    async run(_ctx, args) {
      const bytes = decodePdfInput(String(args?.pdfDataUri ?? ""));
      const maxPages = Math.min(400, Math.max(1, Number(args?.maxPages) || 120));
      const result = await extractPdfPages(bytes, maxPages);
      const parsed = parseWrittenText(result.pages);
      return {
        pageCount: result.pageCount,
        truncated: result.truncated,
        detected: parsed.stats,
        warnings: parsed.warnings,
        draft: { prompts: parsed.prompts },
        nextSteps:
          "Default rubrics (single criterion) should be replaced with graded marking schemes where possible. Verify prompts against the source, then call validate_content (contentType 'written') and upload with create_content_pack.",
      };
    },
  },
  {
    name: "submit_for_review",
    description: "Submit a draft for admin review: snapshots draft to pending candidate queue.",
    inputSchema: { type: "object", properties: { id: str("Content object id") }, required: ["id"] },
    async run(ctx, args) {
      return submitPackForReview(ctx, args?.id);
    },
  },
  {
    name: "bulk_submit_for_review",
    description: "Submit up to 20 owned drafts for admin review in one call (same ownership and published guards as submit_for_review). One bad item fails inline without aborting the rest.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", description: "Content object ids. Max 20 per call.", items: { type: "string" } },
      },
      required: ["ids"],
    },
    async run(ctx, args) {
      const ids: unknown[] = Array.isArray(args?.ids) ? args.ids : [];
      if (!ids.length || ids.length > 20) throw new ToolError("ids must be an array of 1-20 content object ids");
      const results = [];
      for (const id of ids) {
        results.push(await batchItem(id, () => submitPackForReview(ctx, id)));
      }
      const succeeded = results.filter((r: any) => r.ok !== false).length;
      return { total: results.length, succeeded, failed: results.length - succeeded, results };
    },
  },
  {
    name: "read_content_file",
    description:
      "Read a published student-facing file or manifest from R2. Returns the raw body plus bodySha1 — pass that SHA-1 as expectedCurrentBody when later hotfixing the file with update_published_content so a concurrent edit can't be silently overwritten.",
    inputSchema: { type: "object", properties: { key: str('R2 key, e.g. "content-files/qbank/cardiology/ecg/questions.json"') }, required: ["key"] },
    async run(ctx, args) {
      const bucket = requireEnv(ctx);
      const key = typeof args?.key === "string" ? args.key.trim() : "";
      const allowed = key.startsWith("content-files/") || key.startsWith("content-manifests/");
      if (!allowed || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
        throw new ToolError("Only content-files/ and content-manifests/ keys can be read");
      }
      const obj = await bucket.get(key);
      if (!obj) throw new ToolError("Key not found");
      const body = await obj.text();
      return { key, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream", size: body.length, bodySha1: await sha1Hex(body), body };
    },
  },
  {
    name: "list_content_files",
    description: "List student-facing content keys under content-files/ (optionally filtered by category prefix).",
    inputSchema: {
      type: "object",
      properties: {
        prefix: str('Category prefix after "content-files/", e.g. "qbank/" or "library/cardiology"'),
        cursor: str("Pagination cursor"),
      },
    },
    async run(ctx, args) {
      const bucket = requireEnv(ctx);
      const prefix = typeof args?.prefix === "string" ? args.prefix.replace(/^\/+/, "") : "";
      if (prefix.includes("..") || prefix.includes("\\")) throw new ToolError("Invalid prefix");
      const listed = await bucket.list({ prefix: `content-files/${prefix}`, limit: 1000, cursor: typeof args?.cursor === "string" && args.cursor ? args.cursor : undefined });
      return {
        items: (listed.objects ?? []).map((o) => ({ key: o.key, size: o.size })),
        cursor: listed.truncated ? listed.cursor : null,
      };
    },
  },
  {
    name: "create_content_pack",
    description: "One-call batch upload: creates draft, writes body, uploads all assets (data URIs), optionally validates, and optionally submits/publishes.",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Engine type of the pack" },
        title: str("Display title"),
        language: str('"en" or "ar"'),
        body: str("Main JSON/markdown body (max 2 MB)"),
        assets: {
          type: "array",
          description: 'Asset files. Each: { "path": "images/fig-1.png", "dataUri": "data:image/png;base64,..." }',
          items: {
            type: "object",
            properties: { path: str("Relative path"), dataUri: str("Data URI for binary"), text: str("Plain-text") },
            required: ["path"],
          },
        },
        targetPath: str('Optional subfolder path inside the category (e.g. "cardiology/acute-coronary")'),
        validateFirst: { type: "boolean", description: "Validate body before writing" },
        submit: { type: "boolean", description: "Submit for review after upload" },
        publishImmediately: { type: "boolean", description: "Directly publish to student files (admin scope only)" },
      },
      required: ["contentType", "title", "body"],
    },
    async run(ctx, args) {
      return createPack(ctx, args ?? {});
    },
  },
  {
    name: "bulk_create_content_packs",
    description: "Create up to 10 content packs in one call (same per-pack validation, asset caps, and submit/publish rules as create_content_pack). One bad pack fails inline without aborting the rest.",
    inputSchema: {
      type: "object",
      properties: {
        packs: {
          type: "array",
          description: "Pack specs: { contentType, title, body, language?, assets?, targetPath?, validateFirst?, submit?, publishImmediately? (admin only) }. Max 10 per call.",
          items: {
            type: "object",
            properties: {
              contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Engine type of the pack" },
              title: str("Display title"),
              language: str('"en" or "ar"'),
              body: str("Main JSON/markdown body (max 2 MB)"),
              assets: {
                type: "array",
                description: "Asset files (max 50 per pack)",
                items: {
                  type: "object",
                  properties: { path: str("Relative path"), dataUri: str("Data URI for binary"), text: str("Plain-text") },
                  required: ["path"],
                },
              },
              targetPath: str("Optional subfolder path inside the category"),
              validateFirst: { type: "boolean", description: "Validate body before writing" },
              submit: { type: "boolean", description: "Submit for review after upload" },
              publishImmediately: { type: "boolean", description: "Directly publish (admin scope only)" },
            },
            required: ["contentType", "title", "body"],
          },
        },
      },
      required: ["packs"],
    },
    async run(ctx, args) {
      const packs: unknown[] = Array.isArray(args?.packs) ? args.packs : [];
      if (!packs.length || packs.length > 10) throw new ToolError("packs must be an array of 1-10 pack specs");
      const results = [];
      for (const pack of packs) {
        results.push(await batchItem((pack as any)?.title, () => createPack(ctx, (pack ?? {}) as PackSpec)));
      }
      const succeeded = results.filter((r: any) => r.ok !== false).length;
      return { total: results.length, succeeded, failed: results.length - succeeded, results };
    },
  },

  {
    name: "duplicate_content_object",
    description: "Clone any readable pack into a new draft you own (remix workflow: adapt a published pack and submit it as new). Copies the current body plus pack assets; the clone always starts as your unsubmitted draft.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Source content object id"),
        title: str('Title for the clone (default "Copy of <source title>")'),
      },
      required: ["id"],
    },
    async run(ctx, args) {
      const bucket = requireEnv(ctx);
      const src = await readAccessiblePack(ctx, args?.id) as any;
      if (!src.body) throw new ToolError("Source has no readable body to duplicate");
      const title = (typeof args?.title === "string" && args.title.trim() ? args.title.trim() : `Copy of ${src.title ?? "untitled"}`).slice(0, 200);
      const objectId = ctx.uuid();
      const r2Base = `content/${src.content_type}/${objectId}`;
      await ctx.r2Put(ctx.draftKey(r2Base), src.body);
      const insert = "INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)";
      await ctx.env.DB.prepare(insert).bind(objectId, r2Base, src.content_type, title, src.language === "ar" ? "ar" : "en", ctx.userId, now(), now()).run();

      // Copy pack assets (images/…), skipping the workflow slot files.
      let assetsCopied = 0;
      const failedAssets: { path: string; error: string }[] = [];
      let cursor: string | undefined = undefined;
      for (let page = 0; page < 10; page++) {
        const listed: any = await bucket.list({ prefix: `${src.r2_key_base}/`, limit: 100, cursor });
        for (const o of listed.objects ?? []) {
          const rel = String(o.key ?? "").slice(String(src.r2_key_base).length + 1);
          if (!rel || rel === "draft.json" || rel === "pending.json" || rel === "published.json") continue;
          try {
            const got = await bucket.get(o.key);
            if (!got) throw new ToolError("asset vanished mid-copy");
            await bucket.put(`${r2Base}/${rel}`, await got.arrayBuffer(), { httpMetadata: { contentType: (got as any).httpMetadata?.contentType } });
            assetsCopied++;
          } catch (e: any) {
            failedAssets.push({ path: rel, error: e instanceof ToolError ? e.message : String(e?.message ?? e) });
          }
        }
        if (!listed.truncated) break;
        cursor = listed.cursor;
        if (!cursor) break;
      }

      await ctx.audit("mcp_duplicate_content", objectId, { sourceId: src.id, title, assetsCopied, failed: failedAssets.length, via: "mcp" });
      return { ok: failedAssets.length === 0, id: objectId, title, sourceId: src.id, assetsCopied, failedAssets, status: "draft" };
    },
  },

  // ─── Full Admin Privileged Tools ──────────────────────────────────────────

  {
    name: "publish_content",
    description: "Directly publish a draft or pending content object to student files and trigger smart manifest sync. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Content object id"),
        targetPath: str('Optional destination path inside category (e.g. "cardiology/acute-coronary")'),
      },
      required: ["id"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "publish_content");
      if (!ctx.publishObject) throw new ToolError("Host publishObject not wired");
      const obj = await loadOwnedObject(ctx, args?.id, true);
      const targetPath = sanitizeTargetPath(args?.targetPath) ?? obj.target_path ?? null;
      const res = await ctx.publishObject(obj.id, targetPath);
      await ctx.audit("mcp_publish_content", obj.id, { title: obj.title, hybridKeys: res.hybridKeys, via: "mcp" });
      return { ok: true, status: "published", hybridKeys: res.hybridKeys };
    },
  },
  {
    name: "approve_content",
    description: "Approve a pending content object from review queue and publish to student files with smart manifest sync. (Admin only).",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), targetPath: str("Optional target path override") },
      required: ["id"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "approve_content");
      const obj = await loadOwnedObject(ctx, args?.id, true);
      if (obj.status !== "pending") throw new ToolError(`Object status is '${obj.status}', expected 'pending'`);
      if (!ctx.publishObject) throw new ToolError("Host publishObject not wired");
      const targetPath = sanitizeTargetPath(args?.targetPath) ?? obj.target_path ?? null;
      const res = await ctx.publishObject(obj.id, targetPath);
      await ctx.audit("mcp_approve_content", obj.id, { title: obj.title, hybridKeys: res.hybridKeys, via: "mcp" });
      return { ok: true, status: "published", hybridKeys: res.hybridKeys };
    },
  },
  {
    name: "reject_content",
    description: "Reject a pending content object back to draft with a feedback reason. (Admin only).",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), reason: str("Feedback / reason for rejection") },
      required: ["id", "reason"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "reject_content");
      const obj = await loadOwnedObject(ctx, args?.id, true);
      const reason = typeof args?.reason === "string" ? args.reason.trim().slice(0, 1000) : "";
      await ctx.env.DB.prepare("UPDATE content_objects SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?")
        .bind(ctx.userId, now(), reason || null, now(), obj.id)
        .run();
      await ctx.audit("mcp_reject_content", obj.id, { title: obj.title, reason, via: "mcp" });
      return { ok: true, status: "rejected", reason };
    },
  },
  {
    name: "unpublish_content",
    description: "Retract a published object back to draft, remove student-facing files, and update manifests. (Admin only).",
    inputSchema: { type: "object", properties: { id: str("Content object id") }, required: ["id"] },
    async run(ctx, args) {
      requireAdmin(ctx, "unpublish_content");
      const obj = await loadOwnedObject(ctx, args?.id, true);
      if (ctx.unpublishObject) {
        await ctx.unpublishObject(obj.id);
      } else {
        const staleKey = obj.published_r2_key;
        if (staleKey) await ctx.r2Delete(staleKey).catch(() => {});
        await ctx.env.DB.prepare("UPDATE content_objects SET status = 'draft', published_r2_key = NULL, updated_at = ? WHERE id = ?").bind(now(), obj.id).run();
      }
      await ctx.audit("mcp_unpublish_content", obj.id, { title: obj.title, via: "mcp" });
      return { ok: true, status: "draft" };
    },
  },
  {
    name: "delete_content_object",
    description:
      "Permanently delete a content object, its R2 storage files, and prune student manifests. IRREVERSIBLE — requires two-step confirm (call once without confirm to get the damage report + continueToken, then re-call with confirm:true). (Admin or draft owner).",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Content object id"),
        confirm: { type: "boolean", description: "Set true on the second call, together with continueToken, to actually delete" },
        continueToken: str("Token from the first call's warning message"),
      },
      required: ["id"],
    },
    async run(ctx, args) {
      const obj = await loadOwnedObject(ctx, args?.id, true);
      if (obj.status === "published" && ctx.scope !== "admin") {
        throw new ToolError("Deleting published content requires admin privilege");
      }
      await requireConfirmation(
        ctx,
        "delete_content_object",
        obj.id,
        args,
        `Permanently delete content object "${obj.title ?? obj.id}" (${obj.content_type}, status: ${obj.status}) and every stored file${obj.published_r2_key ? `, including the student-facing ${obj.published_r2_key}` : ""}. Student manifests will be pruned.`,
      );
      if (ctx.deleteObject) {
        await ctx.deleteObject(obj.id);
      } else {
        const pubKey = obj.published_r2_key;
        if (pubKey) await ctx.r2Delete(pubKey).catch(() => {});
        await ctx.env.DB.prepare("DELETE FROM content_objects WHERE id = ?").bind(obj.id).run();
      }
      await ctx.audit("mcp_delete_object", obj.id, { title: obj.title, via: "mcp" });
      return { ok: true, deletedId: obj.id };
    },
  },
  {
    name: "update_published_content",
    description:
      "Directly hotfix a student-facing published file (e.g. 'content-files/qbank/Cardiology/questions.json') and trigger smart manifest sync. Bypasses the draft→review pipeline — read the current file first (read_content_file) and verify your edit with validate_content. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        key: str('Published R2 key under content-files/, e.g. "content-files/qbank/cardiology/questions.json"'),
        body: str("New text / JSON / markdown content"),
        expectedCurrentBody: str("Safety guard: the SHA-1 of the file's current body. The write is refused if it changed since you read it — re-read and redo your edit. Send the literal string returned by read_content_file's bodySha1 field"),
      },
      required: ["key", "body"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "update_published_content");
      const key = typeof args?.key === "string" ? args.key.trim() : "";
      if (!key.startsWith("content-files/") || key.includes("..") || key.includes("\\")) {
        throw new ToolError("Key must start with 'content-files/'");
      }
      if (typeof args.body !== "string" || !args.body || args.body.length > MAX_PUBLISHED_BODY_BYTES) {
        throw new ToolError(`body must be a non-empty string up to ${MAX_PUBLISHED_BODY_BYTES / 1_000_000} MB`);
      }

      // Optimistic-concurrency guard: the hotfix is a blind overwrite of a
      // live student file. If the agent read the file a while ago and someone
      // else edited it since, applying the stale-based diff would silently
      // revert their work. Refusing on mismatch forces a fresh read.
      if (typeof args?.expectedCurrentBody === "string" && args.expectedCurrentBody) {
        const current = await ctx.r2Get(key);
        const currentSha = current == null ? null : await sha1Hex(current);
        if (currentSha !== args.expectedCurrentBody) {
          throw new ToolError(
            `The published file changed since you last read it (expected SHA-1 ${args.expectedCurrentBody.slice(0, 12)}…, found ${currentSha == null ? "<deleted>" : currentSha.slice(0, 12)}…). Re-read the file with read_content_file and re-apply your edit on the fresh copy.`,
          );
        }
      }

      const ct = extContentType(key, "application/json");
      await ctx.r2Put(key, args.body, ct);

      // Trigger smart incremental manifest update
      const rel = key.slice("content-files/".length);
      const category = rel.split("/")[0];
      const folderPath = rel.includes("/") ? rel.slice(category.length + 1, rel.lastIndexOf("/")) : "";
      if (ctx.updateManifestIncremental && category) {
        try {
          await ctx.updateManifestIncremental(category, folderPath ? [folderPath] : undefined);
        } catch (e: any) {
          ctx.log.warn("incremental manifest update error", { error: e.message });
        }
      }
      await ctx.audit("mcp_update_published_file", null, { key, size: args.body.length, via: "mcp" });
      return { ok: true, key, size: args.body.length };
    },
  },
  {
    name: "get_content_manifest",
    description: "Fetch the category manifest tree (e.g. qbank, flashcard, osce, library, videos).",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["qbank", "flashcard", "osce", "library", "videos"], description: "Content category" },
      },
      required: ["category"],
    },
    async run(ctx, args) {
      const cat = typeof args?.category === "string" ? args.category.trim() : "";
      if (!cat) throw new ToolError("category required");
      const raw = await ctx.r2Get(`content-manifests/${cat}/manifest.json`);
      if (!raw) return { category: cat, exists: false, nodes: [] };
      try {
        return { category: cat, exists: true, nodes: JSON.parse(raw) };
      } catch {
        return { category: cat, exists: true, raw };
      }
    },
  },
  {
    name: "smart_update_manifest",
    description: "Trigger smart incremental diff update for a category's manifest. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["qbank", "flashcard", "osce", "library", "videos", "all"], description: "Category to update" },
        touchedPaths: { type: "array", items: { type: "string" }, description: "Optional specific folder paths that changed" },
      },
      required: ["category"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "smart_update_manifest");
      const cat = typeof args?.category === "string" ? args.category.trim() : "";
      const paths = Array.isArray(args?.touchedPaths) ? args.touchedPaths.map(String) : undefined;
      const categories = cat === "all" ? ["qbank", "flashcard", "osce", "library", "videos"] : [cat];
      const results: Record<string, any> = {};
      for (const c of categories) {
        if (ctx.updateManifestIncremental) {
          results[c] = await ctx.updateManifestIncremental(c, paths);
        } else {
          results[c] = "Host incremental updater not wired";
        }
      }
      await ctx.audit("mcp_smart_manifest_update", null, { category: cat, paths, via: "mcp" });
      return { ok: true, results };
    },
  },
  {
    name: "get_article_details",
    description: "Fetch a library article text body along with its sidecar metadata (<basename>.meta.json).",
    inputSchema: {
      type: "object",
      properties: {
        path: str('Relative article path from library, e.g. "pulmonology/asthma.md" or "cardiology/stemi.html"'),
      },
      required: ["path"],
    },
    async run(ctx, args) {
      const rel = typeof args?.path === "string" ? args.path.replace(/^\/+/, "") : "";
      if (!rel || rel.includes("..") || rel.includes("\\")) throw new ToolError("Invalid article path");
      const fileKey = `content-files/library/${rel}`;
      const slash = rel.lastIndexOf("/");
      const dir = slash >= 0 ? rel.slice(0, slash + 1) : "";
      const base = slash >= 0 ? rel.slice(slash + 1) : rel;
      const dot = base.lastIndexOf(".");
      const sidecarKey = `content-files/library/${dir}${dot > 0 ? base.slice(0, dot) : base}.meta.json`;

      const [body, sidecarRaw] = await Promise.all([ctx.r2Get(fileKey), ctx.r2Get(sidecarKey)]);
      if (body == null) throw new ToolError(`Article file '${rel}' not found`);
      let sidecarMeta: any = null;
      if (sidecarRaw) {
        try {
          sidecarMeta = JSON.parse(sidecarRaw);
        } catch {}
      }
      return { path: rel, fileKey, body, sidecarKey, sidecarMeta };
    },
  },
  {
    name: "update_article_metadata",
    description: "Update the sidecar metadata (<basename>.meta.json) for a library article without touching the body. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        path: str('Relative article path, e.g. "pulmonology/asthma.md"'),
        title: str("Article title"),
        specialty: str("Medical specialty (e.g. Pulmonology)"),
        system: str("Body system (e.g. Respiratory)"),
        readTimeMin: { type: "number", description: "Estimated read time in minutes" },
        tags: { type: "array", items: { type: "string" }, description: "Search tags" },
        lang: { type: "string", enum: ["en", "ar"], description: "Language code" },
      },
      required: ["path"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "update_article_metadata");
      const rel = typeof args?.path === "string" ? args.path.replace(/^\/+/, "") : "";
      if (!rel || rel.includes("..") || rel.includes("\\")) throw new ToolError("Invalid article path");
      const slash = rel.lastIndexOf("/");
      const dir = slash >= 0 ? rel.slice(0, slash + 1) : "";
      const base = slash >= 0 ? rel.slice(slash + 1) : rel;
      const dot = base.lastIndexOf(".");
      const sidecarKey = `content-files/library/${dir}${dot > 0 ? base.slice(0, dot) : base}.meta.json`;

      const existingRaw = await ctx.r2Get(sidecarKey);
      let meta: Record<string, any> = {};
      if (existingRaw) {
        try {
          meta = JSON.parse(existingRaw);
        } catch {}
      }
      if (args.title !== undefined) meta.title = String(args.title).trim();
      if (args.specialty !== undefined) meta.specialty = String(args.specialty).trim();
      if (args.system !== undefined) meta.system = String(args.system).trim();
      if (args.readTimeMin !== undefined) meta.readTimeMin = Math.max(1, Number(args.readTimeMin) || 5);
      if (Array.isArray(args.tags)) meta.tags = args.tags.map(String).filter(Boolean);
      if (args.lang === "en" || args.lang === "ar") meta.lang = args.lang;

      const payload = JSON.stringify(meta, null, 2);
      await ctx.r2Put(sidecarKey, payload, "application/json");

      // Auto-trigger incremental manifest update
      if (ctx.updateManifestIncremental) {
        try {
          await ctx.updateManifestIncremental("library", dir ? [dir.replace(/\/$/, "")] : undefined);
        } catch {}
      }
      await ctx.audit("mcp_update_article_metadata", null, { path: rel, sidecarKey, meta, via: "mcp" });
      return { ok: true, sidecarKey, meta };
    },
  },
  {
    name: "search_content",
    description: "Search managed content objects by title, keywords, or status. Both admin tiers can inspect all users' objects.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Search term"),
        contentType: { type: "string", enum: [...CONTENT_TYPES] },
        status: { type: "string", enum: ["draft", "pending", "published", "all"] },
      },
      required: ["query"],
    },
    async run(ctx, args) {
      const q = typeof args?.query === "string" ? args.query.trim() : "";
      if (!q) throw new ToolError("query required");
      const like = `%${q}%`;
      const params: any[] = [like];
      let sql = "SELECT id, content_type, title, language, status, target_path, published_r2_key, created_at, updated_at FROM content_objects WHERE title LIKE ?";
      if (args.contentType) {
        sql += " AND content_type = ?";
        params.push(args.contentType);
      }
      if (args.status && args.status !== "all") {
        sql += " AND status = ?";
        params.push(args.status);
      }
      sql += " ORDER BY updated_at DESC LIMIT 50";
      const rows = await ctx.env.DB.prepare(sql).bind(...params).all();
      return { query: q, count: rows.results?.length ?? 0, items: rows.results ?? [] };
    },
  },
  {
    name: "read_config",
    description: "Read the current platform site configuration (_osler.config.json). (Admin only).",
    inputSchema: { type: "object", properties: {} },
    async run(ctx) {
      requireAdmin(ctx, "read_config");
      if (ctx.getConfig) return ctx.getConfig();
      const raw = await ctx.r2Get("_osler.config.json");
      if (!raw) throw new ToolError("Config file not found in storage");
      return JSON.parse(raw);
    },
  },
  {
    name: "update_config",
    description: "Update platform site configuration (_osler.config.json). (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        config: { type: "object", description: "Complete updated config object" },
      },
      required: ["config"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "update_config");
      if (!args.config || typeof args.config !== "object") throw new ToolError("config must be an object");
      const serialized = JSON.stringify(args.config, null, 2);
      if (serialized.length > MAX_CONFIG_BYTES) {
        throw new ToolError(`config too large — up to ${MAX_CONFIG_BYTES / 1_000_000} MB serialized`);
      }
      if (ctx.putConfig) {
        await ctx.putConfig(args.config);
      } else {
        await ctx.r2Put("_osler.config.json", serialized, "application/json");
      }
      await ctx.audit("mcp_update_config", null, { via: "mcp" });
      return { ok: true };
    },
  },

  // ─── Read-only context & observability tools (both tiers) ────────────────

  {
    name: "get_instance_overview",
    description:
      "Instance snapshot for orienting an agent session: token scope + username, content object counts by status, user/session totals (admin scope), and the current student-facing content version stamp. Call this first when unsure what the instance holds. (User counts admin-only.)",
    inputSchema: { type: "object", properties: {} },
    async run(ctx) {
      const [byStatus, users] = await Promise.all([
        ctx.env.DB.prepare("SELECT status, COUNT(*) AS n FROM content_objects GROUP BY status").all(),
        ctx.scope === "admin"
          ? ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>()
          : Promise.resolve(null),
      ]);
      const counts: Record<string, number> = {};
      for (const row of (byStatus.results ?? []) as any[]) counts[row.status] = row.n;
      return {
        you: { username: ctx.username, scope: ctx.scope },
        contentObjects: counts,
        ...(users ? { users: users?.n ?? 0 } : {}),
        contentVersion: ctx.readContentVersion ? await ctx.readContentVersion() : null,
        versioning: "Manifests are stamped with a version; students receive new content within ~90s or on their next hub visit — no republish needed for them to see changes.",
      };
    },
  },
  {
    name: "list_review_queue",
    description:
      "List content awaiting review (status pending), or recently rejected items (status rejected) whose feedback needs addressing. Start here for triage; approve_content / reject_content act on these ids.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "rejected"], description: "Queue to list (default pending)" },
      },
    },
    async run(ctx, args) {
      const status = args?.status === "rejected" ? "rejected" : "pending";
      const scopeFilter = ctx.scope === "admin" ? "" : "AND created_by = ?";
      const params: unknown[] = ctx.scope === "admin" ? [status] : [status, ctx.userId];
      const rows = await ctx.env.DB.prepare(
        `SELECT id, content_type, title, language, status, target_path, rejection_reason, submitted_at, updated_at FROM content_objects WHERE status = ? ${scopeFilter} ORDER BY updated_at DESC LIMIT 100`,
      )
        .bind(...params)
        .all();
      return { status, count: rows.results?.length ?? 0, items: rows.results ?? [] };
    },
  },
  {
    name: "get_audit_trail",
    description:
      "Recent audit entries (all mcp_* actions included) for tracing who changed what and when — the accountability record after any destructive or publish action. Filterable by action name.",
    inputSchema: {
      type: "object",
      properties: {
        action: str("Filter by exact action name (e.g. mcp_delete_object, mcp_publish_content)"),
        page: { type: "number", description: "1-based page (50 per page)" },
      },
    },
    async run(ctx, args) {
      requireAdmin(ctx, "get_audit_trail");
      if (!ctx.getAuditTrail) throw new ToolError("Audit trail not wired on this host");
      const page = Math.max(1, Number(args?.page) || 1);
      const action = typeof args?.action === "string" && args.action.trim() ? args.action.trim() : undefined;
      const { items, total } = await ctx.getAuditTrail({ page, action });
      return { page, total, count: items.length, items };
    },
  },
  {
    name: "get_analytics_overview",
    description: "Traffic and health aggregates over the last N days (page views, sessions, JS errors, web vitals, API calls, route changes, plus 24h figures). Same numbers as the admin analytics dashboard. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window: 1, 7, or 30 days (default 7)" },
      },
    },
    async run(ctx, args) {
      requireAdmin(ctx, "get_analytics_overview");
      if (!ctx.getAnalyticsOverview) throw new ToolError("Analytics store not wired on this host");
      const days = [1, 7, 30].includes(Number(args?.days)) ? Number(args.days) : 7;
      return { days, ...(await ctx.getAnalyticsOverview(days)) };
    },
  },
  {
    name: "get_js_errors",
    description: "Recent client-side JS errors grouped by message with counts, first/last seen timestamps, and affected path/session counts. Use it to triage frontend crashes without opening the admin dashboard. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window in days, 1-30 (default 7)" },
        limit: { type: "number", description: "Max error groups, 1-100 (default 20)" },
      },
    },
    async run(ctx, args) {
      requireAdmin(ctx, "get_js_errors");
      if (!ctx.getJsErrors) throw new ToolError("Analytics store not wired on this host");
      const days = Math.min(30, Math.max(1, Number(args?.days) || 7));
      const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
      const items = await ctx.getJsErrors({ since: Date.now() - days * 86_400_000, limit });
      return { days, count: items.length, items };
    },
  },
  {
    name: "get_content_version",
    description:
      "The current content version stamp. It advances on every publish/unpublish/delete/hotfix — students' clients detect the change and cache-bust their manifests, so newly published content reaches them without a hard refresh.",
    inputSchema: { type: "object", properties: {} },
    async run(ctx) {
      const version = ctx.readContentVersion ? await ctx.readContentVersion() : null;
      return { version, note: "No version yet means no managed manifest write has happened since versioning shipped." };
    },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
