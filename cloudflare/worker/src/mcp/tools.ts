/**
 * MCP tool registry — the content-authoring surface exposed to AI agents.
 *
 * Deliberately EXCLUDES publish/approve/reject/schedule/unpublish/delete and
 * every non-content admin surface: agents can take work to `pending`, but a
 * human admin approves publication through the web admin panel. Handlers
 * mirror the semantics of the corresponding /v1/admin/content HTTP endpoints
 * (ownership checks, path sanitization, size caps) without self-fetching.
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
  log: McpLog;
  audit(action: string, targetId: string | null, detail: Record<string, unknown> | null): Promise<void>;
  r2Get(key: string): Promise<string | null>;
  r2Put(key: string, text: string, contentType?: string): Promise<void>;
  draftKey(base: string): string;
  pendingKey(base: string): string;
  validateContent(contentType: string, parsed: unknown): string[];
  uuid(): string;
}

/** Tool-logic failure surfaced to the agent as an isError tool result. */
export class ToolError extends Error {}

const CONTENT_TYPES = ["quiz", "bank", "written", "flashcard", "osce", "library", "video"] as const;

const s = { type: "string" as const };
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

async function loadOwnedObject(ctx: McpCtx, id: unknown, allowPublished = false) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new ToolError("Valid object id required");
  const obj = await ctx.env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(id).first<any>();
  if (!obj) throw new ToolError("Content object not found");
  const owner = obj.created_by === ctx.userId;
  if (!owner && !(allowPublished && obj.status === "published")) throw new ToolError("Not the owner of this object");
  return obj;
}

function checkType(contentType: unknown): string {
  if (typeof contentType !== "string" || !(CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new ToolError(`Invalid contentType — one of ${CONTENT_TYPES.join(", ")}`);
  }
  return contentType;
}

/** Decodes a data URI (or bare base64) to bytes — flat-loop form keeps CPU cost low on large payloads. */
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
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    pdf: "application/pdf",
  };
  return map[ext] ?? fallback;
}

