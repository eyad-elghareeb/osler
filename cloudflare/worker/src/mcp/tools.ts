/**
 * Osler MCP tool registry — complete content-authoring and admin management surface.
 *
 * Supports two privilege tiers:
 *   1. 'content_admin': Create drafts, upload assets, validate, submit for review, read published files.
 *   2. 'admin': Full editing abilities — direct publishing, approvals/rejections, unpublishing,
 *      deletion, hotfixes, asset management, smart manifest sync, article metadata, and config updates.
 */

import type { McpEnv } from "./auth";

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

const CONTENT_TYPES = ["quiz", "bank", "written", "flashcard", "osce", "library", "video"] as const;

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

const draftTitle = (body: string): string | null => {
  try {
    const j = JSON.parse(body);
    return typeof j.title === "string" ? j.title.trim().slice(0, 200) : null;
  } catch {
    return null;
  }
};

// ─── Tool definitions ────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  {
    name: "list_content_objects",
    description:
      "List managed content objects with id, type, title, status, and dates. Admin-scoped tokens can list all users' objects.",
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

      if (ctx.scope === "admin" && !args?.mineOnly) {
        if (status) {
          where.push("co.status = ?");
          params.push(status);
        }
      } else {
        if (status === "published") {
          where.push("(co.created_by = ? OR co.status = 'published')");
          params.push(ctx.userId);
        } else {
          where.push("co.created_by = ?");
          params.push(ctx.userId);
          if (status) {
            where.push("co.status = ?");
            params.push(status);
          }
        }
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
      const obj = await loadOwnedObject(ctx, args?.id, true);
      let bodyKey = ctx.draftKey(obj.r2_key_base);
      if (obj.status === "published") bodyKey = ctx.publishedKey(obj.r2_key_base);
      else if (obj.status === "pending") bodyKey = ctx.pendingKey(obj.r2_key_base);
      const body = await ctx.r2Get(bodyKey);
      return { ...obj, body: body ?? null };
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
      const obj = await loadOwnedObject(ctx, args?.id);
      if (obj.status === "pending" && ctx.scope !== "admin") {
        throw new ToolError("Object is pending review — ask an admin or use an admin-scoped token to reject it back to draft before editing");
      }
      if (typeof args.body !== "string" || !args.body || args.body.length > 2_000_000) {
        throw new ToolError("body must be a non-empty string up to 2 MB");
      }
      await ctx.r2Put(ctx.draftKey(obj.r2_key_base), args.body);
      const newTitle = draftTitle(args.body);
      await ctx.env.DB.prepare("UPDATE content_objects SET title = COALESCE(?, title), updated_at = ? WHERE id = ?")
        .bind(newTitle, now(), obj.id)
        .run();
      await ctx.audit("mcp_update_draft", obj.id, { title: newTitle, via: "mcp" });
      return { ok: true, id: obj.id, title: newTitle ?? obj.title };
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
        const obj = await loadOwnedObject(ctx, args.id);
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
    name: "submit_for_review",
    description: "Submit a draft for admin review: snapshots draft to pending candidate queue.",
    inputSchema: { type: "object", properties: { id: str("Content object id") }, required: ["id"] },
    async run(ctx, args) {
      const obj = await loadOwnedObject(ctx, args?.id);
      const draft = await ctx.r2Get(ctx.draftKey(obj.r2_key_base));
      if (!draft) throw new ToolError("Draft is empty");
      await ctx.r2Put(ctx.pendingKey(obj.r2_key_base), draft);
      await ctx.env.DB.prepare("UPDATE content_objects SET status = 'pending', submitted_at = ?, reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL, updated_at = ? WHERE id = ?")
        .bind(now(), now(), obj.id)
        .run();
      await ctx.audit("mcp_submit_content", obj.id, { title: obj.title, via: "mcp" });
      return { ok: true, status: "pending", note: "Awaiting approval." };
    },
  },
  {
    name: "read_content_file",
    description: "Read a published student-facing file or manifest from R2. Returns raw text body.",
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
      return { key, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream", size: body.length, body };
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
      const bucket = requireEnv(ctx);
      const contentType = checkType(args?.contentType);
      const title = typeof args?.title === "string" ? args.title.trim().slice(0, 200) : "";
      if (!title) throw new ToolError("title required");
      if (typeof args.body !== "string" || !args.body || args.body.length > 2_000_000) throw new ToolError("body must be a string up to 2 MB");
      const assets: any[] = Array.isArray(args.assets) ? args.assets : [];
      if (assets.length > 50) throw new ToolError("At most 50 assets per batch pack");

      if (args.validateFirst && contentType !== "library") {
        let errors: string[] = [];
        try {
          errors = ctx.validateContent(contentType, JSON.parse(args.body));
        } catch (e: any) {
          errors = [`Invalid JSON: ${e.message}`];
        }
        if (errors.length) return { ok: false, stage: "validation", errors };
      }

      const objectId = ctx.uuid();
      const r2Base = `content/${contentType}/${objectId}`;
      const targetPath = sanitizeTargetPath(args?.targetPath);
      await ctx.r2Put(ctx.draftKey(r2Base), args.body);
      try {
        await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, target_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)")
          .bind(objectId, r2Base, contentType, title, args?.language === "ar" ? "ar" : "en", targetPath, ctx.userId, now(), now())
          .run();
      } catch {
        await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
          .bind(objectId, r2Base, contentType, title, args?.language === "ar" ? "ar" : "en", ctx.userId, now(), now())
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
      if (args.publishImmediately) {
        requireAdmin(ctx, "publishImmediately");
        if (ctx.publishObject) {
          const pub = await ctx.publishObject(objectId, targetPath);
          finalStatus = "published";
          hybridKeys = pub.hybridKeys;
        }
      } else if (args.submit && failed.length === 0) {
        await ctx.r2Put(ctx.pendingKey(r2Base), args.body);
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
    description: "Permanently delete a content object, its R2 storage files, and prune student manifests. (Admin or draft owner).",
    inputSchema: { type: "object", properties: { id: str("Content object id") }, required: ["id"] },
    async run(ctx, args) {
      const obj = await loadOwnedObject(ctx, args?.id, true);
      if (obj.status === "published" && ctx.scope !== "admin") {
        throw new ToolError("Deleting published content requires admin privilege");
      }
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
    description: "Directly hotfix a student-facing published file (e.g. 'content-files/qbank/Cardiology/questions.json') and trigger smart manifest sync. (Admin only).",
    inputSchema: {
      type: "object",
      properties: {
        key: str('Published R2 key under content-files/, e.g. "content-files/qbank/cardiology/questions.json"'),
        body: str("New text / JSON / markdown content"),
      },
      required: ["key", "body"],
    },
    async run(ctx, args) {
      requireAdmin(ctx, "update_published_content");
      const key = typeof args?.key === "string" ? args.key.trim() : "";
      if (!key.startsWith("content-files/") || key.includes("..") || key.includes("\\")) {
        throw new ToolError("Key must start with 'content-files/'");
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
    description: "Search managed content objects by title, keywords, or status.",
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
      if (ctx.putConfig) {
        await ctx.putConfig(args.config);
      } else {
        await ctx.r2Put("_osler.config.json", JSON.stringify(args.config, null, 2), "application/json");
      }
      await ctx.audit("mcp_update_config", null, { via: "mcp" });
      return { ok: true };
    },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