function safeRelPath(input: unknown, imagesPrefix = true): string {
  let rel = typeof input === "string" ? input.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!rel || rel.includes("..") || rel.includes("\\")) throw new ToolError("Invalid asset path");
  if (!rel.includes("/") && imagesPrefix) rel = `images/${rel}`;
  return rel;
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
      "List this account's managed content objects (any status: draft, pending, rejected, published) with id, type, title and workflow state.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "pending", "rejected", "published", "all"], description: "Filter by workflow status (default all)" },
        q: str("Title substring search"),
        page: { type: "number", description: "1-based page number" },
        limit: { type: "number", description: "Page size, 1-100 (default 50)" },
      },
    },
    async run(ctx, args) {
      const status = ["draft", "pending", "rejected", "published"].includes(args?.status) ? args.status : null;
      const like = typeof args?.q === "string" && args.q.trim() ? `%${args.q.trim()}%` : null;
      const limit = Math.min(100, Math.max(1, Number(args?.limit) || 50));
      const offset = (Math.max(1, Number(args?.page) || 1) - 1) * limit;
      const where = ["co.created_by = ?"];
      const params: unknown[] = [ctx.userId];
      if (status && status !== "published") {
        where.push("co.status = ?");
        params.push(status);
      } else if (status === "published") {
        where.splice(0, where.length, "(co.created_by = ? OR co.status = 'published')");
      }
      if (like) {
        where.push("co.title LIKE ?");
        params.push(like);
      }
      const whereSql = ` WHERE ${where.join(" AND ")}`;
      const [rows, total] = await Promise.all([
        ctx.env.DB.prepare(`SELECT co.id, co.content_type, co.title, co.language, co.status, co.created_at, co.updated_at, co.submitted_at, co.rejection_reason FROM content_objects co${whereSql} ORDER BY co.updated_at DESC LIMIT ? OFFSET ?`)
          .bind(...params, limit, offset)
          .all(),
        ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM content_objects co${whereSql}`)
          .bind(...params)
          .first<{ n: number }>(),
      ]);
      return { items: rows.results ?? [], total: total?.n ?? 0 };
    },
  },
  {
    name: "get_content_object",
    description: "Fetch one managed content object by id — metadata plus its body (draft for unpublished work, published copy otherwise).",
    inputSchema: { type: "object", properties: { id: str("Content object id") }, required: ["id"] },
    async run(ctx, args) {
      const obj = await loadOwnedObject(ctx, args?.id, true);
      const bodyKey = obj.status === "published" ? `${obj.r2_key_base}/published.json` : ctx.draftKey(obj.r2_key_base);
      const body = await ctx.r2Get(bodyKey);
      return { ...obj, body: body ?? null };
    },
  },
  {
    name: "create_content_draft",
    description: 'Create a new draft content object. Prefer create_content_pack for new packs — it uploads everything in one call.',
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Engine type of the pack" },
        title: str("Display title (folder-name convention)") ,
        language: str('"en" or "ar"'),
        content: str("Optional initial JSON/markdown body"),
      },
      required: ["contentType"],
    },
    async run(ctx, args) {
      requireEnv(ctx);
      const contentType = checkType(args?.contentType);
      const objectId = ctx.uuid();
      const r2Base = `content/${contentType}/${objectId}`;
      const title = typeof args?.title === "string" ? args.title.trim().slice(0, 200) : null;
      const initial = typeof args?.content === "string" && args.content.length <= 1_000_000 ? args.content : JSON.stringify({ title: title || "Untitled" }, null, 2);
      await ctx.r2Put(ctx.draftKey(r2Base), initial);
      await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
        .bind(objectId, r2Base, contentType, title, args?.language === "ar" ? "ar" : "en", ctx.userId, now(), now())
        .run();
      await ctx.audit("mcp_create_content", objectId, { title, contentType, via: "mcp" });
      return { id: objectId, r2KeyBase: r2Base, status: "draft" };
    },
  },
  {
    name: "update_draft_body",
    description: "Replace the draft body of a content object you own (JSON for quiz/bank/written/flashcard/osce/video, markdown/html for library). Max 1 MB.",
    inputSchema: {
      type: "object",
      properties: { id: str("Content object id"), body: str("Full replacement body") },
      required: ["id", "body"],
    },
    async run(ctx, args) {
      const obj = await loadOwnedObject(ctx, args?.id);
      if (obj.status === "pending") throw new ToolError('Object is pending review — ask an admin to reject it back to draft before editing');
      if (typeof args.body !== "string" || !args.body || args.body.length > 1_000_000) throw new ToolError("body must be a non-empty string up to 1 MB");
      await ctx.r2Put(ctx.draftKey(obj.r2_key_base), args.body);
      await ctx.env.DB.prepare("UPDATE content_objects SET title = COALESCE(?, title), updated_at = ? WHERE id = ?")
        .bind(draftTitle(args.body), now(), obj.id)
        .run();
      await ctx.audit("mcp_update_draft", obj.id, { via: "mcp" });
      return { ok: true };
    },
  },
  {
    name: "upload_asset",
    description: 'Upload one asset file (image, audio...) into a pack you own. Bare filenames land under "images/". Send binary data as a data URI.',
    inputSchema: {
      type: "object",
      properties: {
        id: str("Content object id"),
        path: str('Relative path inside the pack, e.g. "diagram.png" or "images/fig-3.png"'),
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
    name: "validate_content",
    description: "Run the platform's server-side schema validation over a JSON body (optionally against a stored draft). Fix every reported error before submitting.",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Required when no id is given" },
        id: str("Validate the stored draft of this object instead of an inline body"),
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
      if (contentType === "library") return { errors: [] };
      let parsed: unknown;
      try {
        parsed = JSON.parse(body!);
      } catch (e: any) {
        return { errors: [`Invalid JSON: ${e.message}`] };
      }
      return { errors: ctx.validateContent(contentType, parsed) };
    },
  },
  {
    name: "submit_for_review",
    description:
      "Submit a draft you own for admin review: snapshots the draft as the pending candidate and moves it to the approval queue. You cannot approve or publish yourself.",
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
      return { ok: true, status: "pending", note: "Awaiting human admin approval in the web admin panel." };
    },
  },
  {
    name: "read_content_file",
    description:
      "Read a published student-facing file for reference — keys under content-files/ (packs, images) or content-manifests/ (category manifests). Returns the raw text body.",
    inputSchema: { type: "object", properties: { key: str('R2 key, e.g. "content-files/qbank/Cardiology/questions.json"') }, required: ["key"] },
    async run(ctx, args) {
      const bucket = requireEnv(ctx);
      const key = typeof args?.key === "string" ? args.key.trim() : "";
      const allowed = key.startsWith("content-files/") || key.startsWith("content-manifests/");
      if (!allowed || key.includes("..") || key.includes("\\") || key.startsWith("/")) throw new ToolError("Only content-files/ and content-manifests/ keys can be read");
      const obj = await bucket.get(key);
      if (!obj) throw new ToolError("Key not found");
      const body = await obj.text();
      return { key, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream", size: body.length, body };
    },
  },
  {
    name: "list_content_files",
    description: "List student-facing content keys under content-files/ (optionally by category prefix) to study existing pack structure.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: str('Category prefix after "content-files/", e.g. "qbank/"'),
        cursor: str("Opaque pagination cursor from a previous call"),
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
    description:
      "ONE-CALL batch upload: creates a draft, writes the main body, uploads all assets (images as data URIs), optionally validates first, and optionally submits for review. Strongly preferred over per-file calls.",
    inputSchema: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: [...CONTENT_TYPES], description: "Engine type of the pack" },
        title: str("Display title"),
        language: str('"en" or "ar"'),
        body: str("Main JSON/markdown body (max 1 MB)"),
        assets: {
          type: "array",
          description: 'Asset files, max 30 / 15 MB combined. Each: { "path": "fig-1.png", "dataUri": "data:image/png;base64,..." }',
          items: {
            type: "object",
            properties: { path: str("Relative path (bare filenames go under images/)"), dataUri: str("Data URI for binary content"), text: str("Plain-text content") },
            required: ["path"],
          },
        },
        validateFirst: { type: "boolean", description: "Validate body before writing (library always passes)" },
        submit: { type: "boolean", description: "Submit for admin review after upload" },
      },
      required: ["contentType", "title", "body"],
    },
    async run(ctx, args) {
      const bucket = requireEnv(ctx);
      const contentType = checkType(args?.contentType);
      const title = typeof args?.title === "string" ? args.title.trim().slice(0, 200) : "";
      if (!title) throw new ToolError("title required");
      if (typeof args.body !== "string" || !args.body || args.body.length > 1_000_000) throw new ToolError("body must be a non-empty string up to 1 MB");
      const assets: any[] = Array.isArray(args.assets) ? args.assets : [];
      if (assets.length > 30) throw new ToolError("At most 30 assets per pack — split into multiple packs or use upload_asset");
      let budget = 0;
      for (const a of assets) budget += (typeof a?.dataUri === "string" ? a.dataUri.length : 0) + (typeof a?.text === "string" ? a.text.length : 0);
      if (budget > 20_000_000) throw new ToolError("Assets exceed 20 MB combined");

      // Validate before anything is written so failures are cheap.
      let validationErrors: string[] = [];
      if (args.validateFirst && contentType !== "library") {
        try {
          validationErrors = ctx.validateContent(contentType, JSON.parse(args.body));
        } catch (e: any) {
          validationErrors = [`Invalid JSON: ${e.message}`];
        }
        if (validationErrors.length) return { ok: false, stage: "validation", errors: validationErrors };
      }

      const objectId = ctx.uuid();
      const r2Base = `content/${contentType}/${objectId}`;
      await ctx.r2Put(ctx.draftKey(r2Base), args.body);
      await ctx.env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
        .bind(objectId, r2Base, contentType, title, args?.language === "ar" ? "ar" : "en", ctx.userId, now(), now())
        .run();

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

      let submitted = false;
      if (args.submit && failed.length === 0) {
        await ctx.r2Put(ctx.pendingKey(r2Base), args.body);
        await ctx.env.DB.prepare("UPDATE content_objects SET status = 'pending', submitted_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), objectId).run();
        submitted = true;
      }
      await ctx.audit(submitted ? "mcp_submit_content" : "mcp_create_content", objectId, { title, contentType, assets: uploaded.length, failed: failed.length, via: "mcp" });
      return {
        ok: failed.length === 0,
        id: objectId,
        r2KeyBase: r2Base,
        assetsUploaded: uploaded.length,
        failedAssets: failed,
        status: submitted ? "pending" : "draft",
        note: submitted ? "Awaiting human admin approval in the web admin panel." : undefined,
      };
    },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
